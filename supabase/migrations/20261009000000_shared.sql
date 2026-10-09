-- Shared tables any toy can use without its own migration.
-- Convention: toy-specific tables live in public with a <toy>_ prefix (e.g. wordle_rooms),
-- so new toys never need extra "exposed schema" config in the Supabase dashboard.

-- Global tallies: plays, likes, "1.2M people clicked this".
create table public.counters (
  toy   text   not null check (toy ~ '^[a-z0-9-]{1,40}$'),
  key   text   not null check (char_length(key) between 1 and 60),
  value bigint not null default 0,
  primary key (toy, key)
);

alter table public.counters enable row level security;
create policy "counters are public" on public.counters for select using (true);

-- Writes only through this function, one step at a time.
create function public.bump_counter(p_toy text, p_key text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.counters as c (toy, key, value) values (p_toy, p_key, 1)
  on conflict (toy, key) do update set value = c.value + 1
  returning c.value;
$$;

-- Leaderboards: one row per submitted score.
create table public.scores (
  id           bigint generated always as identity primary key,
  toy          text        not null check (toy ~ '^[a-z0-9-]{1,40}$'),
  user_id      uuid        not null default auth.uid() references auth.users on delete cascade,
  display_name text        not null check (char_length(display_name) between 1 and 24),
  value        numeric     not null,
  meta         jsonb       not null default '{}' check (pg_column_size(meta) < 2048),
  created_at   timestamptz not null default now()
);
create index scores_toy_value on public.scores (toy, value desc);

alter table public.scores enable row level security;
create policy "scores are public" on public.scores for select using (true);
create policy "submit your own score" on public.scores for insert to authenticated
  with check (user_id = auth.uid());
create policy "delete your own score" on public.scores for delete to authenticated
  using (user_id = auth.uid());

grant select on public.counters, public.scores to anon, authenticated;
grant insert, delete on public.scores to authenticated;
revoke all on function public.bump_counter(text, text) from public;
grant execute on function public.bump_counter(text, text) to anon, authenticated;
