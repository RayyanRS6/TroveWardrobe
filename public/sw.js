// Trove service worker: keeps the app shell and wardrobe photos available
// offline. Wardrobe data itself lives in IndexedDB (app/lib/client/local-data.ts), so
// every API call other than photos goes straight to the network.
//
// Caches (bump a version suffix to drop that cache on every device):
//   trove-static-v4  GET /_next/static/*, /icons/*  cache-first. Build files
//                    are content-hashed; icons refresh only with a new version.
//   trove-pages-v4   page loads                      network-first (4 s), and
//                    only a signed-in "/" is kept, as the offline app shell.
//   trove-images-v3  GET /api/images/*               cache-first by full URL,
//                    newest ~800 kept.
// Never handled: non-GET, other origins, /login, /api/auth/*, other /api/*.
//
// Messages from the page (worker.postMessage, where worker is
// registration.waiting for "skip-waiting", else the active worker):
//   { type: "skip-waiting" }  activate a waiting update now
//   { type: "wipe" }          delete every trove-* cache (sign-out); replies
//                             { type: "wiped" } on event.ports[0], if given
//   { type: "prune-images", keep: ["/api/images/7?size=thumb&v=ab12", ...] }
//                             drop cached photos whose path+query is not kept
//   { type: "cache-page", urls: ["/", "https://…/_next/static/…", ...] }
//                             keep what a page loaded before this worker
//                             controlled it, by the rules above

const STATIC_CACHE = "trove-static-v4";
const PAGES_CACHE = "trove-pages-v4";
const IMAGES_CACHE = "trove-images-v3";
const CURRENT_CACHES = [STATIC_CACHE, PAGES_CACHE, IMAGES_CACHE];
const CACHE_PREFIX = "trove-";
const SHELL_KEY = "/";
const MAX_IMAGES = 800;
const PAGE_TIMEOUT_MS = 4000;
const MAX_PAGE_URLS = 300;

// Bumped by every wipe so a download that started before a sign-out cannot
// put its response back into a freshly emptied cache.
let generation = 0;

// Nothing is precached: "/" is stored after a signed-in page load. The first
// load after signing in is never controlled (the sign-in page removes this
// worker), so that page sends "cache-page" once this worker is active.
// A new version waits for the page to send "skip-waiting".

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX))
          .filter((name) => !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path.startsWith("/api/images/")) {
    event.respondWith(cacheFirst(event, IMAGES_CACHE));
    return;
  }
  // Network only: sign-in, auth and wardrobe data.
  if (path.startsWith("/api/") || path === "/login" || path.startsWith("/login/")) {
    return;
  }
  if (path.startsWith("/_next/static/") || path.startsWith("/icons/")) {
    event.respondWith(cacheFirst(event, STATIC_CACHE));
  } else if (request.mode === "navigate") {
    event.respondWith(pageLoad(event));
  }
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "skip-waiting") {
    self.skipWaiting();
  } else if (data.type === "wipe") {
    const reply = event.ports && event.ports[0];
    event.waitUntil(
      wipeCaches().then(() => reply && reply.postMessage({ type: "wiped" })),
    );
  } else if (data.type === "prune-images" && Array.isArray(data.keep)) {
    event.waitUntil(pruneImages(data.keep));
  } else if (data.type === "cache-page" && Array.isArray(data.urls)) {
    event.waitUntil(cachePage(data.urls).catch(() => undefined));
  }
});

/** Serve from the cache; otherwise fetch and keep a clean 200 copy. */
async function cacheFirst(event, cacheName) {
  const cached = await caches
    .match(event.request, { cacheName })
    .catch(() => undefined); // storage unavailable: just use the network
  if (cached) return cached;

  const started = generation;
  const response = await fetch(event.request);
  if (isStorable(response, cacheName)) {
    const copy = response.clone();
    event.waitUntil(
      (async () => {
        const cache = await caches.open(cacheName);
        if (started !== generation) return;
        await cache.put(event.request, copy);
        if (cacheName === IMAGES_CACHE) await trimImages(cache);
      })().catch(() => undefined), // e.g. storage quota exceeded
    );
  }
  return response;
}

/**
 * Network-first page load. After PAGE_TIMEOUT_MS the saved app shell is
 * shown instead (if there is one) and the network answer only updates it.
 */
async function pageLoad(event) {
  const network = fetch(event.request);
  // Registered before the reactions below, so the shell copy is cloned
  // before the browser starts reading the body.
  event.waitUntil(network.then(afterPageLoad).catch(() => undefined));

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, PAGE_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([network, timeout]);
    if (response && response.status < 500) return response;
    // Slow network or server error: prefer the saved shell.
    return (await savedShell()) || response || (await network);
  } catch {
    return (await savedShell()) || offlinePage();
  } finally {
    clearTimeout(timer);
  }
}

/** Keep a signed-in "/" as the shell; forget everything once signed out. */
async function afterPageLoad(response, started = generation) {
  if (isSignedOut(response)) return wipeCaches();
  if (!isCleanOk(response) || new URL(response.url).pathname !== "/") return;
  const copy = response.clone();
  const cache = await caches.open(PAGES_CACHE);
  if (started === generation) await cache.put(SHELL_KEY, copy);
}

