-- Our pet: one shared pet per couple. Its meters are stored as of updated_at and drain with time, so nothing
-- has to run on a schedule: every read works out where they are now.
--   hunger    100 → 0 in 2 days without food
--   happiness 100 → 0 in 3 days without play
--   health    drains slowly always, faster while hunger or happiness is empty: left completely alone from full,
--             it reaches 0 at exactly 7 days, and the pet dies.
-- Feeding, playing and petting on the pet page fill the meters (a few times a day each); playing the other toys
-- gives one boost per toy per person per day. Nobody touches the tables directly.

create table public.pets (
  room_id    uuid        primary key references public.wordle_rooms on delete cascade,
  name       text        not null check (char_length(name) between 1 and 20),
  colour     text        not null check (colour in ('pink', 'blue', 'cream', 'lilac', 'mint', 'peach')),
  born_at    timestamptz not null default now(),
  hunger     real        not null default 100,
  happiness  real        not null default 100,
  health     real        not null default 100,
  updated_at timestamptz not null default now()
);

create table public.pet_events (
  id      bigint      generated always as identity primary key,
  room_id uuid        not null references public.wordle_rooms on delete cascade,
  user_id uuid        references auth.users on delete set null,   -- null: both of you (e.g. a chess game)
  kind    text        not null check (kind in ('adopt', 'feed', 'play', 'pet', 'wordle', 'chess', 'jar', 'drinks', 'kitne')),
  day     date        not null default (now() at time zone 'Asia/Kolkata')::date,
  at      timestamptz not null default now()
);
create index pet_events_room on public.pet_events (room_id, at desc);
create index pet_events_limits on public.pet_events (room_id, user_id, kind, day);

create table public.pet_graves (
  room_id uuid        not null references public.wordle_rooms on delete cascade,
  name    text        not null,
  colour  text        not null,
  born_at timestamptz not null,
  died_at timestamptz not null
);
create index pet_graves_room on public.pet_graves (room_id, died_at desc);

alter table public.pets       enable row level security;
alter table public.pet_events enable row level security;
alter table public.pet_graves enable row level security;
revoke all on public.pets, public.pet_events, public.pet_graves from anon, authenticated;

create function public.pet_room()
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

