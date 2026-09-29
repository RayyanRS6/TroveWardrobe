# Trove: personal Cloudflare + Backblaze setup

Trove uses only services that can run without a payment card:

| Service | Purpose | Safety behavior |
| --- | --- | --- |
| Cloudflare Workers Free | React app and private API | Stops at the free daily request limit |
| Cloudflare D1 Free | Clothes, categories, outfits, and B2 object metadata | Stops at free limits |
| Cloudflare Images Free | Resizes and converts each uploaded photo once | Rejects new transformations at the free limit; no overage charge |
| Backblaze B2 | Private encrypted image objects | First 10 GB free; app stops uploads at 9 GB |
| Cloudflare Access | Email login and default-deny privacy | Worker also fails closed without identity |

Cloudflare Images converts each accepted upload to a 1600px WebP before it is
stored in B2. Images are never stored in D1. D1 stores a random B2 object key,
the exact B2 version ID, MIME type, and byte size. Saving the version ID lets Trove
permanently delete the exact B2 object rather than leaving a hidden version that
continues to consume storage.

## Current provisioning status

- D1 database `trove-wardrobe`: created in APAC; migrations 0000-0005 applied.
- Backblaze B2 private bucket `meeru-trove-wardrobe-images`: created and
  configured with encryption.
- Restricted B2 application key ID: configured; secret still needs to be stored
  with Wrangler.
- Worker deployment: intentionally disabled until B2 and Access are configured.
- Cloudflare Images Free binding: configured for upload-time optimization.
- No R2 subscription is required.

## 1. Create the private B2 bucket

1. Create or sign in to your personal Backblaze account and enable **B2 Cloud
   Storage**. Skip payment information.
2. Create a bucket with a globally unique name.
3. Select **Private**. Never make the wardrobe bucket public.
4. Enable Backblaze-managed server-side encryption (SSE-B2/AES-256).
5. Leave Object Lock disabled so clothes can be deleted normally.
6. Open **Lifecycle Settings** and choose **Keep only the last version**. Trove
   permanently deletes exact versions, while this rule protects against orphaned
   versions after an interrupted request.
7. Copy the bucket's S3 endpoint, such as
   `s3.us-west-004.backblazeb2.com`.

## 2. Create a restricted application key

1. Open **Application Keys** in Backblaze.
2. Create a new key restricted to only the wardrobe bucket.
3. Give it read and write access, including listing, uploading, downloading, and
   deleting files. Do not use the account master key.
4. Save the displayed **keyID** and **applicationKey**. Backblaze shows the
   application key only once.

Do not paste the application key into chat, source code, `wrangler.jsonc`, or
GitHub.

## 3. Configure non-secret values

The following non-secret values are configured in `wrangler.jsonc`:

```jsonc
"B2_ENDPOINT": "s3.eu-central-003.backblazeb2.com",
"B2_BUCKET_NAME": "meeru-trove-wardrobe-images",
"B2_APPLICATION_KEY_ID": "003fc236fc3f0d00000000002"
```

Keep `B2_STORAGE_LIMIT_BYTES` at `9000000000`. It is intentionally below B2's
10 GB allowance and is calculated across every wardrobe owner in D1.

## 4. Store the secret securely

Run this command and paste the Backblaze application key only into Wrangler's
hidden interactive prompt:

```bash
npx wrangler secret put B2_APPLICATION_KEY --config wrangler.jsonc
```

For local image uploads only, copy `.env.example` to `.env` and put the
Backblaze values there. `.env` is ignored by Git.

## 5. Apply D1 migrations and validate

```bash
npm run cf:types
npm run cf:d1:migrate
npm run lint
npx tsc --noEmit
npm test
npx wrangler deploy --dry-run --config wrangler.jsonc
```

The Images Free plan currently allows 5,000 unique transformations each month.
Trove performs one transformation when a photo is uploaded and does not
transform it again during normal app loads. If the free limit is reached,
Cloudflare rejects the upload instead of charging an overage.

## 6. Protect and publish

Keep `workers_dev` and preview URLs disabled until Cloudflare Access permits only
your personal email. The Worker separately calls `ctx.access.getIdentity()` and
returns `403` when Cloudflare does not provide a verified identity.

After Access is configured, enable the `workers.dev` route, deploy, and verify:

- a signed-out request cannot load HTML, API data, or images;
- your authorized email can add, load, and permanently delete an image;
- the B2 bucket remains private;
- the D1 row contains only metadata, not image bytes.

## Caching and request use

The API loads small metadata records from D1. Already-optimized images are
streamed from private B2 through the authenticated Worker. Image URLs are
versioned and returned with
`private, max-age=31536000, immutable`; lazy loading and the local service-worker
cache mean repeat views normally use the device copy instead of B2.

## Backups

Export D1 with:

```bash
npx wrangler d1 export trove-wardrobe --remote --output backup.sql
```

Copy the B2 bucket periodically with an S3-compatible backup tool. Keep backups
outside Git because they contain personal wardrobe data.
