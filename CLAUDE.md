# CLAUDE.md — made by aryan

Personal project on personal infra only: public npm (`.npmrc`), personal GitHub (At0m0verr1de), Cloudflare Workers static assets, Supabase.
- Live at https://rups.fun (Workers custom domain in `wrangler.jsonc`). The old workers.dev address and www.rups.fun are redirected in the browser by an inline script in `src/shared/Layout.astro`, because static assets are served before the Worker runs. Sign-in on preview URLs needs `https://*-madebyaryan.aryanbakshi2021.workers.dev/**` in Supabase Redirect URLs.
Never point it at work registries, work GitHub orgs, or work services.

## Build & Test
- `npm run build` — static build to `dist/`
- `npm test` — Node test runner over `src/**/*.test.js`
- `supabase/tests/run.sh` — applies every migration to a throwaway Postgres DB and runs RLS checks (expects container `pg-wordle-test`)
- Devpod preview: `devpod serve dist-preview`, then `scripts/preview-devpod.sh /proxy/<devpod>/<port>/`
- Run npm/astro from the repo root. Running astro from another cwd writes a stray `.astro/` there.

## Architecture
- One toy = `src/toys/<slug>/` (meta.ts + code) + `src/pages/<slug>.astro`. Homepage globs `src/toys/*/meta.ts`.
- Links must use `import.meta.env.BASE_URL` (the devpod preview is served under a sub-path).
- Toy pages that render with innerHTML need `<style is:global>`; scoped styles don't reach generated markup.
- Supabase: toy tables live in `public` as `<toy>_*` (no per-toy exposed-schema config). Shared: `counters`, `scores`.

## Key Invariants
- RLS on every table. Cross-row checks go through `security definer` helpers to avoid policy recursion.
- Grant column-level `update` only on user-editable columns.
- Supabase auto-grants ALL on new public objects; `20261009000200_tighten_grants.sql` disables that, so every toy migration must grant exactly what it uses.
- The test stub mirrors Supabase's default grants, so a missing revoke shows up as a FAIL locally.
- Project is in Tokyo; DB access goes through `aws-0-ap-northeast-1.pooler.supabase.com` (direct host is IPv6-only).
- Wordle Duo no-spoiler rule is enforced in SQL (`"no spoilers"` policy), never only in the client.
- Every player signs in with Google (`src/shared/supabase.js`); anonymous sign-ins stay off. The anon key is public; the service_role key never enters this repo.
- OAuth returns to `location.href`, so every deploy/preview origin must be listed in Supabase → Authentication → URL Configuration → Redirect URLs.
- Add a case to `supabase/tests/wordle_rls_test.sql` for every new policy.
- `.env.production` is committed and holds only browser-safe values; secrets never go there.
- Commits here must stay unsigned and use the At0m0verr1de identity (repo-local git config overrides the devpod's signing and hooks).
- Telemetry: `track()` / `reportError()` from `src/shared/telemetry.js` → `/api/events` → `worker/index.js` → Workers Logs (free: 200k events/day, ~3-day retention). New event names must be added to `EVENTS` in `worker/index.js` or they are dropped. Never log names, emails, or player-typed text.
- `worker/index.js` only runs for paths with no static file; static pages never invoke it. Invocation logs are off to save log quota.
- Wordle Duo screenshot reading (all in the browser): `parse.js` (tile colours + boxes) → `/api/wordle/<date>` (worker proxies NYT's answer, edge-cached; dates after tomorrow refused) → `ocr.js` letter scores → `solve.js` `verifyBoard` (blocks other days' boards) + `decodeBoard` (words that fit the colours) → player confirms words. Colours + answer do most of the work; OCR only ranks candidate words. `words.js` (~74 KB) must stay a dynamic import. OCR accuracy is guarded by `ocr.test.js` (draws boards with @napi-rs/canvas).
- Partner mode (`src/shared/space.js`): a couple is a 2-person Wordle room with `kind = 'couple'` (one per person, enforced in SQL RPCs). With a couple, `/` is the couple home and Wordle opens the couple room directly; the hidden "Mode" switch in the profile menu flips to general mode ("Groups"), which never lists or opens the couple room: partner and groups are separate spaces. `data-mode="couple"` on `<html>` drives the blush theme in `theme.css`.
- Groups (`wordle_rooms` with `kind = 'group'`, up to 10, an `icon`; the table names are historical, rooms are site-wide): the header's switcher (`src/shared/group-switch.js`) picks `space.group` from any page and fires `GROUP_EVENT`; pages that redraw in place set `data-groups="live"` on `<html>` and listen, other pages navigate to the leaderboard. Wordle in a group is "Wordle Leaderboard" (`leaderboard.js`: day ranks by guesses, standings by points 6..1, X = 0). Only the creator removes people (`wordle_remove_member`); a leaving creator hands over, an empty room is deleted (trigger). Invite links are `/wordle-duo/?join=CODE` for both kinds.
- Wordle results belong to the person (`wordle_results` pk `(user_id, puzzle_no)`, no room column): one upload counts in the couple room and every group. Visible to anyone sharing a room with you, once they've played that puzzle (`wordle_shares_room` + `wordle_has_played`).
- Drinks (`src/toys/drinks/`, `couple: true` in meta = only on the couple home): everything is counted in shots, 1 shot = 30 ml at 40% = 12 ml alcohol (`shotsOf` in stats.js). Drinks before 6am count for the previous night. The jug is a fixed 15 shots a month (180 in year view, `jugOf`); over it you're "cut off". RLS: you read your own rows and your partner's (`is_partner()`), and write only your own. PostgREST upserts rewrite conflict keys, so tables that get upserted need update on those key columns too.
- Invite-only: `site_has_access()` = on the `site_access` allowlist (SQL editor only) or a member of any room. Joining by invite code is always allowed; creating rooms needs access. `/` shows the door to signed-out visitors and "invite only" to signed-in strangers. Static pages are public files, so nothing personal goes in the build; privacy is the DB rules.
- Avatars are emojis (`wordle_members.emoji`); Google photos are never shown or stored.
- Words are never logged in telemetry (they'd spoil the day); only counts/ratios.
- Design iteration: preview on the devpod first (`scripts/preview-devpod.sh`); push a non-main branch for a Cloudflare preview URL when Google sign-in must work; merge to `main` only when final.

