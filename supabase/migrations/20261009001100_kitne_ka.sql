-- Kitne Ka?: guess the price of five everyday Indian things a day, in rupees. Both of you get the same five.
-- Prices live only here: the page gets an item's price back after you've guessed it, and your partner's guess
-- only once you've guessed that item too.

create table public.price_items (
  id       integer generated always as identity primary key,
  name     text    not null unique,
  detail   text    not null default '',                -- size / variant / city, e.g. "70 g pack"
  category text    not null,
  emoji    text    not null default '🛍️',
  price    bigint  not null check (price > 0),         -- rupees
  source   text,
  as_of    text,                                        -- 'YYYY-MM' the price was checked
  active   boolean not null default true
);

create table public.price_guesses (
  room_id uuid        not null references public.wordle_rooms on delete cascade,
  user_id uuid        not null references auth.users on delete cascade,
  day     date        not null,                         -- India date
  slot    smallint    not null check (slot between 0 and 4),
  item_id integer     not null references public.price_items,
  guess   bigint      not null check (guess between 1 and 100000000000),
  points  smallint    not null check (points between 0 and 100),
  at      timestamptz not null default now(),
  primary key (room_id, user_id, day, slot)
);
create index price_guesses_room_day on public.price_guesses (room_id, day);

alter table public.price_items   enable row level security;
alter table public.price_guesses enable row level security;
revoke all on public.price_items, public.price_guesses from anon, authenticated;

create function public.price_today_date()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date; $$;

-- 100 for spot on, falling with how many times off you were: 2× (or half) ≈ 37, 3× or worse = 0.
create function public.price_points(p_guess bigint, p_price bigint)
returns smallint
language sql
immutable
set search_path = ''
as $$ select greatest(0, round(100 * (1 - abs(ln(p_guess::numeric / p_price)) / ln(3))))::smallint; $$;

-- The day's five: walks a fixed shuffle of the items five at a time, so nothing repeats until all have shown.
create function public.price_items_for(p_day date)
returns table (slot smallint, item_id integer)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select i.id, (row_number() over (order by md5(i.id::text || 'kitne-ka')) - 1)::bigint as pos, count(*) over () as n
    from public.price_items i
    where i.active
  )
  select s.slot::smallint, r.id
  from generate_series(0, 4) s(slot)
  join ranked r on r.pos = ((((p_day - date '2026-10-01') * 5 + s.slot) % r.n) + r.n) % r.n
  order by s.slot;
$$;

create function public.price_room()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.wordle_rooms r
  join public.wordle_members m on m.room_id = r.id
  where m.user_id = auth.uid() and r.kind = 'couple'
  limit 1;
$$;

-- Today's five, with prices and your partner's guesses only where you've already guessed, plus 60 days of totals.
create function public.price_today()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ctx as (
    select public.price_room() as room, public.price_today_date() as day
  ), mine as (
    select g.* from public.price_guesses g, ctx where g.room_id = ctx.room and g.day = ctx.day and g.user_id = auth.uid()
  ), theirs as (
    select g.* from public.price_guesses g, ctx where g.room_id = ctx.room and g.day = ctx.day and g.user_id <> auth.uid()
  )
  select case when (select room from ctx) is null then null else jsonb_build_object(
    'day', (select day from ctx),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'slot', t.slot, 'name', i.name, 'detail', i.detail, 'category', i.category, 'emoji', i.emoji,
        'guess', m.guess, 'points', m.points,
        'price', case when m.guess is not null then i.price end,
        'as_of', case when m.guess is not null then i.as_of end,
        'source', case when m.guess is not null then i.source end,
        'partner_played', th.guess is not null,
        'partner_guess', case when m.guess is not null then th.guess end,
        'partner_points', case when m.guess is not null then th.points end
      ) order by t.slot)
      from ctx, public.price_items_for(ctx.day) t
      join public.price_items i on i.id = t.item_id
      left join mine m on m.slot = t.slot
      left join theirs th on th.slot = t.slot), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('day', h.day, 'user_id', h.user_id, 'points', h.points, 'n', h.n) order by h.day desc)
      from (
        select g.day, g.user_id, sum(g.points)::int as points, count(*)::int as n
        from public.price_guesses g, ctx
        where g.room_id = ctx.room and g.day > ctx.day - 60
          -- today's total for your partner only once you've finished yours
          and (g.day < ctx.day or g.user_id = auth.uid() or (select count(*) from mine) = 5)
        group by g.day, g.user_id
      ) h), '[]'::jsonb)
  ) end;
$$;

create function public.price_guess(p_slot integer, p_guess bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room uuid := public.price_room();
  v_day date := public.price_today_date();
  v_item integer;
  v_price bigint;
begin
  if v_room is null then raise exception 'pair up with your partner first'; end if;
  if p_slot is null or p_slot not between 0 and 4 then raise exception 'no such item today'; end if;
  if p_guess is null or p_guess not between 1 and 100000000000 then raise exception 'guess between ₹1 and ₹10,000 crore'; end if;
  select t.item_id, i.price into v_item, v_price
  from public.price_items_for(v_day) t join public.price_items i on i.id = t.item_id
  where t.slot = p_slot;
  if v_item is null then raise exception 'no such item today'; end if;
  insert into public.price_guesses (room_id, user_id, day, slot, item_id, guess, points)
  values (v_room, auth.uid(), v_day, p_slot, v_item, p_guess, public.price_points(p_guess, v_price))
  on conflict do nothing;
  if not found then raise exception 'you already guessed that one'; end if;
  return public.price_today();
end;
$$;

revoke all on function public.price_today_date() from public, anon, authenticated;
revoke all on function public.price_points(bigint, bigint) from public, anon, authenticated;
revoke all on function public.price_items_for(date) from public, anon, authenticated;
revoke all on function public.price_room() from public, anon, authenticated;
revoke all on function public.price_today() from public, anon;
revoke all on function public.price_guess(integer, bigint) from public, anon;
grant execute on function public.price_today() to authenticated;
grant execute on function public.price_guess(integer, bigint) to authenticated;