-- Where the meters are now, and when the pet died (null if alive). Rates are per hour.
create function public.pet_now(p public.pets, out hunger real, out happiness real, out health real, out died_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  r_hunger    constant real := 100.0 / 48;
  r_happy     constant real := 100.0 / 72;
  r_base      constant real := 100.0 / 336;          -- 14 days if the other two stay up
  r_empty     constant real := 50.0 / 216;           -- extra per empty meter; makes total neglect 7 days
  v_hours     real := greatest(0, extract(epoch from now() - p.updated_at) / 3600);
  v_hunger_0  real := p.hunger / r_hunger;            -- hours until hunger is empty
  v_happy_0   real := p.happiness / r_happy;
  v_marks     real[];
  v_from      real := 0;
  v_to        real;
  v_rate      real;
  v_health    real := p.health;
begin
  hunger := greatest(0, p.hunger - r_hunger * v_hours);
  happiness := greatest(0, p.happiness - r_happy * v_hours);
  -- Health falls in straight pieces; the slope steps up as each meter empties.
  v_marks := array(select unnest(array[v_hunger_0, v_happy_0, v_hours]) as m order by m);
  foreach v_to in array v_marks loop
    v_to := least(v_to, v_hours);
    if v_to > v_from then
      v_rate := r_base + r_empty * ((v_from >= v_hunger_0)::int + (v_from >= v_happy_0)::int);
      if v_health - v_rate * (v_to - v_from) <= 0 then
        died_at := p.updated_at + make_interval(secs => (v_from + v_health / v_rate) * 3600);
        v_health := 0;
        exit;
      end if;
      v_health := v_health - v_rate * (v_to - v_from);
      v_from := v_to;
    end if;
  end loop;
  health := v_health;
end;
$$;

-- Bring a pet's stored meters up to now and add to them. Returns false (and changes nothing) if it has died.
create function public.pet_apply(p_room uuid, p_hunger real, p_happy real, p_health real)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_pet public.pets;
  v_now record;
begin
  select * into v_pet from public.pets where room_id = p_room for update;
  if not found then return false; end if;
  select * into v_now from public.pet_now(v_pet);
  if v_now.died_at is not null then return false; end if;
  update public.pets set
    hunger = least(100, greatest(0, v_now.hunger + p_hunger)),
    happiness = least(100, greatest(0, v_now.happiness + p_happy)),
    health = least(100, greatest(0, v_now.health + p_health)),
    updated_at = now()
  where room_id = p_room;
  return true;
end;
$$;

-- Playing any other toy: one boost per toy per person per day. Never fails the caller.
create function public.pet_boost(p_room uuid, p_user uuid, p_kind text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_room is null then return; end if;
  if exists (select 1 from public.pet_events where room_id = p_room and user_id is not distinct from p_user
             and kind = p_kind and day = (now() at time zone 'Asia/Kolkata')::date) then
    return;
  end if;
  if public.pet_apply(p_room, 10, 15, 20) then
    insert into public.pet_events (room_id, user_id, kind) values (p_room, p_user, p_kind);
  end if;
exception when others then
  null;
end;
$$;

create function public.pet_couple_room_of(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id from public.wordle_rooms r join public.wordle_members m on m.room_id = r.id
  where m.user_id = p_user and r.kind = 'couple' limit 1;
$$;

create function public.pet_after_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  case tg_table_name
    when 'wordle_results' then perform public.pet_boost(public.pet_couple_room_of(new.user_id), new.user_id, 'wordle');
    when 'drinks'         then perform public.pet_boost(public.pet_couple_room_of(new.user_id), new.user_id, 'drinks');
    when 'jar_slips'      then perform public.pet_boost(new.room_id, coalesce(auth.uid(), new.added_by), 'jar');
    when 'chess_games'    then perform public.pet_boost(new.room_id, null, 'chess');
    when 'price_guesses'  then perform public.pet_boost(new.room_id, new.user_id, 'kitne');
    else null;
  end case;
  return null;
exception when others then
  return null;
end;
$$;

create trigger pet_wordle after insert on public.wordle_results for each row execute function public.pet_after_activity();
create trigger pet_drinks after insert on public.drinks for each row execute function public.pet_after_activity();
create trigger pet_jar after insert or update of status on public.jar_slips for each row execute function public.pet_after_activity();
create trigger pet_chess after insert on public.chess_games for each row execute function public.pet_after_activity();
create trigger pet_kitne after insert on public.price_guesses for each row execute function public.pet_after_activity();

-- Everything the page needs: the pet as of now, today's counts for you, recent happenings, the last time each
-- toy was played, and the pets you've lost.
create function public.pet_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ctx as (select public.pet_room() as room, (now() at time zone 'Asia/Kolkata')::date as day)
  select case when (select room from ctx) is null then null else jsonb_build_object(
    'pet', (
      select jsonb_build_object('name', p.name, 'colour', p.colour, 'born_at', p.born_at,
        'hunger', round(n.hunger::numeric, 1), 'happiness', round(n.happiness::numeric, 1), 'health', round(n.health::numeric, 1),
        'died_at', n.died_at, 'updated_at', p.updated_at)
      from public.pets p, ctx, lateral public.pet_now(p) n
      where p.room_id = ctx.room),
    'today', coalesce((
      select jsonb_object_agg(e.kind, e.n)
      from (select pe.kind, count(*) as n from public.pet_events pe, ctx
            where pe.room_id = ctx.room and pe.user_id = auth.uid() and pe.day = ctx.day group by pe.kind) e), '{}'::jsonb),
    'last', coalesce((
      select jsonb_object_agg(e.kind, e.at)
      from (select pe.kind, max(pe.at) as at from public.pet_events pe, ctx where pe.room_id = ctx.room group by pe.kind) e), '{}'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', e.user_id, 'kind', e.kind, 'at', e.at) order by e.at desc)
      from (select pe.* from public.pet_events pe, ctx where pe.room_id = ctx.room order by pe.at desc limit 30) e), '[]'::jsonb),
    'graves', coalesce((
      select jsonb_agg(jsonb_build_object('name', g.name, 'colour', g.colour, 'born_at', g.born_at, 'died_at', g.died_at) order by g.died_at desc)
      from public.pet_graves g, ctx where g.room_id = ctx.room), '[]'::jsonb)
  ) end;
$$;

-- Hatch a pet (or a new one after the last one died). Needs both of you.
create function public.pet_adopt(p_name text, p_colour text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room uuid := public.pet_room();
  v_pet public.pets;
  v_died timestamptz;
begin
  if v_room is null then raise exception 'pair up with your partner first'; end if;
  if (select count(*) from public.wordle_members where room_id = v_room) < 2 then raise exception 'wait for your partner to join first'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 20 then raise exception 'give it a name (up to 20 letters)'; end if;
  select * into v_pet from public.pets where room_id = v_room for update;
  if found then
    select n.died_at into v_died from public.pet_now(v_pet) n;
    if v_died is null then raise exception 'you already have a pet'; end if;
    insert into public.pet_graves (room_id, name, colour, born_at, died_at) values (v_room, v_pet.name, v_pet.colour, v_pet.born_at, v_died);
    delete from public.pets where room_id = v_room;
  end if;
  insert into public.pets (room_id, name, colour) values (v_room, trim(p_name), p_colour);
  insert into public.pet_events (room_id, user_id, kind) values (v_room, auth.uid(), 'adopt');
  return public.pet_state();
end;
$$;

-- Feed, play or pet. Each has a daily allowance per person; past it the pet is full / tired / content and
-- nothing changes (the page still plays the animation).
create function public.pet_act(p_kind text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room uuid := public.pet_room();
  v_limit integer := case p_kind when 'feed' then 3 when 'play' then 6 when 'pet' then 12 end;
  v_used integer;
  v_applied boolean;
begin
  if v_room is null then raise exception 'pair up with your partner first'; end if;
  if v_limit is null then raise exception 'unknown action'; end if;
  select count(*) into v_used from public.pet_events
  where room_id = v_room and user_id = auth.uid() and kind = p_kind and day = (now() at time zone 'Asia/Kolkata')::date;
  if v_used < v_limit then
    v_applied := case p_kind
      when 'feed' then public.pet_apply(v_room, 30, 3, 5)
      when 'play' then public.pet_apply(v_room, -4, 15, 3)
      else public.pet_apply(v_room, 0, 5, 1) end;
    if v_applied then
      insert into public.pet_events (room_id, user_id, kind) values (v_room, auth.uid(), p_kind);
    end if;
  end if;
  return public.pet_state();
end;
$$;

revoke all on function public.pet_room() from public, anon, authenticated;
revoke all on function public.pet_now(public.pets) from public, anon, authenticated;
revoke all on function public.pet_apply(uuid, real, real, real) from public, anon, authenticated;
revoke all on function public.pet_boost(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.pet_couple_room_of(uuid) from public, anon, authenticated;
revoke all on function public.pet_after_activity() from public, anon, authenticated;
revoke all on function public.pet_state() from public, anon;
revoke all on function public.pet_adopt(text, text) from public, anon;
revoke all on function public.pet_act(text) from public, anon;
grant execute on function public.pet_state() to authenticated;
grant execute on function public.pet_adopt(text, text) to authenticated;
grant execute on function public.pet_act(text) to authenticated;
