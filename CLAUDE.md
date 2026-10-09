# CLAUDE.md — made by aryan

Personal project on personal infra only: public npm (`.npmrc`), personal GitHub, Cloudflare Pages, Supabase.
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
