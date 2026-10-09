-- Wordle Duo: private rooms where 2 people compare their daily Wordle.
-- No-spoiler rule lives here, not in the browser: you can read someone else's result for a puzzle
-- only once you've submitted your own (or the puzzle is two days old).

create table public.wordle_rooms (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null check (char_length(name) between 1 and 40),
  invite_code text        not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  max_members smallint    not null default 2 check (max_members between 2 and 8),
  created_by  uuid        not null default auth.uid() references auth.users on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.wordle_members (
  room_id      uuid        not null references public.wordle_rooms on delete cascade,
  user_id      uuid        not null references auth.users on delete cascade,
  slot         smallint    not null check (slot between 1 and 8), -- drives colour: 1 = blue, 2 = pink
  display_name text        not null check (char_length(display_name) between 1 and 24),
  emoji        text        not null default '🐻' check (char_length(emoji) between 1 and 8),
  joined_at    timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, slot)
);

create table public.wordle_results (
  room_id    uuid        not null,
  user_id    uuid        not null,
  puzzle_no  integer     not null check (puzzle_no >= 0),
  solved     boolean     not null,
  guesses    smallint    check (guesses between 1 and 6),
  grid       text[]      not null default '{}'
             check (array_to_string(grid, ',') ~ '^([GYB]{5}(,[GYB]{5}){0,5})?$'),
  source     text        not null check (source in ('screenshot', 'text', 'manual')),
  created_at timestamptz not null default now(),
  primary key (room_id, user_id, puzzle_no),
  foreign key (room_id, user_id) references public.wordle_members on delete cascade,
  check ((solved and guesses is not null) or (not solved and guesses is null))
);

/* ---------- helpers (security definer so RLS policies can call them without recursion) ---------- */

-- Wordle #0 was 2021-06-19. Server runs in UTC; India is ahead, so policies allow today + 1.
create function public.wordle_today()
returns integer
language sql
stable
set search_path = ''
as $$ select (current_date - date '2021-06-19')::integer $$;

create function public.wordle_is_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.wordle_members where room_id = p_room and user_id = auth.uid());
$$;

create function public.wordle_has_submitted(p_room uuid, p_puzzle integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wordle_results
    where room_id = p_room and user_id = auth.uid() and puzzle_no = p_puzzle
  );
$$;

/* ---------- row level security ---------- */

alter table public.wordle_rooms   enable row level security;
alter table public.wordle_members enable row level security;
alter table public.wordle_results enable row level security;

create policy "members see their rooms" on public.wordle_rooms for select to authenticated
  using (public.wordle_is_member(id));
create policy "creator renames room" on public.wordle_rooms for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

create policy "members see each other" on public.wordle_members for select to authenticated
  using (public.wordle_is_member(room_id));
create policy "edit your own profile" on public.wordle_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "leave a room" on public.wordle_members for delete to authenticated
  using (user_id = auth.uid());

create policy "no spoilers" on public.wordle_results for select to authenticated
  using (
    public.wordle_is_member(room_id)
    and (
      user_id = auth.uid()
      or public.wordle_has_submitted(room_id, puzzle_no)
      or puzzle_no <= public.wordle_today() - 2
    )
  );
create policy "submit your own result" on public.wordle_results for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.wordle_is_member(room_id)
    and puzzle_no <= public.wordle_today() + 1
  );
create policy "redo your own result" on public.wordle_results for delete to authenticated
  using (user_id = auth.uid());

/* ---------- RPCs ---------- */

-- Create a room and join it as slot 1 in one step.
create function public.wordle_create_room(p_name text, p_display_name text, p_emoji text)
returns public.wordle_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.wordle_rooms;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.wordle_rooms (name, created_by) values (p_name, auth.uid()) returning * into room;
  insert into public.wordle_members (room_id, user_id, slot, display_name, emoji)
    values (room.id, auth.uid(), 1, p_display_name, p_emoji);
  return room;
end;
$$;

-- What an invitee sees before joining: room name and who is already in it.
create function public.wordle_room_preview(p_code text)
returns table (room_id uuid, room_name text, member_names text[], is_full boolean, already_member boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name,
         coalesce(array_agg(m.emoji || ' ' || m.display_name order by m.slot) filter (where m.user_id is not null), '{}'),
         count(m.user_id) >= r.max_members,
         bool_or(m.user_id = auth.uid()) is true
  from public.wordle_rooms r
  left join public.wordle_members m on m.room_id = r.id
  where r.invite_code = upper(trim(p_code))
  group by r.id;
$$;

-- Join by invite code. Idempotent: joining a room you're already in just returns it.
create function public.wordle_join_room(p_code text, p_display_name text, p_emoji text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.wordle_rooms;
  free_slot smallint;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into room from public.wordle_rooms where invite_code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;
  if exists (select 1 from public.wordle_members where room_id = room.id and user_id = auth.uid()) then
    return room.id;
  end if;
  select s into free_slot from generate_series(1, room.max_members) s
    where s not in (select slot from public.wordle_members where room_id = room.id)
    order by s limit 1;
  if free_slot is null then raise exception 'room is full'; end if;
  insert into public.wordle_members (room_id, user_id, slot, display_name, emoji)
    values (room.id, auth.uid(), free_slot, p_display_name, p_emoji);
  return room.id;
end;
$$;

-- Who has played which puzzle, without revealing scores. Powers "sealed" cards and the calendar.
create function public.wordle_submissions(p_room uuid, p_from_puzzle integer)
returns table (user_id uuid, puzzle_no integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id, r.puzzle_no from public.wordle_results r
  where r.room_id = p_room and r.puzzle_no >= p_from_puzzle and public.wordle_is_member(p_room);
$$;

/* ---------- grants ---------- */

grant select on public.wordle_rooms to authenticated;
grant update (name) on public.wordle_rooms to authenticated;
grant select, delete on public.wordle_members to authenticated;
grant update (display_name, emoji) on public.wordle_members to authenticated;
grant select, insert, delete on public.wordle_results to authenticated;

revoke all on function public.wordle_today() from public;
revoke all on function public.wordle_is_member(uuid) from public;
revoke all on function public.wordle_has_submitted(uuid, integer) from public;
revoke all on function public.wordle_create_room(text, text, text) from public;
revoke all on function public.wordle_room_preview(text) from public;
revoke all on function public.wordle_join_room(text, text, text) from public;
revoke all on function public.wordle_submissions(uuid, integer) from public;

grant execute on function public.wordle_today() to authenticated;
grant execute on function public.wordle_is_member(uuid) to authenticated;
grant execute on function public.wordle_has_submitted(uuid, integer) to authenticated;
grant execute on function public.wordle_create_room(text, text, text) to authenticated;
grant execute on function public.wordle_room_preview(text) to authenticated;
grant execute on function public.wordle_join_room(text, text, text) to authenticated;
grant execute on function public.wordle_submissions(uuid, integer) to authenticated;
