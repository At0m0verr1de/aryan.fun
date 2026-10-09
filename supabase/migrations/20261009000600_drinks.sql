-- Drinks: a couple's shared alcohol log. Rows belong to the person who logged them and are visible
-- only to them and their current partner (the other member of their couple room). Nobody else.

create table public.drinks (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  day        date        not null,  -- the night it belongs to (after-midnight drinks count for the evening before)
  kind       text        not null check (kind in ('beer', 'wine', 'shot', 'cocktail', 'other')),
  ml         numeric(6,1) not null check (ml > 0 and ml <= 3000),
  abv        numeric(4,1) not null check (abv > 0 and abv <= 96),
  qty        smallint    not null default 1 check (qty between 1 and 20),
  created_at timestamptz not null default now()
);
create index drinks_user_day on public.drinks (user_id, day);

-- One row per person per night: how the morning after went, and a short note.
create table public.drink_days (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  day        date        not null,
  hangover   smallint    check (hangover between 0 and 3), -- 0 fine, 1 meh, 2 rough, 3 dead
  note       text        check (char_length(note) <= 280),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- Optional personal weekly limit, in shots (30 ml at 40%).
create table public.drink_goals (
  user_id      uuid         primary key default auth.uid() references auth.users on delete cascade,
  weekly_shots numeric(5,1) check (weekly_shots > 0 and weekly_shots <= 200),
  updated_at   timestamptz  not null default now()
);

-- True when p_user is your partner: you share a couple room.
create function public.is_partner(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.wordle_members me
    join public.wordle_members them on them.room_id = me.room_id and them.user_id = p_user
    join public.wordle_rooms r on r.id = me.room_id and r.kind = 'couple'
    where me.user_id = auth.uid() and p_user <> auth.uid()
  );
$$;

alter table public.drinks      enable row level security;
alter table public.drink_days  enable row level security;
alter table public.drink_goals enable row level security;

create policy "you and your partner" on public.drinks for select to authenticated
  using (user_id = auth.uid() or public.is_partner(user_id));
create policy "log your own, up to tomorrow" on public.drinks for insert to authenticated
  with check (user_id = auth.uid() and day between date '2000-01-01' and current_date + 1);
create policy "delete your own" on public.drinks for delete to authenticated
  using (user_id = auth.uid());

create policy "you and your partner" on public.drink_days for select to authenticated
  using (user_id = auth.uid() or public.is_partner(user_id));
create policy "write your own" on public.drink_days for insert to authenticated
  with check (user_id = auth.uid() and day between date '2000-01-01' and current_date + 1);
create policy "edit your own" on public.drink_days for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and day between date '2000-01-01' and current_date + 1);
create policy "delete your own" on public.drink_days for delete to authenticated
  using (user_id = auth.uid());

create policy "you and your partner" on public.drink_goals for select to authenticated
  using (user_id = auth.uid() or public.is_partner(user_id));
create policy "write your own" on public.drink_goals for insert to authenticated
  with check (user_id = auth.uid());
create policy "edit your own" on public.drink_goals for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.drinks, public.drink_days, public.drink_goals from anon, authenticated;
grant select, insert, delete on public.drinks to authenticated;
grant select, insert, delete on public.drink_days to authenticated;
-- day is included because upserts rewrite the conflict key columns too.
grant update (day, hangover, note, updated_at) on public.drink_days to authenticated;
grant select, insert on public.drink_goals to authenticated;
grant update (weekly_shots, updated_at) on public.drink_goals to authenticated;

revoke all on function public.is_partner(uuid) from public, anon;
grant execute on function public.is_partner(uuid) to authenticated;
