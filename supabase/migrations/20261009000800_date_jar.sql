-- Date Jar: a couple's jar of folded date ideas. Nobody reads the tables directly; everything goes through
-- the functions below, which see only your own couple room. Your partner's slips stay folded (idea hidden)
-- while they're in the jar, and the draw happens here so you both get the same slip.

create table public.jar_slips (
  id         uuid        primary key default gen_random_uuid(),
  room_id    uuid        not null references public.wordle_rooms on delete cascade,
  added_by   uuid        not null references auth.users on delete cascade,
  idea       text        not null check (char_length(idea) between 1 and 120),
  cost       integer     not null default 0 check (cost between 0 and 1000000), -- expected total for the date, in rupees
  payer      uuid        references auth.users on delete set null,             -- who pays; null = split 50/50
  place      text        not null default 'out' check (place in ('in', 'out')),
  length     text        not null default 'evening' check (length in ('quick', 'evening', 'day')),
  status     text        not null default 'jar' check (status in ('jar', 'drawn', 'done')),
  drawn_by   uuid        references auth.users on delete set null,
  drawn_at   timestamptz,
  done_at    timestamptz,
  spent      integer     check (spent between 0 and 1000000),                  -- what it really cost, once done
  rating     smallint    check (rating between 1 and 5),
  memory     text        check (char_length(memory) <= 200),
  created_at timestamptz not null default now()
);
create index jar_slips_room on public.jar_slips (room_id, status);
create unique index jar_one_drawn on public.jar_slips (room_id) where status = 'drawn'; -- one date at a time

-- Each veto puts a drawn slip back. One per person per rolling 7 days.
create table public.jar_vetoes (
  room_id uuid        not null references public.wordle_rooms on delete cascade,
  user_id uuid        not null references auth.users on delete cascade,
  at      timestamptz not null default now()
);
create index jar_vetoes_recent on public.jar_vetoes (room_id, user_id, at);

alter table public.jar_slips  enable row level security;
alter table public.jar_vetoes enable row level security;
revoke all on public.jar_slips, public.jar_vetoes from anon, authenticated;

-- Your couple room, or null if you aren't in a couple.
create function public.jar_room()
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

-- Everything the page needs in one call: the slips (partner's folded ones without their idea) and recent vetoes.
create function public.jar_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'slips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'added_by', s.added_by,
        'idea', case when s.status = 'jar' and s.added_by <> auth.uid() then null else s.idea end,
        'cost', s.cost, 'payer', s.payer, 'place', s.place, 'length', s.length, 'status', s.status,
        'drawn_by', s.drawn_by, 'drawn_at', s.drawn_at, 'done_at', s.done_at,
        'spent', s.spent, 'rating', s.rating, 'memory', s.memory, 'created_at', s.created_at
      ) order by s.created_at)
      from public.jar_slips s
      where s.room_id = public.jar_room()), '[]'::jsonb),
    'vetoes', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', v.user_id, 'at', v.at) order by v.at)
      from public.jar_vetoes v
      where v.room_id = public.jar_room() and v.at > now() - interval '7 days'), '[]'::jsonb)
  );
$$;

create function public.jar_add(p_idea text, p_cost integer, p_payer uuid, p_place text, p_length text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := public.jar_room();
  v_id   uuid;
begin
  if v_room is null then raise exception 'pair up first'; end if;
  if p_payer is not null and p_payer <> auth.uid() and not public.is_partner(p_payer) then
    raise exception 'the payer has to be one of you';
  end if;
  if (select count(*) from public.jar_slips where room_id = v_room and status = 'jar') >= 90 then
    raise exception 'the jar is full';
  end if;
  insert into public.jar_slips (room_id, added_by, idea, cost, payer, place, length)
  values (v_room, auth.uid(), btrim(p_idea), coalesce(p_cost, 0), p_payer, coalesce(p_place, 'out'), coalesce(p_length, 'evening'))
  returning id into v_id;
  return v_id;
end;
$$;

-- Take your own slip back out, while it's still in the jar.
create function public.jar_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.jar_slips
  where id = p_id and room_id = public.jar_room() and added_by = auth.uid() and status = 'jar';
  if not found then raise exception 'you can only take out your own folded slips'; end if;
end;
$$;

-- Picks one random slip that fits the filters and marks it drawn. Null filters match anything.
create function public.jar_draw(p_place text default null, p_length text default null, p_max_cost integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := public.jar_room();
  v_slip public.jar_slips;
begin
  if v_room is null then raise exception 'pair up first'; end if;
  if exists (select 1 from public.jar_slips where room_id = v_room and status = 'drawn') then
    raise exception 'a date is already drawn';
  end if;
  select * into v_slip
  from public.jar_slips
  where room_id = v_room and status = 'jar'
    and (p_place is null or place = p_place)
    and (p_length is null or length = p_length)
    and (p_max_cost is null or cost <= p_max_cost)
  order by random()
  limit 1
  for update skip locked;
  if not found then raise exception 'no slips match'; end if;
  update public.jar_slips set status = 'drawn', drawn_by = auth.uid(), drawn_at = now()
  where id = v_slip.id
  returning * into v_slip;
  return to_jsonb(v_slip) - 'room_id';
end;
$$;

-- Puts the drawn slip back in the jar, using up the caller's veto for the week.
create function public.jar_veto(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := public.jar_room();
begin
  if (select count(*) from public.jar_vetoes
      where room_id = v_room and user_id = auth.uid() and at > now() - interval '7 days') >= 1 then
    raise exception 'no vetoes left this week';
  end if;
  update public.jar_slips set status = 'jar', drawn_by = null, drawn_at = null
  where id = p_id and room_id = v_room and status = 'drawn';
  if not found then raise exception 'nothing to veto'; end if;
  insert into public.jar_vetoes (room_id, user_id) values (v_room, auth.uid());
end;
$$;

-- Marks the drawn date as done, or edits the memory of one that's done.
create function public.jar_done(p_id uuid, p_spent integer, p_rating smallint, p_memory text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jar_slips
  set status = 'done', done_at = coalesce(done_at, now()), spent = p_spent, rating = p_rating, memory = nullif(btrim(p_memory), '')
  where id = p_id and room_id = public.jar_room() and status in ('drawn', 'done');
  if not found then raise exception 'that date is not drawn yet'; end if;
end;
$$;

revoke all on function public.jar_room() from public, anon, authenticated;
revoke all on function public.jar_state(), public.jar_add(text, integer, uuid, text, text), public.jar_remove(uuid),
  public.jar_draw(text, text, integer), public.jar_veto(uuid), public.jar_done(uuid, integer, smallint, text) from public, anon;
grant execute on function public.jar_state(), public.jar_add(text, integer, uuid, text, text), public.jar_remove(uuid),
  public.jar_draw(text, text, integer), public.jar_veto(uuid), public.jar_done(uuid, integer, smallint, text) to authenticated;
