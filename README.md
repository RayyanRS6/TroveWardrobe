# Trove Wardrobe

Trove is a mobile-first wardrobe organizer built with React, Next.js-compatible
vinext, and Cloudflare Workers.

## Architecture

- Cloudflare Workers hosts the web app and API.
- D1 stores clothing, custom categories, outfits, and private B2 object metadata.
- A private Backblaze B2 bucket stores encrypted clothing photos.
- Cloudflare Images converts each upload to a 1600px WebP before B2 storage.
- The Worker signs B2 S3 requests; B2 credentials never reach the browser.
- Worker-level Cloudflare Access protects the app and its API.
- Browser caching, lazy loading, IndexedDB, and the service worker reduce repeat
  database and image requests.

## Local development

```bash
npm install
npm run dev
```

Local requests use `local@trove.app` as a development-only owner. Production
requests fail closed unless Cloudflare Access provides a verified identity.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm test
npx wrangler deploy --dry-run --config wrangler.jsonc
```

## Personal Cloudflare deployment

See [CLOUDFLARE_SETUP.md](./CLOUDFLARE_SETUP.md). The deployed app uses the
free `trove-wardrobe.<account-subdomain>.workers.dev` hostname, so a purchased
domain is optional.

## Backups

GitHub stores the source code, not uploaded wardrobe data. Export D1 and copy
B2 objects periodically as described in the setup guide.
