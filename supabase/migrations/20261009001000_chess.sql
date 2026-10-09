-- Chess Mates: the couple's games against each other, read from chess.com's public API by the database itself,
-- so nothing in the browser can add or change a game. Requests go out one at a time (chess.com rate-limits
-- parallel calls, never serial ones) with a User-Agent that has contact info, and reuse ETags so an unchanged
-- month costs a 304. chess.com caches archives for 60 s, so syncing more often than that gets nothing new.

-- Synchronous HTTP from SQL (Supabase ships it; plain Postgres in the tests doesn't, so they stub chess_get).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'http') then
    create extension if not exists http with schema extensions;
  end if;
end $$;

create table public.chess_names (
  room_id  uuid not null references public.wordle_rooms on delete cascade,
  user_id  uuid not null references auth.users on delete cascade,
  username text not null check (username ~ '^[a-z0-9_-]{3,25}$'),
  primary key (room_id, user_id)
);

create table public.chess_sync (
  room_id    uuid primary key references public.wordle_rooms on delete cascade,
  tried_at   timestamptz,                      -- last attempt, for the 60 s throttle
  synced_at  timestamptz,                      -- last success
  backlog    text[] not null default '{}',     -- 'YYYY/MM' months still to read, newest first
  etags      jsonb  not null default '{}',     -- archive url -> ETag
  last_error text
);

create table public.chess_games (
  room_id        uuid        not null references public.wordle_rooms on delete cascade,
  id             text        not null,         -- chess.com's game uuid
  url            text        not null,
  ended_at       timestamptz not null,
  time_class     text        not null,         -- bullet / blitz / rapid / daily
  rated          boolean     not null,
  white          uuid        not null,
  black          uuid        not null,
  winner         uuid,                         -- null = draw
  how            text        not null,         -- loser's result (checkmated, resigned, timeout…) or the draw kind
  white_rating   integer,
  black_rating   integer,
  white_accuracy numeric(5, 2),
  black_accuracy numeric(5, 2),
  opening        text,
  fen            text,                         -- final position
  moves          integer,
  primary key (room_id, id)
);
create index chess_games_room_ended on public.chess_games (room_id, ended_at desc);

alter table public.chess_names enable row level security;
alter table public.chess_sync  enable row level security;
alter table public.chess_games enable row level security;
revoke all on public.chess_names, public.chess_sync, public.chess_games from public, anon, authenticated;

-- Your couple room, or null.
create function public.chess_room()
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

-- One GET to chess.com. 200 → body, 304 → unchanged, anything else → the caller decides.
create function public.chess_get(p_url text, p_etag text, out status integer, out etag text, out body jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '3000');
  select * into r from extensions.http((
    'GET', p_url,
    array[extensions.http_header('User-Agent', 'rups.fun chess sync (contact: aryanbakshi2021@gmail.com)')]
      || case when p_etag is null then '{}'::extensions.http_header[]
              else array[extensions.http_header('If-None-Match', p_etag)] end,
    null, null)::extensions.http_request);
  status := r.status;
  etag := (select h.value from unnest(r.headers) h where lower(h.field) = 'etag' limit 1);
  body := case when r.status = 200 then r.content::jsonb end;
end;
$$;

-- 'YYYY/MM' months a player has games in, from their archives list.
create function public.chess_months(p_archives jsonb)
returns setof text
language sql
immutable
set search_path = ''
as $$
  select right(u, 7) from jsonb_array_elements_text(coalesce(p_archives -> 'archives', '[]')) u;
$$;

-- Saves the games between the two of you out of one month's archive. Games never change, so repeats are skipped.
create function public.chess_ingest(p_room uuid, p_body jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with names as (
    select user_id, username from public.chess_names where room_id = p_room
  ), ours as (
    select x, w.user_id as white, b.user_id as black
    from jsonb_array_elements(coalesce(p_body -> 'games', '[]')) x
    join names w on w.username = lower(x -> 'white' ->> 'username')
    join names b on b.username = lower(x -> 'black' ->> 'username')
    where w.user_id <> b.user_id and x ->> 'rules' = 'chess' and x ? 'end_time' and x ? 'uuid'
  ), added as (
    insert into public.chess_games (room_id, id, url, ended_at, time_class, rated, white, black, winner, how,
      white_rating, black_rating, white_accuracy, black_accuracy, opening, fen, moves)
    select p_room, x ->> 'uuid', x ->> 'url', to_timestamp((x ->> 'end_time')::bigint), coalesce(x ->> 'time_class', 'rapid'),
      coalesce((x ->> 'rated')::boolean, false), white, black,
      case when x -> 'white' ->> 'result' = 'win' then white when x -> 'black' ->> 'result' = 'win' then black end,
      coalesce(case when x -> 'white' ->> 'result' = 'win' then x -> 'black' ->> 'result' else x -> 'white' ->> 'result' end, 'unknown'),
      (x -> 'white' ->> 'rating')::integer, (x -> 'black' ->> 'rating')::integer,
      (x -> 'accuracies' ->> 'white')::numeric, (x -> 'accuracies' ->> 'black')::numeric,
      -- ".../openings/Italian-Game-Two-Knights-Defense-4.d3" → "Italian Game Two Knights Defense"
      nullif(regexp_replace(replace(split_part(x ->> 'eco', '/openings/', 2), '-', ' '), '\s\d.*$', ''), ''),
      x ->> 'fen',
      nullif(split_part(x ->> 'fen', ' ', 6), '')::integer
    from ours
    on conflict do nothing
    returning 1
  )
  select count(*) into v_count from added;
  return v_count;
end;
$$;

-- Reads up to p_budget archives for one couple: on the first run both players' month lists (to find the months
-- you could have played each other), then this month (and last month, if it ended since the last look),
-- then older months off the backlog. Errors are kept on the sync row for the page to show.
create function public.chess_sync_room(p_room uuid, p_budget integer)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  base constant text := 'https://api.chess.com/pub/player/';
  s public.chess_sync;
  n1 text;
  n2 text;
  v_month text := to_char(now() at time zone 'utc', 'YYYY/MM');
  v_read text[];
  v_take integer;
  v_used integer := 0;
  v_url text;
  m text;
  r record;
  a1 jsonb;
begin
  select n.username into n1 from public.chess_names n join public.wordle_members wm on wm.room_id = n.room_id and wm.user_id = n.user_id
    where n.room_id = p_room order by wm.slot limit 1;
  select n.username into n2 from public.chess_names n where n.room_id = p_room and n.username <> n1 limit 1;
  if n1 is null or n2 is null then
    return;
  end if;
  insert into public.chess_sync (room_id) values (p_room) on conflict do nothing;
  select * into s from public.chess_sync where room_id = p_room for update;
  update public.chess_sync set tried_at = now() where room_id = p_room;

  begin
    if s.synced_at is null then
      select * into r from public.chess_get(base || n1 || '/games/archives', null);
      if r.status = 404 then raise exception 'chess.com has no player called %', n1; end if;
      if r.status <> 200 then raise exception 'chess.com answered %', r.status; end if;
      a1 := r.body;
      select * into r from public.chess_get(base || n2 || '/games/archives', null);
      if r.status = 404 then raise exception 'chess.com has no player called %', n2; end if;
      if r.status <> 200 then raise exception 'chess.com answered %', r.status; end if;
      s.backlog := array(
        select mm from (select public.chess_months(a1) mm intersect select public.chess_months(r.body)) both_played
        where mm <> v_month order by mm desc);
      v_used := 2;
    end if;

    v_read := array[v_month];
    if s.synced_at is not null and to_char(s.synced_at at time zone 'utc', 'YYYY/MM') <> v_month then
      v_read := v_read || to_char(s.synced_at at time zone 'utc', 'YYYY/MM');
    end if;
    v_take := greatest(p_budget - v_used - cardinality(v_read), 0);
    v_read := v_read || s.backlog[1:v_take];
    s.backlog := s.backlog[v_take + 1:];

    foreach m in array v_read loop
      v_url := base || n1 || '/games/' || m;
      select * into r from public.chess_get(v_url, s.etags ->> v_url);
      if r.status = 200 then
        perform public.chess_ingest(p_room, r.body);
        if r.etag is not null then s.etags := s.etags || jsonb_build_object(v_url, r.etag); end if;
      elsif r.status = 429 then
        raise exception 'chess.com is busy, try again in a minute';
      elsif r.status not in (304, 404) then  -- 404: no games that month
        raise exception 'chess.com answered %', r.status;
      end if;
    end loop;

    update public.chess_sync set synced_at = now(), backlog = s.backlog, etags = s.etags, last_error = null
    where room_id = p_room;
  exception when others then
    update public.chess_sync set last_error = sqlerrm where room_id = p_room;
  end;
end;
$$;

-- Everything the page needs: both usernames, sync status, and every game (newest first). Null when unpaired.
create function public.chess_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room uuid := public.chess_room();
begin
  if v_room is null then
    return null;
  end if;
  return jsonb_build_object(
    'names', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'username', username))
                       from public.chess_names where room_id = v_room), '[]'),
    'sync', (select jsonb_build_object('tried_at', tried_at, 'synced_at', synced_at, 'backlog', cardinality(backlog), 'error', last_error)
             from public.chess_sync where room_id = v_room),
    'games', coalesce((select jsonb_agg(to_jsonb(g) - 'room_id' order by g.ended_at desc)
                       from public.chess_games g where g.room_id = v_room), '[]'));
