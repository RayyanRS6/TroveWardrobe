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
  assert.equal(config.r2_buckets, undefined);
  assert.equal(config.images.binding, "IMAGES");
  assert.equal(config.vars.B2_STORAGE_LIMIT_BYTES, "9000000000");
  assert.match(config.vars.B2_ENDPOINT, /^replace-with-/);
  assert.match(config.vars.B2_BUCKET_NAME, /^replace-with-/);
});

test("B2 integration keeps images private and deletes exact versions", async () => {
  const [storage, processing, schema] = await Promise.all([
    readFile("app/lib/b2-storage.ts", "utf8"),
    readFile("app/lib/image-processing.ts", "utf8"),
    readFile("db/schema.ts", "utf8"),
  ]);

  assert.match(storage, /service: "s3"/);
  assert.match(storage, /x-amz-server-side-encryption/);
  assert.match(storage, /versionId/);
  assert.match(storage, /B2_APPLICATION_KEY/);
  assert.match(processing, /env\.IMAGES\.input\(stream\)/);
  assert.match(processing, /width: 1600/);
  assert.match(processing, /format: OUTPUT_CONTENT_TYPE/);
  assert.match(schema, /imageVersion/);
  assert.match(schema, /imageSize/);
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
