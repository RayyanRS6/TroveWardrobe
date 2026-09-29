// Runtime tests against the BUILT Worker (dist/server) with a fresh local D1
// and test-only secrets. `npm test` builds first.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createSessionToken, verifySessionToken } from "../app/lib/auth.ts";
import { PRESET_CATEGORIES, UNCATEGORIZED } from "../app/lib/wardrobe-options.ts";

const CONFIG = "dist/server/wrangler.json";
const WRANGLER = "node_modules/wrangler/bin/wrangler.js";
// Rows saved before migration 0009 (managed categories), when the API only
// trimmed names, then rows the previous Worker saves after 0009 and before
// 0010 (which drops seasons). Photos are never fetched; image_size 0 keeps
// the storage meter at zero.
const LEGACY_ROWS = [
  {
    beforeMigration: 9,
    sql: `
      INSERT INTO wardrobe_items (owner, name, category, color, season, image_key) VALUES
        ('owner', 'Oxford shirt', 'shirts', 'Blue', 'Summer', 'clothes/legacy-1.webp'),
        ('owner', 'Silk scarf', 'Scarves', 'Red', 'Winter', 'clothes/legacy-2.webp'),
        ('owner', 'Wool scarf', 'scarves', 'Grey', 'All season', 'clothes/legacy-3.webp'),
        ('owner', 'Linen suit', 'Pant  coat', 'Beige', 'Summer', 'clothes/legacy-4.webp'),
        ('owner', 'Tweed suit', 'pant' || char(9) || 'coat', 'Brown', 'Winter', 'clothes/legacy-5.webp'),
        ('owner', 'Pashmina', 'Écharpes', 'Cream', 'Winter', 'clothes/legacy-6.webp'),
        ('owner', 'Cashmere wrap', 'écharpes', 'Camel', 'Winter', 'clothes/legacy-7.webp');
    `,
  },
  {
    beforeMigration: 10,
    sql: `
      INSERT INTO wardrobe_items (owner, name, category, color, season, image_key) VALUES
        ('owner', 'Block-print kurta', 'kurtas', 'Indigo', 'Summer', 'clothes/legacy-8.webp'),
        ('owner', 'Cotton dupatta', 'Dupattas', 'White', 'Summer', 'clothes/legacy-9.webp');
    `,
  },
];
const PASSWORD = `test-${randomBytes(12).toString("base64url")}`;
const LOCKED_IP = "203.0.113.7";
const OWNER_IP = "198.51.100.20";
const SAFARI_IP = "198.51.100.21";
const DAY = 24 * 60 * 60;
// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function hashPassword(password) {
  const salt = randomBytes(16);
  const key = pbkdf2Sync(password.normalize("NFC"), salt, 20_000, 32, "sha256");
  return ["pbkdf2-sha256", 20_000, salt.toString("base64url"), key.toString("base64url")].join(":");
}

// Test values only. Backblaze stays unconfigured, so nothing leaves this
// machine and uploads must stop before any image processing.
const SECRETS = {
  APP_PASSWORD_HASH: hashPassword(PASSWORD),
  SESSION_SECRET: randomBytes(32).toString("base64url"),
  B2_ENDPOINT: "replace-with-endpoint",
  B2_BUCKET_NAME: "replace-with-bucket",
  B2_APPLICATION_KEY_ID: "replace-with-key-id",
  B2_APPLICATION_KEY: "replace-with-key",
};

let stateDir;
let worker;
let origin;
let sessionCookie;