end;
$$;

-- Saves both usernames (either of you can). Changing one starts the history over.
create function public.chess_set_names(p_mine text, p_partner text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room uuid := public.chess_room();
  v_partner uuid;
  v_mine text := lower(trim(p_mine));
  v_theirs text := lower(trim(p_partner));
begin
  if v_room is null then raise exception 'pair up with your partner first'; end if;
  select user_id into v_partner from public.wordle_members where room_id = v_room and user_id <> auth.uid();
  if v_partner is null then raise exception 'wait for your partner to join first'; end if;
  if v_mine !~ '^[a-z0-9_-]{3,25}$' or v_theirs !~ '^[a-z0-9_-]{3,25}$' then
    raise exception 'that doesn''t look like a chess.com username';
  end if;
  if v_mine = v_theirs then raise exception 'those are the same username'; end if;

  if exists (select 1 from public.chess_names where room_id = v_room
             and username <> case when user_id = auth.uid() then v_mine else v_theirs end) then
    delete from public.chess_games where room_id = v_room;
    delete from public.chess_sync where room_id = v_room;
  end if;
  insert into public.chess_names (room_id, user_id, username)
  values (v_room, auth.uid(), v_mine), (v_room, v_partner, v_theirs)
  on conflict (room_id, user_id) do update set username = excluded.username;
  return public.chess_state();
end;
$$;

-- Page open / "fetch games": syncs at most once a minute, but keeps going while old months are left to read.
create function public.chess_sync()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room uuid := public.chess_room();
  s public.chess_sync;
begin
  if v_room is null then raise exception 'pair up with your partner first'; end if;
  select * into s from public.chess_sync where room_id = v_room;
  if s is null or s.tried_at is null or s.tried_at < now() - interval '60 seconds' or cardinality(s.backlog) > 0 then
    perform public.chess_sync_room(v_room, 3);
  end if;
  return public.chess_state();
end;
$$;

-- Background run for every couple that hasn't synced in ~3 hours, one after another (pg_cron).
create function public.chess_sync_all()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room uuid;
begin
  for v_room in
    select distinct n.room_id
    from public.chess_names n
    join public.wordle_rooms r on r.id = n.room_id and r.kind = 'couple'
    left join public.chess_sync s on s.room_id = n.room_id
    where s.tried_at is null or s.tried_at < now() - interval '170 minutes'
  loop
    perform public.chess_sync_room(v_room, 6);
  end loop;
end;
$$;

revoke all on function public.chess_room() from public, anon, authenticated;
revoke all on function public.chess_get(text, text) from public, anon, authenticated;
revoke all on function public.chess_months(jsonb) from public, anon, authenticated;
revoke all on function public.chess_ingest(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.chess_sync_room(uuid, integer) from public, anon, authenticated;
revoke all on function public.chess_sync_all() from public, anon, authenticated;
revoke all on function public.chess_state() from public, anon;
revoke all on function public.chess_set_names(text, text) from public, anon;
revoke all on function public.chess_sync() from public, anon;
grant execute on function public.chess_state() to authenticated;
grant execute on function public.chess_set_names(text, text) to authenticated;
grant execute on function public.chess_sync() to authenticated;

-- The http extension's functions default to PUBLIC; only our definer functions should reach the network.
do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'extensions' and p.proname like 'http%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Every 3 hours, at :23 to stay off the busy top of the hour.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('chess-sync', '23 */3 * * *', 'select public.chess_sync_all()');
  end if;
end $$;
