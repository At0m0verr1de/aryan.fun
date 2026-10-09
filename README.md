# made by aryan ✨

Small, silly, playable things at **https://madebyaryan.pages.dev**.

Static Astro site on Cloudflare Pages, with Supabase for accounts, data, and realtime.
Every toy is a folder; the homepage builds itself from those folders.

## Run it

```bash
npm install          # .npmrc pins the public npm registry
cp .env.example .env # fill in your Supabase URL + anon key
npm run dev          # http://localhost:4321
npm test             # unit tests (parser, scoring)
supabase/tests/run.sh  # database security tests (needs a Postgres container, see below)
```

Database tests run the migrations against plain Postgres with a stubbed `auth` schema:

```bash
docker run -d --name pg-wordle-test -e POSTGRES_PASSWORD=test postgres:16-alpine
supabase/tests/run.sh
```

## One-time setup

### 1. Supabase
1. Create a project at supabase.com, region **South Asia (Mumbai)**.
2. **Authentication → Sign In / Providers → Google: on** (client ID + secret from a Google Cloud OAuth client, redirect URI `https://<project>.supabase.co/auth/v1/callback`). **URL Configuration:** Site URL `https://madebyaryan.pages.dev`; Redirect URLs `https://madebyaryan.pages.dev/**`, `https://*.madebyaryan.pages.dev/**`, `http://localhost:4321/**`.
3. **SQL Editor:** run each file in `supabase/migrations/` in filename order.
   (Or with the CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.)
4. **Project Settings → API:** copy the Project URL and the `anon` key into `.env`.
   Never use the `service_role` key in this repo.

### 2. Cloudflare Pages
1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**, pick the repo.
3. Project name **madebyaryan**, build command `npm run build`, output directory `dist`.
4. Environment variables: `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `NODE_VERSION=22`.
5. Every push to `main` deploys; every PR gets a preview URL.

## Adding a toy

1. `src/toys/<slug>/meta.ts` exporting `meta: ToyMeta` (see `src/shared/toy.ts`).
2. `src/pages/<slug>.astro` using `Layout` from `src/shared/Layout.astro` with `back`.
3. Toy code lives next to `meta.ts`. Shared bits: `src/shared/supabase.js` (`supabase`, `ensureSession`), `theme.css`.
4. Need data?
   - Scores/leaderboards: insert into `public.scores` with `toy = '<slug>'`.
   - Counters (plays, likes): `supabase.rpc('bump_counter', { p_toy, p_key })`.
   - Anything else: a new migration with tables named `<toy>_*` and RLS on every table.

The homepage picks the toy up automatically. Set `hidden: true` in `meta` while it's a work in progress.

## Toys

| Toy | What |
|---|---|
| [Wordle Duo](src/toys/wordle-duo) | Private rooms for two. Upload Wordle screenshots (read in the browser), no-spoiler rule enforced by the database, live updates. |