function wrangler(...args) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    encoding: "utf8",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
  });
  assert.equal(result.status, 0, `wrangler ${args.slice(0, 2).join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
}

/**
 * For each LEGACY_ROWS entry, migrates the test D1 up to (not including) its
 * migration and saves its rows; then applies the rest, as production will.
 */
async function migrateWithLegacyRows() {
  const config = JSON.parse(await readFile(CONFIG, "utf8"));
  const [database] = config.d1_databases;
  const migrationsDir = path.resolve(path.dirname(CONFIG), database.migrations_dir);
  const local = ["--local", "--persist-to", stateDir];

  for (const { beforeMigration, sql } of LEGACY_ROWS) {
    const legacyDir = path.join(stateDir, `migrations-before-${beforeMigration}`);
    await mkdir(legacyDir);
    for (const file of await readdir(migrationsDir)) {
      if (file.endsWith(".sql") && Number.parseInt(file, 10) < beforeMigration) {
        await copyFile(path.join(migrationsDir, file), path.join(legacyDir, file));
      }
    }
    const legacyConfig = path.join(stateDir, `wrangler-before-${beforeMigration}.json`);
    await writeFile(
      legacyConfig,
      JSON.stringify({
        name: config.name,
        compatibility_date: config.compatibility_date,
        d1_databases: [{ ...database, migrations_dir: legacyDir }],
      }),
    );
    const legacyRows = path.join(stateDir, `rows-before-${beforeMigration}.sql`);
    await writeFile(legacyRows, sql);

    wrangler("d1", "migrations", "apply", database.database_name, ...local, "--config", legacyConfig);
    wrangler("d1", "execute", database.database_name, ...local, "--config", legacyConfig, "--file", legacyRows);
  }
  wrangler("d1", "migrations", "apply", database.database_name, ...local, "--config", CONFIG);
}

before(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), "trove-worker-test-"));
  await migrateWithLegacyRows();

  // An explicit env file keeps Wrangler from loading the real dist/server/.dev.vars.
  const envFile = path.join(stateDir, "test.env");
  await writeFile(envFile, Object.entries(SECRETS).map(([key, value]) => `${key}=${value}`).join("\n"));

  Object.assign(process.env, { WRANGLER_LOG: "error", WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" });
  const { unstable_startWorker } = await import("wrangler");
  worker = await unstable_startWorker({
    config: CONFIG,
    envFiles: [envFile],
    bindings: Object.fromEntries(
      Object.entries(SECRETS).map(([key, value]) => [key, { type: "secret_text", value }]),
    ),
    dev: {
      server: { hostname: "127.0.0.1", port: 0 },
      inspector: false,
      persist: stateDir,
      watch: false,
    },
  });
  await worker.ready;
  origin = (await worker.url).origin;
});

after(async () => {
  await worker?.dispose();
  if (stateDir) await rm(stateDir, { recursive: true, force: true });
});

function send(pathname, init = {}) {
  return fetch(new URL(pathname, origin), { redirect: "manual", ...init });
}

function sameOrigin(headers = {}) {
  return { Origin: origin, "Sec-Fetch-Site": "same-origin", ...headers };
}

function login(password, ip) {
  return send("/api/auth/login", {
    method: "POST",
    headers: sameOrigin({
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": ip,
    }),
    body: new URLSearchParams({ username: "trove", password }).toString(),
  });
}

function withSession(headers = {}) {
  assert.ok(sessionCookie, "signed in earlier in this file");
  return { Cookie: sessionCookie, ...headers };
}

async function assertJsonError(response, status, code) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.ok(body.error.length > 0);
  if (code) assert.equal(body.code, code);
  return body;
}

async function findStaticAsset(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findStaticAsset(full);
      if (found) return found;
    } else if (/\.(js|css)$/.test(entry.name)) {
      return full;
    }
  }
  return null;
}

test("hashed build assets are served without a session", async () => {
  const file = await findStaticAsset("dist/client/_next/static");
  assert.ok(file, "the build produced hashed assets");
  const pathname = `/${path.relative("dist/client", file).split(path.sep).join("/")}`;
  const response = await send(pathname);
  assert.equal(response.status, 200, pathname);
  assert.match(response.headers.get("content-type") ?? "", /javascript|css/);
  await response.arrayBuffer();
});

test("page navigations without a session redirect to /login", async () => {
  const response = await send("/", {
    headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate" },
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("API requests without a session get 401 JSON", async () => {
  const response = await send("/api/items");
  const body = await assertJsonError(response, 401, "unauthenticated");
  assert.equal(body.error, "Please sign in again.");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("uploads without a session get 401 JSON, not a dropped connection", async () => {
  for (let round = 1; round <= 3; round += 1) {
    const form = new FormData();
    form.set("name", "Shirt");
    form.set("image", new Blob([TINY_PNG, Buffer.alloc(256 * 1024)], { type: "image/png" }), "shirt.png");
    const response = await send("/api/items", { method: "POST", headers: sameOrigin(), body: form });
    await assertJsonError(response, 401, "unauthenticated");
  }
});

test("a forged Cloudflare Access header grants nothing", async () => {
  const response = await send("/api/items", {
    headers: { "cf-access-authenticated-user-email": "owner@example.com" },
  });
  await assertJsonError(response, 401, "unauthenticated");
});

test("security headers are set on Worker responses", async () => {
  const response = await send("/api/items");
  await response.arrayBuffer();
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  // Not no-referrer: that makes Safari and Firefox post the login form with
  // "Origin: null".
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  assert.equal(
    response.headers.get("permissions-policy"),
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  // Plain http (local) never gets HSTS.
  assert.equal(response.headers.get("strict-transport-security"), null);
});

test("GET /login serves the standalone sign-in page with a strict CSP", async () => {
  const response = await send("/login?error=1");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);

  const csp = response.headers.get("content-security-policy") ?? "";
  const nonce = /script-src 'nonce-([A-Za-z0-9_-]+)'/.exec(csp)?.[1];
  assert.ok(nonce, csp);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /font-src 'self'/);
  assert.equal(response.headers.get("referrer-policy"), "same-origin");

  const html = await response.text();
  assert.match(html, /<meta name="referrer" content="same-origin">/);
  for (const font of ["/fonts/dm-sans-latin.woff2", "/fonts/dm-serif-display-latin.woff2"]) {
    assert.ok(html.includes(`url(${font})`), font);
    // Loaded before sign-in, so it must be public.
    const file = await send(font);
    assert.equal(file.status, 200, font);
    assert.ok((await file.arrayBuffer()).byteLength > 1000, font);
  }
  assert.match(html, /action="\/api\/auth\/login"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /didn&#39;t work/);
  assert.match(html, /indexedDB\.deleteDatabase\("trove-cache"\)/);
  assert.doesNotMatch(html, /_next\/static/, "no app bundle on the login page");
  for (const tag of html.match(/<(script|style)\b[^>]*>/g) ?? []) {
    assert.ok(tag.includes(`nonce="${nonce}"`), tag);
  }
});

test("wrong passwords redirect with ?error=1, then lock the client out", async () => {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await login(`wrong-${attempt}`, LOCKED_IP);
    assert.equal(response.status, 303, `attempt ${attempt}`);
    assert.equal(response.headers.get("location"), "/login?error=1");
    assert.equal(response.headers.get("set-cookie"), null);
  }

  const empty = await login("", LOCKED_IP);
  assert.equal(empty.status, 303);
  assert.match(empty.headers.get("location") ?? "", /^\/login\?locked=\d+$/, "the fifth failure locks");

  // Locked: even the right password is refused before any hashing.
  const locked = await login(PASSWORD, LOCKED_IP);
  assert.equal(locked.status, 303);
  const seconds = Number(/locked=(\d+)$/.exec(locked.headers.get("location") ?? "")?.[1]);
  assert.ok(seconds > 0 && seconds <= 60, `locked for ${seconds}s`);
  assert.equal(locked.headers.get("set-cookie"), null);

  const page = await send(`/login?locked=${seconds}`);
  assert.match(await page.text(), /Too many attempts/);
});

test("the login endpoint accepts only small same-origin form posts", async () => {
  const json = await send("/api/auth/login", {
    method: "POST",
    headers: sameOrigin({ "Content-Type": "application/json", "CF-Connecting-IP": OWNER_IP }),
    body: JSON.stringify({ password: PASSWORD }),
  });
  await assertJsonError(json, 415, "unsupported_media_type");

  const large = await send("/api/auth/login", {
    method: "POST",
    headers: sameOrigin({
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": OWNER_IP,
    }),
    body: new URLSearchParams({ password: "x".repeat(3000) }).toString(),
  });
  await assertJsonError(large, 413, "too_large");

  const crossSite = await send("/api/auth/login", {
    method: "POST",
    headers: {
      Origin: "https://evil.example",
      "Sec-Fetch-Site": "cross-site",
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": OWNER_IP,
    },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
  });
  await assertJsonError(crossSite, 403, "cross_origin");

  // "Origin: null" without the browser's Sec-Fetch-Site: same-origin.
  for (const site of [null, "cross-site"]) {
    const nullOrigin = await send("/api/auth/login", {
      method: "POST",
      headers: {
        Origin: "null",
        ...(site ? { "Sec-Fetch-Site": site } : {}),
        "Content-Type": "application/x-www-form-urlencoded",
        "CF-Connecting-IP": OWNER_IP,
      },
      body: new URLSearchParams({ password: PASSWORD }).toString(),
    });
    await assertJsonError(nullOrigin, 403, "cross_origin");
  }
});

test("the right password signs in with an HttpOnly, SameSite=Lax cookie", async () => {
  const response = await login(PASSWORD, OWNER_IP);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  assert.equal(response.headers.get("cache-control"), "no-store");

  const setCookie = response.headers.get("set-cookie") ?? "";
  // Plain http (local) uses the non-__Host- name without Secure.
  assert.match(setCookie, /^trove_session=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; SameSite=Lax/);
  assert.match(setCookie, /; Path=\//);
  assert.match(setCookie, /; Max-Age=2592000/);
  assert.doesNotMatch(setCookie, /Secure/);
  sessionCookie = setCookie.split(";")[0];
});

test("a same-origin form post with Origin: null signs in (Safari, Firefox)", async () => {
  // What those browsers send from a no-referrer page; the browser-set
  // Sec-Fetch-Site: same-origin is what vouches for it.
  const response = await send("/api/auth/login", {
    method: "POST",
    headers: {
      Origin: "null",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-Mode": "navigate",
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": SAFARI_IP,
    },
    body: new URLSearchParams({ username: "trove", password: PASSWORD }).toString(),
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^trove_session=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);

  const items = await send("/api/items", { headers: { Cookie: setCookie.split(";")[0] } });
  assert.equal(items.status, 200);
  await items.arrayBuffer();
});

test("a session reaches the wardrobe API", async () => {
  const items = await send("/api/items", { headers: withSession() });
  assert.equal(items.status, 200);
  assert.equal(items.headers.get("cache-control"), "no-store");
  assert.equal((await items.json()).items.length, 9, "the legacy rows");

  const outfits = await send("/api/outfits", { headers: withSession() });
  assert.deepEqual(await outfits.json(), { outfits: [] });

  const categories = await send("/api/categories", { headers: withSession() });
  assert.equal(categories.status, 200);
  assert.equal(categories.headers.get("cache-control"), "no-store");
  assert.ok(Array.isArray((await categories.json()).categories));

  const usage = await send("/api/usage", { headers: withSession() });
  assert.deepEqual(await usage.json(), { bytesUsed: 0, limitBytes: 9_000_000_000 });
});

async function listItems() {
  const response = await send("/api/items", { headers: withSession() });
  assert.equal(response.status, 200);
  return (await response.json()).items;
}

async function listCategories() {
  const response = await send("/api/categories", { headers: withSession() });
  assert.equal(response.status, 200);
  return (await response.json()).categories;
}

/** {name: count} for a category list. */
function counts(categories) {
  return Object.fromEntries(categories.map(({ name, count }) => [name, count]));
}

function categoryOf(items, name) {
  return items.find((item) => item.name === name)?.category;
}

const byName = (a, b) => a.localeCompare(b, "en", { sensitivity: "base" });

test("migrations 0009 and 0010 list the presets and every category in use, and drop seasons", async () => {
  const items = await listItems();
  for (const item of items) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ["category", "color", "createdAt", "id", "imageUrl", "name", "thumbUrl"],
    );
  }
  // Spellings that differ by case merge: the preset wins, then the earliest piece.
  assert.equal(categoryOf(items, "Oxford shirt"), "Shirts");
  assert.equal(categoryOf(items, "Silk scarf"), "Scarves");
  assert.equal(categoryOf(items, "Wool scarf"), "Scarves");
  // Untidy names saved when the API only trimmed them are tidied first.
  assert.equal(categoryOf(items, "Linen suit"), "Pant coat");
  assert.equal(categoryOf(items, "Tweed suit"), "Pant coat");
  // SQLite folds only ASCII letters, so these stay two categories.
  assert.equal(categoryOf(items, "Pashmina"), "Écharpes");
  assert.equal(categoryOf(items, "Cashmere wrap"), "écharpes");
  // Saved by the previous Worker after 0009: 0010 lists and respells them.
  assert.equal(categoryOf(items, "Block-print kurta"), "Kurtas");
  assert.equal(categoryOf(items, "Cotton dupatta"), "Dupattas");

  const categories = await listCategories();
  assert.deepEqual(
    categories.map((category) => category.name),
    // Names equal case-insensitively keep their code-point order.
    [...PRESET_CATEGORIES, "Scarves", "Écharpes", "écharpes", "Dupattas"].sort().sort(byName),
    "sorted by name, case-insensitively",
  );
  assert.deepEqual(counts(categories), {
    ...Object.fromEntries(PRESET_CATEGORIES.map((name) => [name, 0])),
    Shirts: 1,
    "Pant coat": 2,
    Kurtas: 1,
    Scarves: 2,
    Écharpes: 1,
    écharpes: 1,
    Dupattas: 1,
  });
});

test("sessions older than a day are renewed; the 90-day cap holds", async () => {
  const secrets = { passwordHash: SECRETS.APP_PASSWORD_HASH, sessionSecret: SECRETS.SESSION_SECRET };
  const now = Math.floor(Date.now() / 1000);

  const fresh = await send("/api/items", { headers: withSession() });
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.get("set-cookie"), null, "a fresh session is not re-issued");
  await fresh.arrayBuffer();

  const old = await createSessionToken(secrets, now - 2 * DAY, now - 2 * DAY);
  const renewed = await send("/api/items", { headers: { Cookie: `trove_session=${old.token}` } });
  assert.equal(renewed.status, 200);
  await renewed.arrayBuffer();
  const setCookie = renewed.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /^trove_session=v1\.[^;]+; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax$/);
  const payload = await verifySessionToken(setCookie.split(";")[0].slice("trove_session=".length), secrets);
  assert.ok(payload, "the renewed token is valid");
  assert.equal(payload.auth, now - 2 * DAY, "renewal keeps the original login time");
  assert.ok(payload.iat >= now);

  // Renewed yesterday, but first signed in 91 days ago: sign in again.
  const capped = await createSessionToken(secrets, now - DAY, now - 91 * DAY);
  const refused = await send("/api/items", { headers: { Cookie: `trove_session=${capped.token}` } });
  await assertJsonError(refused, 401, "unauthenticated");
});

test("signed-in visitors skip the login page", async () => {
  const response = await send("/login", { headers: withSession() });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
});

test("the app page carries a CSP nonce on every script", async () => {
  const response = await send("/", {
    headers: withSession({ Accept: "text/html", "Sec-Fetch-Mode": "navigate" }),
  });
  assert.equal(response.status, 200);
  const csp = response.headers.get("content-security-policy") ?? "";
  const nonce = /script-src 'self' 'nonce-([A-Za-z0-9_-]+)' 'strict-dynamic'/.exec(csp)?.[1];
  assert.ok(nonce, csp);
  for (const directive of [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ]) {
    assert.ok(csp.includes(directive), directive);
  }

  const html = await response.text();
  const scripts = html.match(/<script\b[^>]*>/g) ?? [];
  assert.ok(scripts.length > 0, "the page has scripts");
  for (const tag of scripts) {
    assert.ok(tag.includes(`nonce="${nonce}"`), `script without the nonce: ${tag}`);
  }

  // Fonts are self-hosted: the CSP (font-src 'self') would block Google's CDN.
  assert.ok(csp.includes("font-src 'self'"), csp);
  assert.match(html, /_vinext_fonts\/dm-sans-[^"')]+\.woff2/);
  assert.match(html, /_vinext_fonts\/dm-serif-display-[^"')]+\.woff2/);
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
});

test("tampered or unknown session cookies are rejected", async () => {
  const [name, token] = sessionCookie.split("=");
  const [version, body, signature] = token.split(".");
  const tampered = `${name}=${version}.${body}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;

  const response = await send("/api/items", { headers: { Cookie: tampered } });
  await assertJsonError(response, 401, "unauthenticated");
  // The bad cookie is cleared.
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);

  const otherName = await send("/api/items", { headers: { Cookie: `__Host-trove_session=${token}` } });
  await assertJsonError(otherName, 401, "unauthenticated");
});

