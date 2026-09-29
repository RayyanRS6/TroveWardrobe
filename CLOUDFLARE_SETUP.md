# Deploying Trove to Cloudflare + Backblaze

Trove runs entirely on free plans that stop at their limits instead of billing:

| Service | Purpose | At the free limit |
| --- | --- | --- |
| Cloudflare Workers Free | App, API and password gate (100,000 requests/day) | Requests fail until 00:00 UTC |
| Cloudflare D1 Free | Item and outfit details, login throttling (5 GB) | Queries fail until the next day |
| Cloudflare Images Free | Resizes each upload (5,000 unique transformations/month) | New uploads are rejected; no charge |
| Backblaze B2 | Private photo storage (first 10 GB free; Trove stops at 9 GB) | Trove refuses new uploads |

Each photo uses two Images transformations (full size and thumbnail), so the
free plan covers about 2,500 uploads a month.

## 1. One-time setup

1. **Cloudflare:** sign in on this computer with `npx wrangler login`.
2. **Database:** the D1 database `trove-wardrobe` is referenced in
   `wrangler.jsonc`. On a new Cloudflare account, create one with
   `npx wrangler d1 create trove-wardrobe` and put its `database_id` there.
3. **Backblaze bucket:** in Backblaze, open **B2 Cloud Storage > Buckets >
   Create a Bucket**. Set files to **Private**, encryption **Enabled** and
   Object Lock **Disabled**. Under **Lifecycle Settings**, choose **Keep only
   the last version**. Note the bucket's **Endpoint**.
4. **Backblaze key:** **Application Keys > Add a New Application Key**,
   restricted to that bucket, **Read and Write**. Backblaze shows the
   `applicationKey` only once.
5. **`.env`:** copy `.env.example` to `.env` and fill in the four `B2_*`
   values. Never paste them into chat, source code or GitHub.

## 2. First deploy

```bash
npm run db:migrate:remote
npm run deploy:first
```

`deploy:first` asks for the password you will use to open the app (twice,
hidden), then deploys the Worker together with its secrets: the password hash,
a new session secret and the Backblaze values from `.env`. Wrangler prints the
app's `https://trove.<your-subdomain>.workers.dev` URL. The first deploy on a
Cloudflare account asks you to register that subdomain (it becomes part of
every Worker URL on the account).

## 3. Later deploys and changes

| Task | Command |
| --- | --- |
| Deploy new code | `npm run deploy` |
| Apply new database migrations | `npm run db:migrate:remote` |
| Change the app password (signs out every device) | `npm run set-password -- --production` |
| Replace the Backblaze key | Update `.env`, then `npm run set-password -- --production` |

## Security model

- Every page and API route requires a session cookie signed with
  `SESSION_SECRET` (`HttpOnly`, `Secure`, `SameSite=Lax`, 30 days, renewed while
  you use the app, re-login after 90 days).
- Only a PBKDF2 hash of the password is stored, as a Worker secret. Five wrong
  attempts from one network lock it out for a minute, doubling per further
  failure (up to a day).
- Requests that change data must come from the app's own origin.
- Logging out clears the cookie, the offline copy, the photo cache and the
  browser cache for the site.
- The Backblaze bucket is private; the key is restricted to that one bucket
  and is only known to the Worker.
- This repository is public, so it contains only placeholders; real values live
  in `.env` (ignored by Git) and in Cloudflare's write-only secret store.

## Troubleshooting

- **Locked out after wrong passwords:** wait for the lock to expire, or clear
  it with
  `npx wrangler d1 execute trove-wardrobe --remote --command "DELETE FROM auth_throttle"`.
- **Forgot the password:** set a new one with
  `npm run set-password -- --production`.
- **Uploads fail with a storage error:** check that the four `B2_*` secrets
  belong to the same Backblaze key and bucket, then rerun
  `npm run set-password -- --production`.

## Backups

GitHub stores only code. Export your wardrobe data periodically and keep the
files outside the repository (they contain personal data; `*.sql` files are
ignored by Git):

```bash
npx wrangler d1 export trove-wardrobe --remote --output trove-backup.sql
```

Copy the photos with any S3-compatible tool (for example `rclone`) using a
read-only Backblaze key.
