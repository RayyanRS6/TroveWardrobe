# Trove on your personal Cloudflare account

This project is configured for the Cloudflare account you authenticated with
Wrangler. It no longer contains the previous Sites project metadata or company
Git remote.

## Data layout

| Service | Purpose |
| --- | --- |
| Workers | React application and API |
| D1 | Clothing names, categories, outfits, and image metadata |
| R2 | Private original clothing images |
| Images binding | Cached WebP image variants generated from R2 |
| Worker-level Access | Email login and default-deny privacy |

The R2 bucket must remain private. Do not enable an `r2.dev` public URL.

## Provisioning status

- D1 database `trove-wardrobe`: created in APAC and migrated.
- R2 bucket `trove-wardrobe-images`: pending one-time R2 activation.
- Worker `trove-wardrobe`: deploy only after R2 is active.
- `workers.dev`: keep disabled until Worker-level Access protects all traffic.

## Finish provisioning

1. Open the Cloudflare dashboard for your personal account.
2. Go to **Storage & databases > R2 Object Storage**.
3. Select **Enable R2**. Cloudflare may ask you to accept R2 pricing or add a
   payment method even though usage starts within the free tier.
4. Do not create a public bucket or enable an `r2.dev` URL.
5. Return to Codex and say **R2 enabled**.

Codex will then create the private bucket, upload the no-route Worker, enable
Worker-level Access for all traffic, enable the `workers.dev` hostname, deploy,
and verify authorized and unauthorized behavior.

## Useful commands

```bash
npm run cf:types
npm run cf:d1:migrate
npm run cf:deploy
```

## Backups

Export D1 with:

```bash
npx wrangler d1 export trove-wardrobe --remote --output backup.sql
```

R2 objects should be copied periodically with an S3-compatible backup tool.
Keep backup files outside the Git repository because they contain personal data.
