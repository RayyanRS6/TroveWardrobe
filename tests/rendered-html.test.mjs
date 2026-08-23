import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("build produces the Cloudflare Worker and mobile assets", async () => {
  await Promise.all([
    access("dist/server/index.js"),
    access("dist/client/manifest.webmanifest"),
    access("dist/client/sw.js"),
  ]);
});

test("deployment config binds private wardrobe storage", async () => {
  const config = JSON.parse(await readFile("wrangler.jsonc", "utf8"));

  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.access.dev.identity.email, "local@trove.app");
  assert.equal(config.d1_databases[0].binding, "DB");
  assert.equal(config.r2_buckets[0].binding, "WARDROBE_IMAGES");
  assert.equal(config.r2_buckets[0].bucket_name, "trove-wardrobe-images");
  assert.equal(config.images.binding, "IMAGES");
});

test("production requests fail closed without Cloudflare Access", async () => {
  const [worker, store] = await Promise.all([
    readFile("worker/index.ts", "utf8"),
    readFile("app/lib/wardrobe-store.ts", "utf8"),
  ]);

  assert.match(worker, /ctx\.access\?\.getIdentity\(\)/);
  assert.match(worker, /Cloudflare Access authentication is required/);
  assert.doesNotMatch(worker, /hostname === "localhost"/);
  assert.doesNotMatch(worker, /AUTH_BYPASS_EMAIL/);
  assert.doesNotMatch(store, /AUTH_BYPASS_EMAIL/);
});
