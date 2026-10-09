# made by aryan ✨

Small, silly, playable things at **https://madebyaryan.aryanbakshi2021.workers.dev**.

Static Astro site on Cloudflare Workers (static assets), with Supabase for accounts, data, and realtime.

Partner-first: signed-out visitors see a locked door; people with a partner get a couple home with every game set up 1v1; everyone else invited gets general mode. Invite-only for now (add someone manually with `insert into public.site_access values ('<user id>')`).
Every toy is a folder; the homepage builds itself from those folders.

## Run it

```bash
npm install          # .npmrc pins the public npm registry
npm run dev          # http://localhost:4321
npm test             # unit tests (parser, word reading, scoring, worker)
supabase/tests/run.sh  # database security tests (needs a Postgres container, see below)
```

Database tests run the migrations against plain Postgres with a stubbed `auth` schema:

```bash
docker run -d --name pg-wordle-test -e POSTGRES_PASSWORD=test postgres:16-alpine
supabase/tests/run.sh
```

## One-time setup

### 1. Supabase
1. Create a project at supabase.com (this one is in Tokyo, `ap-northeast-1`).
2. **Authentication → Sign In / Providers → Google: on** (client ID + secret from a Google Cloud OAuth client, redirect URI `https://<project>.supabase.co/auth/v1/callback`). **URL Configuration:** Site URL `https://madebyaryan.aryanbakshi2021.workers.dev`; Redirect URLs `https://madebyaryan.aryanbakshi2021.workers.dev/**`, `https://*-madebyaryan.aryanbakshi2021.workers.dev/**` (preview URLs), `http://localhost:4321/**`.
3. **SQL Editor:** run each file in `supabase/migrations/` in filename order.
   (Or with the CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push`.)
4. **Project Settings → API:** the Project URL and publishable key live in `.env.production` (committed; both are public by design).
   Never use the `service_role` key in this repo.

### 2. Cloudflare Workers
1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Import a repository**, pick the repo, name it **madebyaryan**.
3. Build command `npm run build`, deploy command `npx wrangler deploy` (reads `wrangler.jsonc`: upload `dist/` as static assets, no server code).
4. No environment variables needed; the public Supabase values come from `.env.production`.
5. Every push to `main` deploys; other branches get preview URLs.

## Logs

Browser events (sign-ups, sign-ins, errors, toy actions) go to `/api/events`, a tiny Worker that writes them to
**Cloudflare → Workers & Pages → madebyaryan → Observability**. Filter by `event` (e.g. `account_created`, `error`)
or `user`. Free tier: 200k events/day; the client batches, dedupes errors, and caps events per page.

## Adding a toy

1. `src/toys/<slug>/meta.ts` exporting `meta: ToyMeta` (see `src/shared/toy.ts`; `accent` picks the card colour).
2. `src/pages/<slug>.astro` using `Layout` from `src/shared/Layout.astro` with `crumb={meta.title}`.
3. Toy code lives next to `meta.ts`. Shared bits: `src/shared/supabase.js` (`supabase`, `currentUser`, `onUserChange`, `signInWithGoogle`), `src/shared/telemetry.js` (`track`, `reportError`; add new event names to `worker/index.js`), `src/shared/icons.js`, `theme.css`. The site header (sign-in + profile menu) comes with `Layout`.
4. Need data?
   - Scores/leaderboards: insert into `public.scores` with `toy = '<slug>'`.
   - Counters (plays, likes): `supabase.rpc('bump_counter', { p_toy, p_key })`.
   - Anything else: a new migration with tables named `<toy>_*` and RLS on every table.

The homepage picks the toy up automatically. Set `hidden: true` in `meta` while it's a work in progress.

## Toys

| Toy | What |
|---|---|
| [Wordle Duo](src/toys/wordle-duo) | Private rooms for two. Upload Wordle screenshots (read in the browser, checked against that day's answer, guessed words read and revealed once you both play), no-spoiler rule enforced by the database, live updates. |
| [Drinks](src/toys/drinks) | Couples only. Two 15-shot pitchers fill with how much each of you drank this month, counted in shots (30 ml at 40%) whatever the drink. Overflow and you're cut off. Morning-after ratings and notes, a month heatmap and year view, streaks, and a weekly limit. |