test("cross-origin writes are rejected even with a session", async () => {
  // Repeated: a rejected body must be drained, or the next request on the
  // same connection fails instead of getting its 403.
  for (let round = 1; round <= 3; round += 1) {
    const crossSite = await send("/api/outfits", {
      method: "POST",
      headers: withSession({
        Origin: "https://evil.example",
        "Sec-Fetch-Site": "cross-site",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ name: "Heist", itemIds: [1] }),
    });
    await assertJsonError(crossSite, 403, "cross_origin");

    const wrongOrigin = await send("/api/items/1", {
      method: "DELETE",
      headers: withSession({ Origin: "http://localhost:1" }),
    });
    await assertJsonError(wrongOrigin, 403, "cross_origin");
  }
});

test("invalid outfits get a specific 400", async () => {
  const post = (body, contentType = "application/json") =>
    send("/api/outfits", {
      method: "POST",
      headers: withSession(sameOrigin({ "Content-Type": contentType })),
      body,
    });

  await assertJsonError(await post(JSON.stringify({ name: "Weekend", itemIds: [] })), 400, "invalid_input");
  await assertJsonError(await post(JSON.stringify({ name: "", itemIds: [1] })), 400, "invalid_input");
  await assertJsonError(await post(JSON.stringify({ name: "Weekend", itemIds: [1, 1] })), 400, "invalid_input");
  await assertJsonError(
    await post(JSON.stringify({ name: "Weekend", itemIds: Array.from({ length: 21 }, (_, i) => i + 1) })),
    400,
    "invalid_input",
  );
  await assertJsonError(
    await post(JSON.stringify({ name: "Weekend", occasion: "Gala", itemIds: [1] })),
    400,
    "invalid_input",
  );
  const missing = await assertJsonError(
    await post(JSON.stringify({ name: "Weekend", itemIds: [424242] })),
    400,
    "invalid_input",
  );
  assert.match(missing.error, /no longer exist/);
  await assertJsonError(await post("{not json"), 400, "invalid_input");
  await assertJsonError(await post("[]"), 400, "invalid_input");
  await assertJsonError(await post("name=Weekend", "text/plain"), 415, "unsupported_media_type");

  const patch = await send("/api/outfits/424242", {
    method: "PATCH",
    headers: withSession(sameOrigin({ "Content-Type": "application/json" })),
    body: JSON.stringify({ name: "Renamed" }),
  });
  await assertJsonError(patch, 404, "not_found");

  const remove = await send("/api/outfits/424242", {
    method: "DELETE",
    headers: withSession(sameOrigin()),
  });
  await assertJsonError(remove, 404, "not_found");
});

