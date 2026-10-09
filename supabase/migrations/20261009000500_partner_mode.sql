-- Partner mode: a duo room can be a couple's room (at most one per person), and it powers the
-- couple home. The site is invite-only for now: you're "in" if you belong to any room (an invite
-- link got you there) or are on the site_access allowlist. Google photos are dropped for emojis.

alter table public.wordle_rooms
  add column kind text not null default 'duo' check (kind in ('duo', 'couple')),
  add column since date check (since is null or since >= date '1950-01-01');

alter table public.wordle_members drop column avatar_url;

-- Hand-managed allowlist for people who may start rooms without being invited (SQL editor only).
create table public.site_access (
  user_id  uuid        primary key references auth.users on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.site_access enable row level security;
revoke all on public.site_access from anon, authenticated;

create function public.site_has_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.site_access where user_id = auth.uid())
      or exists (select 1 from public.wordle_members where user_id = auth.uid());
$$;

-- Is this person already half of a couple (optionally ignoring one room)?
create function public.wordle_in_couple(p_user uuid, p_except uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wordle_members m join public.wordle_rooms r on r.id = m.room_id
    where m.user_id = p_user and r.kind = 'couple' and r.id is distinct from p_except
  );
$$;

-- Creating rooms needs access; a couple room needs you to be single.
drop function public.wordle_create_room(text, text, text);
create function public.wordle_create_room(p_name text, p_display_name text, p_emoji text, p_kind text default 'duo')
returns public.wordle_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.wordle_rooms;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.site_has_access() then raise exception 'invite only'; end if;
  if p_kind = 'couple' and public.wordle_in_couple(auth.uid()) then raise exception 'you already have a partner'; end if;
  insert into public.wordle_rooms (name, created_by, kind) values (p_name, auth.uid(), p_kind) returning * into room;
  insert into public.wordle_members (room_id, user_id, slot, display_name, emoji)
    values (room.id, auth.uid(), 1, p_display_name, p_emoji);
  return room;
end;
$$;

-- Joining by invite stays open (that's the invite); joining someone's couple room needs you to be single.
create or replace function public.wordle_join_room(p_code text, p_display_name text, p_emoji text)
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
  if room.kind = 'couple' and public.wordle_in_couple(auth.uid()) then raise exception 'you already have a partner'; end if;
  select s into free_slot from generate_series(1, room.max_members) s
    where s not in (select slot from public.wordle_members where room_id = room.id)
    order by s limit 1;
  if free_slot is null then raise exception 'room is full'; end if;
  insert into public.wordle_members (room_id, user_id, slot, display_name, emoji)
    values (room.id, auth.uid(), free_slot, p_display_name, p_emoji);
  return room.id;
end;
$$;

-- Turn a duo room into your couple room (or back), and set the together-since date. Either partner may.
create function public.wordle_set_couple(p_room uuid, p_couple boolean, p_since date default null)
returns public.wordle_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  room public.wordle_rooms;
begin
  if not public.wordle_is_member(p_room) then raise exception 'not your room'; end if;
  select * into room from public.wordle_rooms where id = p_room for update;
  if p_couple then
    if room.max_members <> 2 then raise exception 'a couple room is for two'; end if;
    if exists (select 1 from public.wordle_members m where m.room_id = p_room and public.wordle_in_couple(m.user_id, p_room)) then
      raise exception 'one of you already has a partner';
    end if;
  end if;
  update public.wordle_rooms
    set kind = case when p_couple then 'couple' else 'duo' end,
        since = case when p_couple then p_since end
    where id = p_room returning * into room;
  return room;
end;
$$;

-- Invite preview: emojis are back, and the invitee learns whether it's a couple invite.
drop function public.wordle_room_preview(text);
create function public.wordle_room_preview(p_code text)
returns table (room_id uuid, room_name text, member_names text[], is_full boolean, already_member boolean, room_kind text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name,
         coalesce(array_agg(m.emoji || ' ' || m.display_name order by m.slot) filter (where m.user_id is not null), '{}'),
         count(m.user_id) >= r.max_members,
         bool_or(m.user_id = auth.uid()) is true,
         r.kind
  from public.wordle_rooms r
  left join public.wordle_members m on m.room_id = r.id
  where r.invite_code = upper(trim(p_code))
  group by r.id;
$$;

revoke all on function public.site_has_access() from public, anon;
revoke all on function public.wordle_in_couple(uuid, uuid) from public, anon, authenticated;
revoke all on function public.wordle_create_room(text, text, text, text) from public, anon;
revoke all on function public.wordle_set_couple(uuid, boolean, date) from public, anon;
revoke all on function public.wordle_room_preview(text) from public, anon;

grant execute on function public.site_has_access() to authenticated;
grant execute on function public.wordle_create_room(text, text, text, text) to authenticated;
grant execute on function public.wordle_set_couple(uuid, boolean, date) to authenticated;
grant execute on function public.wordle_room_preview(text) to authenticated;