/**
 * Keeps what a page loaded before this worker controlled it: a fresh "/" as
 * the shell, plus build files, icons and photos not cached yet. Only
 * same-origin URLs on those paths count, at most MAX_PAGE_URLS of them.
 */
async function cachePage(urls) {
  const started = generation;
  let shell = false;
  const files = new Map(); // href -> cache name
  for (const value of urls.slice(0, MAX_PAGE_URLS)) {
    if (typeof value !== "string") continue;
    let url;
    try {
      url = new URL(value, self.location.origin);
    } catch {
      continue;
    }
    if (url.origin !== self.location.origin) continue;
    url.hash = "";
    const path = url.pathname;
    if (path === SHELL_KEY) {
      shell = true;
    } else if (path.startsWith("/_next/static/") || path.startsWith("/icons/")) {
      files.set(url.href, STATIC_CACHE);
    } else if (path.startsWith("/api/images/")) {
      files.set(url.href, IMAGES_CACHE);
    }
  }

  const jobs = [...files].map(([href, cacheName]) => storeCopy(href, cacheName, started));
  if (shell) {
    jobs.push(fetch(SHELL_KEY).then((response) => afterPageLoad(response, started)));
  }
  await Promise.all(jobs.map((job) => job.catch(() => undefined)));
  if (started === generation && [...files.values()].includes(IMAGES_CACHE)) {
    await trimImages(await caches.open(IMAGES_CACHE));
  }
}

/** Fetch `href` into `cacheName` unless it is already there. */
async function storeCopy(href, cacheName, started) {
  if (await caches.match(href, { cacheName })) return;
  const response = await fetch(href);
  if (started !== generation || !isStorable(response, cacheName)) return;
  const cache = await caches.open(cacheName);
  if (started === generation) await cache.put(href, response);
}

/**
 * A page load that ends at sign-in means the session is over. Navigations
 * use redirect: "manual", which hides the Location header from the worker,
 * so any page redirect counts: in Trove only the sign-in gate redirects pages.
 */
function isSignedOut(response) {
  if (response.status === 401) return true;
  if (response.redirected) return new URL(response.url).pathname === "/login";
  return response.type === "opaqueredirect";
}

/** A 200 from this origin that did not come through a redirect. */
function isCleanOk(response) {
  return (
    response.status === 200 && response.type === "basic" && !response.redirected
  );
}

/** A clean 200 worth keeping in `cacheName`; photos must be images. */
function isStorable(response, cacheName) {
  return (
    isCleanOk(response) &&
    (cacheName !== IMAGES_CACHE ||
      (response.headers.get("Content-Type") || "").startsWith("image/"))
  );
}

function savedShell() {
  return caches
    .match(SHELL_KEY, { cacheName: PAGES_CACHE })
    .catch(() => undefined);
}

async function wipeCaches() {
  generation += 1;
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX))
      .map((name) => caches.delete(name)),
  );
}

/** Cache keys are kept in insertion order: drop the oldest over the cap. */
async function trimImages(cache) {
  const keys = await cache.keys();
  const excess = keys.length - MAX_IMAGES;
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  }
}

/** Drop cached photos whose path+query is not in `keep`. */
async function pruneImages(keep) {
  const wanted = new Set(keep.map(pathAndQuery));
  const cache = await caches.open(IMAGES_CACHE);
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((key) => !wanted.has(pathAndQuery(key.url)))
      .map((key) => cache.delete(key)),
  );
}

/** "/api/images/7?size=thumb&v=ab12" for a relative or absolute URL. */
function pathAndQuery(value) {
  try {
    const url = new URL(value, self.location.origin);
    return url.pathname + url.search;
  } catch {
    return "";
  }
}

function offlinePage() {
  const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Trove is offline</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    padding: 24px; box-sizing: border-box; background: #f8f1f2; color: #1f0818;
    font: 16px/1.5 "DM Sans", system-ui, sans-serif; text-align: center; }
  h1 { margin: 0 0 8px; font: 400 40px/1.1 "DM Serif Display", Georgia, serif;
    letter-spacing: -0.02em; }
  h1 span { color: #f08caf; }
  p { margin: 0 0 20px; color: #6b5362; }
  a { display: inline-block; padding: 12px 20px; border-radius: 100px;
    background: #1f0818; color: #f8eef1; font-weight: 600; text-decoration: none; }
  a:focus-visible { outline: 3px solid #1f0818; outline-offset: 3px; }
  @media (prefers-color-scheme: dark) {
    body { background: #170511; color: #f8eef1; }
    p { color: #cbb1bf; }
    a { background: #f4b6ce; color: #1f0818; }
    a:focus-visible { outline-color: #f4b6ce; }
  }
</style>
<main>
  <h1>trove<span>.</span></h1>
  <p>You're offline. Connect once on this device to keep your wardrobe here.</p>
  <a href="/">Try again</a>
</main>
</html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
