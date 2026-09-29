// This device's offline data: the IndexedDB copy of the wardrobe and the
// service worker (public/sw.js) that caches the app shell and photos. The
// API stays the source of truth; everything here can be wiped at any time.

const DB_NAME = "trove-cache";
const STORE = "wardrobe";
const SNAPSHOT_KEY = "latest";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

// One connection per page. Closed (and refused from then on) by a wipe;
// dropped when another tab or the sign-in page deletes the database.
let connection: Promise<IDBDatabase> | null = null;
let wiped = false;

function openDb(): Promise<IDBDatabase> {
  if (wiped) return Promise.reject(new Error("Local data was wiped"));
  if (connection) return connection;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const forget = () => {
        if (connection === opening) connection = null;
      };
      db.onversionchange = () => {
        db.close();
        forget();
      };
      db.onclose = forget;
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
  connection = opening;
  opening.catch(() => {
    if (connection === opening) connection = null;
  });
  return opening;
}

/** The saved wardrobe copy (unvalidated), or null. */
export async function readSnapshot(): Promise<unknown> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(SNAPSHOT_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/** Saves the latest synced wardrobe; failures only cost the offline copy. */
export async function writeSnapshot(snapshot: unknown) {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(snapshot, SNAPSHOT_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // Private browsing or a full disk: the app still works online.
  }
}

async function closeDb() {
  const pending = connection;
  connection = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // Never opened.
  }
}

/** Resolves once the database is gone, or could not be deleted right now. */
function deleteDb() {
  return new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

function withTimeout(task: Promise<unknown>, ms: number) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, ms);
    task.then(
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      () => {
        window.clearTimeout(timer);
        resolve();
      },
    );
  });
}

/** Asks the active service worker to drop its caches; it replies when done. */
function askWorkerToWipe() {
  const controller =
    "serviceWorker" in navigator ? navigator.serviceWorker.controller : null;
  if (!controller) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    controller.postMessage({ type: "wipe" }, [channel.port2]);
  });
}

async function clearCacheStorage() {
  if (!("caches" in window)) return;
  const names = await caches.keys();
  await Promise.all(names.map((name) => caches.delete(name)));
}

async function unregisterWorkers() {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
}

/**
 * Removes everything this device keeps: the IndexedDB copy, every cache and
 * the service worker. Bounded in time, so signing out never hangs on it.
 */
export async function wipeLocalData() {
  wiped = true;
  await closeDb();
  await withTimeout(Promise.all([askWorkerToWipe(), clearCacheStorage()]), 2000);
  await withTimeout(unregisterWorkers(), 1500);
  await withTimeout(deleteDb(), 1500);
}

/** Drops cached photos that no current item uses (after a sync). */
export function pruneCachedImages(keep: string[]) {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: "prune-images", keep });
}

// Paths the worker keeps (besides "/"): build files, icons and photos.
const WORKER_CACHED_PATH = /^\/(?:_next\/static|icons|api\/images)\//;
// Lets files this page is still loading finish, so they are listed too.
const CACHE_PAGE_DELAY_MS = 3000;

/** This page's own URLs the worker keeps: "/" and the files it loaded. */
function pageUrls() {
  const urls = new Set<string>();
  if (window.location.pathname === "/") urls.add("/");
  const loaded = [
    ...performance.getEntriesByType("resource").map((entry) => entry.name),
    ...Array.from(document.scripts, (script) => script.src),
    ...Array.from(document.querySelectorAll<HTMLLinkElement>("link[href]"), (link) => link.href),
    ...Array.from(document.images, (image) => image.currentSrc || image.src),
  ];
  for (const value of loaded) {
    try {
      const url = new URL(value, window.location.href);
      if (url.origin === window.location.origin && WORKER_CACHED_PATH.test(url.pathname)) {
        urls.add(url.href);
      }
    } catch {
      // Not a valid URL.
    }
  }
  return [...urls];
}

/**
 * Registers the offline service worker in production builds. When a new
 * version is waiting, `onUpdateReady` gets a function that activates it; the
 * page then reloads once. A load the worker did not control has the worker
 * keep its shell and files. Development unregisters any leftover worker so
 * it cannot serve stale files. Returns a cleanup function.
 */
export function registerServiceWorker(onUpdateReady: (apply: () => void) => void) {
  if (!("serviceWorker" in navigator)) return () => undefined;

  if (!IS_PRODUCTION) {
    unregisterWorkers().catch(() => undefined);
    return () => undefined;
  }

  let active = true;
  let requested = false;
  let reloading = false;
  let cacheTimer: number | undefined;
  // The sign-in page removes the worker, so the first load after signing in
  // is not controlled: neither "/" nor its files went through the worker.
  const startedUncontrolled = !navigator.serviceWorker.controller;

  const reload = () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  };
  // Also fires when the very first worker claims the page, or when another
  // tab applies an update; only an update the viewer asked for here reloads.
  const onControllerChange = () => {
    if (requested) reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

  const offer = (worker: ServiceWorker) => {
    if (!active) return;
    onUpdateReady(() => {
      // Another tab already applied this update: no controllerchange is
      // coming, and a reload runs the new version.
      if (worker.state !== "installed") {
        reload();
        return;
      }
      requested = true;
      worker.postMessage({ type: "skip-waiting" });
    });
  };

  // Once a worker is active, it stores what an uncontrolled load fetched, so
  // offline works from the first session (later requests go through it).
  const cacheThisPage = (registration: ServiceWorkerRegistration) => {
    if (!active || !startedUncontrolled) return;
    cacheTimer = window.setTimeout(() => {
      const worker = navigator.serviceWorker.controller ?? registration.active;
      if (!active || wiped || !worker) return;
      try {
        worker.postMessage({ type: "cache-page", urls: pageUrls() });
      } catch {
        // Only costs the offline copy until the next launch.
      }
    }, CACHE_PAGE_DELAY_MS);
  };

  navigator.serviceWorker
    .register("/sw.js")
    .then((registration) => {
      // A waiting worker only matters when an older one controls this page.
      if (registration.waiting && navigator.serviceWorker.controller) {
        offer(registration.waiting);
      }
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            offer(installing);
          }
        });
      });
      return navigator.serviceWorker.ready.then(cacheThisPage);
    })
    .catch(() => undefined);

  return () => {
    active = false;
    window.clearTimeout(cacheTimer);
    navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  };
}
