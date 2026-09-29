# Trove Wardrobe

Trove is a private, mobile-first wardrobe organizer: photograph your clothes,
tag them by category, colour and season, and combine them into outfits. It is a
single-user app locked behind one password.

## Tech stack

| Layer | Technology |
| --- | --- |
| UI | React 19 + TypeScript, plain CSS (light and dark themes), lucide-react icons |
| Framework | Next.js App Router API via [vinext](https://github.com/cloudflare/vinext) 1.0 on Vite 8 |
| Hosting | Cloudflare Workers (free plan, `workers.dev` URL) |
| Database | Cloudflare D1 (SQLite); schema and migrations with Drizzle ORM |
| Photos | Private Backblaze B2 bucket (S3 API, signed by the Worker with aws4fetch) |
| Image resizing | Cloudflare Images binding: a 1600px WebP and a 480px thumbnail per photo |
| Lock | App password: PBKDF2 hash + HMAC-signed session cookie, login throttling |
| Offline | Service worker + IndexedDB copy of your wardrobe (wiped on logout) |

## How it fits together

- The Worker (`worker/index.ts`) checks the session cookie on every page and
  API request. Without one, pages redirect to `/login` and the API returns 401.
- Built JS/CSS, icons and the service worker are served directly by
  Cloudflare's static assets layer; they contain no wardrobe data.
- D1 stores item and outfit details plus the B2 object keys. Photos never
  touch D1 and the B2 bucket is private; the Worker streams them to you.
- Everything runs on free tiers that stop at their limits instead of billing.

## Local development

Requirements: Node.js 22+ and a `.env` file (copy `.env.example`).

```bash
npm install
npm run set-password
npm run dev
```

`npm run set-password` stores a hash of a local-only password in `.env`
(`-- --generate` creates a random one). `npm run dev` applies local database
migrations, then serves the app at http://localhost:5173. Local data lives in
`.wrangler/`; photo uploads use the Backblaze bucket configured in `.env`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Local dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Build, then run the production Worker locally |
| `npm test` | Build, then run auth unit tests and Worker integration tests |
| `npm run lint` | ESLint |
| `npm run icons` | Re-render app icons from `public/icons/icon.svg` (and `icon-small.svg` for the favicon) |
| `npm run db:generate` | Create a migration after editing `db/schema.ts` |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply migrations locally / in production |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run set-password -- --production` | Set the live password (see below) |

## Deploying

See [CLOUDFLARE_SETUP.md](./CLOUDFLARE_SETUP.md).

## Backups

GitHub holds the code, not your wardrobe. Export the database and copy the B2
bucket periodically, as described in the setup guide.