test("uploads validate input and storage before any image processing", async () => {
  const upload = (fields, image) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    if (image) form.set("image", new Blob([image.bytes], { type: image.type }), image.name);
    return send("/api/items", { method: "POST", headers: withSession(sameOrigin()), body: form });
  };
  const png = { bytes: TINY_PNG, type: "image/png", name: "shirt.png" };

  await assertJsonError(await upload({ name: "", category: "Shirts" }, png), 400, "invalid_input");
  await assertJsonError(await upload({ name: "Shirt", category: "all" }, png), 400, "invalid_input");
  await assertJsonError(await upload({ name: "Shirt", category: "Shirts" }), 400, "invalid_input");
  await assertJsonError(
    await upload(
      { name: "Shirt", category: "Shirts" },
      { bytes: Buffer.from("<svg></svg>"), type: "image/png", name: "fake.png" },
    ),
    400,
    "unsupported_image",
  );

  const oversized = Buffer.concat([TINY_PNG, Buffer.alloc(10 * 1024 * 1024)]);
  await assertJsonError(
    await upload({ name: "Shirt", category: "Shirts" }, { bytes: oversized, type: "image/png", name: "big.png" }),
    413,
    "too_large",
  );

  // Above vinext's Server Action limit (12 MB): still a JSON 413.
  const huge = Buffer.concat([TINY_PNG, Buffer.alloc(13 * 1024 * 1024)]);
  await assertJsonError(
    await upload({ name: "Shirt", category: "Shirts" }, { bytes: huge, type: "image/png", name: "huge.png" }),
    413,
    "too_large",
  );

  // Valid photo, but Backblaze is not configured: 503 before Cloudflare Images.
  await assertJsonError(
    await upload({ name: "Shirt", category: "shirts" }, png),
    503,
    "storage_unavailable",
  );
  // A new category joins the list only with a saved piece.
  await assertJsonError(
    await upload({ name: "Kaftan", category: "Kaftans" }, png),
    503,
    "storage_unavailable",
  );
  assert.ok(!(await listCategories()).some((category) => category.name === "Kaftans"));

  const json = await send("/api/items", {
    method: "POST",
    headers: withSession(sameOrigin({ "Content-Type": "application/json" })),
    body: "{}",
  });
  await assertJsonError(json, 415, "unsupported_media_type");

  const missingPhoto = await send("/api/images/424242?size=thumb", { headers: withSession() });
  await assertJsonError(missingPhoto, 404, "not_found");
  const badSize = await send("/api/images/1?size=huge", { headers: withSession() });
  await assertJsonError(badSize, 400, "invalid_input");
  const deleteMissing = await send("/api/items/424242", {
    method: "DELETE",
    headers: withSession(sameOrigin()),
  });
  await assertJsonError(deleteMissing, 404, "not_found");
});

