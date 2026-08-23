# Move Trove to your own Cloudflare account

This project is ready to run completely in a Cloudflare account that you own.
Use a personal email address that you control, rather than a company email.

## What is stored where

| Cloudflare product | Trove data |
| --- | --- |
| D1 | clothing names, colours, categories, seasons, outfits, and image metadata |
| R2 | private original clothing images |
| Cloudflare Images binding | cached WebP thumbnails generated from R2 originals |
| Cloudflare Access | your email sign-in and app privacy |
| Workers | the web app and its API |

Images are never put into D1. The original is stored once in R2. Grid images
are requested as `/api/images/:id?w=640`; the Worker creates one optimized WebP
variant and caches it. The original stays private and is only available after
the user ownership check.

## One-time Cloudflare setup

1. Create or sign in to a personal Cloudflare account.
2. Add a domain that you own to Cloudflare. Pick a subdomain such as
   `trove.yourdomain.com` for the app.
3. In **R2 Object Storage**, create a bucket named `trove-wardrobe-images`.
   Do not make the bucket public.
4. In **Workers & Pages > D1**, create a database named `trove-wardrobe`.
   Copy its database ID into `wrangler.jsonc`, replacing
   `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
5. In **Cloudflare Zero Trust > Access > Applications**, create a Self-hosted
   application for `trove.yourdomain.com/*`. Add an Allow policy for your
   personal email address. Cloudflare Access sends the authenticated email to
   the app and the app uses it as the data owner.
6. In `wrangler.jsonc`, add a Worker route for your domain. For example:

   ```jsonc
   "routes": [
     {
       "pattern": "trove.yourdomain.com/*",
       "zone_name": "yourdomain.com"
     }
   ],
   ```

   `workers_dev` is deliberately disabled so nobody can bypass Access by using
   a public `workers.dev` address.
7. In a terminal, sign in to your own Cloudflare account with
   `npx wrangler login`, then run:

   ```bash
   npm run cf:d1:migrate
   npm run cf:deploy
   ```

## Image transformations

The `IMAGES` Worker binding is already declared in `wrangler.jsonc`. Cloudflare
Images Free currently includes transformations for images stored in R2; it does
not move the originals out of your private R2 bucket. Trove uses only five
fixed widths (160, 320, 640, 960, 1600) so the number of unique transformations
stays predictable.

## Local development

Local development uses a temporary local owner only. It is configured in
`vite.config.ts` and is not present in `wrangler.jsonc`, so it is never part of
the deployed app. Production requires Cloudflare Access to supply an email.

## Ownership and recovery

The Cloudflare account that creates the D1 database, R2 bucket, domain route,
and Access application owns the application data. Keep that account recovery
email, payment method, and Cloudflare backup codes under your control. Export
your D1 data and download your R2 bucket periodically as a separate backup.