function postCategory(body, contentType = "application/json") {
  return send("/api/categories", {
    method: "POST",
    headers: withSession(sameOrigin({ "Content-Type": contentType })),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deleteCategory(name) {
  return send(`/api/categories/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: withSession(sameOrigin()),
  });
}

function patchItem(id, fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return send(`/api/items/${id}`, { method: "PATCH", headers: withSession(sameOrigin()), body: form });
}

test("categories can be added: tidied, unique case-insensitively, never \"All\"", async () => {
  const created = await postCategory({ name: "  Linen \t  sets " });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  assert.deepEqual(await created.json(), { category: { name: "Linen sets", count: 0 } });

  const longest = "x".repeat(40);
  assert.equal((await postCategory({ name: longest })).status, 201);

  const again = await assertJsonError(await postCategory({ name: "LINEN SETS" }), 409, "duplicate");
  assert.match(again.error, /"Linen sets"/);
  const preset = await assertJsonError(await postCategory({ name: "shirts" }), 409, "duplicate");
  assert.match(preset.error, /"Shirts"/);

  for (const name of ["All", "all", "", "   ", "x".repeat(41), "..", 7, null]) {
    await assertJsonError(await postCategory({ name }), 400, "invalid_input");
  }
  await assertJsonError(await postCategory({}), 400, "invalid_input");
  await assertJsonError(await postCategory("{not json"), 400, "invalid_input");
  await assertJsonError(await postCategory("name=Linen", "text/plain"), 415, "unsupported_media_type");

  const categories = await listCategories();
  assert.equal(counts(categories)["Linen sets"], 0, "listed with no pieces");
  assert.deepEqual(
    categories.map((category) => category.name),
    categories.map((category) => category.name).sort(byName),
  );
  assert.equal((await deleteCategory(longest)).status, 200);
});

test("deleting a category moves its pieces to Uncategorized", async () => {
  // No pieces: nothing moves and Uncategorized is not needed.
  const empty = await deleteCategory("Linen sets");
  assert.equal(empty.status, 200);
  // vinext widens a DELETE handler's Cache-Control; no-store survives.
  assert.match(empty.headers.get("cache-control") ?? "", /\bno-store\b/);
  assert.deepEqual(await empty.json(), { ok: true, moved: 0 });
  let categories = counts(await listCategories());
  assert.equal(categories["Linen sets"], undefined);
  assert.equal(categories[UNCATEGORIZED], undefined);

  // Matched case-insensitively.
  const scarves = await deleteCategory("scarves");
  assert.equal(scarves.status, 200);
  assert.deepEqual(await scarves.json(), { ok: true, moved: 2 });
  categories = counts(await listCategories());
  assert.equal(categories.Scarves, undefined);
  assert.equal(categories[UNCATEGORIZED], 2);
  assert.equal(categories.Shirts, 1, "other categories keep their pieces");
  const items = await listItems();
  assert.equal(categoryOf(items, "Silk scarf"), UNCATEGORIZED);
  assert.equal(categoryOf(items, "Wool scarf"), UNCATEGORIZED);
  assert.equal(categoryOf(items, "Oxford shirt"), "Shirts");

  await assertJsonError(await deleteCategory("Scarves"), 404, "not_found");
  await assertJsonError(await deleteCategory("No such category"), 404, "not_found");

  const full = await assertJsonError(await deleteCategory("uncategorized"), 409, "not_empty");
  assert.equal(full.error, "Move these pieces to another category first.");
  assert.equal(counts(await listCategories())[UNCATEGORIZED], 2);

  // Names that need URL encoding.
  for (const name of ["Tops/Blouses", "100% cotton", "Tops/Blouses 100%", "50%25 off", "Q&A #1?"]) {
    assert.equal((await postCategory({ name })).status, 201, name);
    const removed = await deleteCategory(name);
    assert.equal(removed.status, 200, name);
    assert.deepEqual(await removed.json(), { ok: true, moved: 0 }, name);
  }
});

test("editing a piece's category uses the listed spelling or adds the category", async () => {
  const items = await listItems();
  const silk = items.find((item) => item.name === "Silk scarf");
  const wool = items.find((item) => item.name === "Wool scarf");

  const listed = await patchItem(wool.id, { category: "SHIRTS" });
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).item.category, "Shirts");

  const added = await patchItem(silk.id, { category: "  Stoles " });
  assert.equal(added.status, 200);
  const item = (await added.json()).item;
  assert.equal(item.category, "Stoles");
  assert.equal(item.season, undefined);

  let categories = counts(await listCategories());
  assert.equal(categories.Shirts, 2);
  assert.equal(categories.Stoles, 1);
  assert.equal(categories[UNCATEGORIZED], 0);

  // Empty now, so Uncategorized can go too.
  const emptied = await deleteCategory(UNCATEGORIZED);
  assert.equal(emptied.status, 200);
  assert.deepEqual(await emptied.json(), { ok: true, moved: 0 });
  assert.equal(counts(await listCategories())[UNCATEGORIZED], undefined);

  await assertJsonError(await patchItem(silk.id, { category: "All" }), 400, "invalid_input");
  // Seasons are gone: the field is ignored, leaving nothing to update.
  await assertJsonError(await patchItem(silk.id, { season: "Winter" }), 400, "invalid_input");
  // A failed edit adds no category.
  await assertJsonError(await patchItem(424242, { category: "Ghosts" }), 404, "not_found");
  categories = counts(await listCategories());
  assert.equal(categories.Ghosts, undefined);
});

test("a category's exact name wins over another spelling of it", async () => {
  // "écharpes" also matches "Écharpes" case-insensitively, but it is listed.
  const wrap = (await listItems()).find((item) => item.name === "Cashmere wrap");
  const kept = await patchItem(wrap.id, { category: "écharpes" });
  assert.equal(kept.status, 200);
  assert.equal((await kept.json()).item.category, "écharpes");

  const removed = await deleteCategory("écharpes");
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { ok: true, moved: 1 });
  const categories = counts(await listCategories());
  assert.equal(categories.écharpes, undefined);
  assert.equal(categories.Écharpes, 1);
  assert.equal(categories[UNCATEGORIZED], 1);
  const items = await listItems();
  assert.equal(categoryOf(items, "Pashmina"), "Écharpes");
  assert.equal(categoryOf(items, "Cashmere wrap"), UNCATEGORIZED);
});

test("the categories API needs a session, and writes need the same origin", async () => {
  await assertJsonError(await send("/api/categories"), 401, "unauthenticated");
  const anonymousPost = await send("/api/categories", {
    method: "POST",
    headers: sameOrigin({ "Content-Type": "application/json" }),
    body: JSON.stringify({ name: "Hats" }),
  });
  await assertJsonError(anonymousPost, 401, "unauthenticated");
  const anonymousDelete = await send("/api/categories/Shirts", { method: "DELETE", headers: sameOrigin() });
  await assertJsonError(anonymousDelete, 401, "unauthenticated");

  const crossSite = { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" };
  const crossPost = await send("/api/categories", {
    method: "POST",
    headers: withSession({ ...crossSite, "Content-Type": "application/json" }),
    body: JSON.stringify({ name: "Hats" }),
  });
  await assertJsonError(crossPost, 403, "cross_origin");
  const crossDelete = await send("/api/categories/Shirts", {
    method: "DELETE",
    headers: withSession(crossSite),
  });
  await assertJsonError(crossDelete, 403, "cross_origin");

  const categories = counts(await listCategories());
  assert.equal(categories.Hats, undefined);
  assert.equal(categories.Shirts, 2);
});

test("logout expires the cookie and clears site data", async () => {
  const response = await send("/api/auth/logout", {
    method: "POST",
    headers: withSession(sameOrigin()),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("clear-site-data"), '"cache", "storage"');
  assert.equal(response.headers.get("cache-control"), "no-store");

  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 2, cookies.join(" | "));
  assert.ok(cookies.some((cookie) => cookie.startsWith("__Host-trove_session=;")));
  assert.ok(cookies.some((cookie) => cookie.startsWith("trove_session=;")));
  assert.ok(cookies.every((cookie) => /Max-Age=0/.test(cookie)));
});
