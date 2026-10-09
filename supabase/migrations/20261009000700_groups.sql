-- Groups: rooms of up to 10 with a name and an icon, and Wordle results that belong to the person,
-- not the room. Play once and it counts in your couple room and every group you're in.
-- The no-spoiler rule now reads: you see someone's result if you share any room with them and you've
-- played that puzzle yourself (or it's two days old).

/* ---------- rooms: 'duo' becomes 'group', up to 10 people, an icon ---------- */
alter table public.wordle_rooms drop constraint wordle_rooms_kind_check;
update public.wordle_rooms set kind = 'group' where kind = 'duo';
alter table public.wordle_rooms
  alter column kind set default 'group',
  add constraint wordle_rooms_kind_check check (kind in ('group', 'couple')),
  add column icon text not null default '🎲' check (char_length(icon) between 1 and 8);

alter table public.wordle_rooms drop constraint wordle_rooms_max_members_check;
update public.wordle_rooms set max_members = 10 where kind = 'group';
alter table public.wordle_rooms
  alter column max_members set default 10,
  add constraint wordle_rooms_max_members_check check (max_members between 2 and 10),
  add constraint wordle_rooms_couple_is_two check (kind <> 'couple' or max_members = 2);

alter table public.wordle_members drop constraint wordle_members_slot_check;
alter table public.wordle_members add constraint wordle_members_slot_check check (slot between 1 and 10);

grant update (icon) on public.wordle_rooms to authenticated;

/* ---------- results: one per person per puzzle ---------- */
drop policy "no spoilers" on public.wordle_results;
drop policy "submit your own result" on public.wordle_results;
drop function public.wordle_has_submitted(uuid, integer);

-- Someone who played the same puzzle in two rooms keeps their first result.
delete from public.wordle_results r using public.wordle_results k
  where r.user_id = k.user_id and r.puzzle_no = k.puzzle_no
    and (r.created_at, r.room_id::text) > (k.created_at, k.room_id::text);

alter table public.wordle_results drop constraint wordle_results_pkey;
alter table public.wordle_results drop constraint wordle_results_room_id_user_id_fkey;
alter table public.wordle_results drop column room_id;
alter table public.wordle_results
  add primary key (user_id, puzzle_no),
  add constraint wordle_results_user_id_fkey foreign key (user_id) references auth.users on delete cascade;

-- Do you and this person share any room (a group or your couple)?
create function public.wordle_shares_room(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wordle_members a join public.wordle_members b on b.room_id = a.room_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

create function public.wordle_has_played(p_puzzle integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.wordle_results where user_id = auth.uid() and puzzle_no = p_puzzle);
$$;

create policy "no spoilers" on public.wordle_results for select to authenticated
  using (
    user_id = auth.uid()
    or (
      public.wordle_shares_room(user_id)
      and (public.wordle_has_played(puzzle_no) or puzzle_no <= public.wordle_today() - 2)
    )
  );
create policy "submit your own result" on public.wordle_results for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.site_has_access()
    and puzzle_no <= public.wordle_today() + 1
  );

-- Who in this room played which puzzle, without revealing scores.
create or replace function public.wordle_submissions(p_room uuid, p_from_puzzle integer)
returns table (user_id uuid, puzzle_no integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id, r.puzzle_no from public.wordle_results r
  join public.wordle_members m on m.user_id = r.user_id and m.room_id = p_room
  where r.puzzle_no >= p_from_puzzle and public.wordle_is_member(p_room);
$$;

/* ---------- RPCs ---------- */

-- Groups hold 10, a couple holds 2.
drop function public.wordle_create_room(text, text, text, text);
create function public.wordle_create_room(p_name text, p_display_name text, p_emoji text, p_kind text default 'group', p_icon text default '🎲')
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
  insert into public.wordle_rooms (name, created_by, kind, max_members, icon)
    values (p_name, auth.uid(), p_kind, case when p_kind = 'couple' then 2 else 10 end, coalesce(nullif(p_icon, ''), '🎲'))
    returning * into room;
  insert into public.wordle_members (room_id, user_id, slot, display_name, emoji)
    values (room.id, auth.uid(), 1, p_display_name, p_emoji);
  return room;
end;
$$;

-- A group of two can become your couple; unpairing turns it back into a group.
create or replace function public.wordle_set_couple(p_room uuid, p_couple boolean, p_since date default null)
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
    if (select count(*) from public.wordle_members where room_id = p_room) > 2 then
      raise exception 'a couple is just the two of you';
    end if;
    if exists (select 1 from public.wordle_members m where m.room_id = p_room and public.wordle_in_couple(m.user_id, p_room)) then
      raise exception 'one of you already has a partner';
    end if;
  end if;
  update public.wordle_rooms
    set kind = case when p_couple then 'couple' else 'group' end,
        since = case when p_couple then p_since end,
        max_members = case when p_couple then 2 else 10 end
    where id = p_room returning * into room;
  return room;
end;
$$;

-- The group's creator can remove people (not from a couple).
create function public.wordle_remove_member(p_room uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.wordle_rooms where id = p_room and created_by = auth.uid() and kind = 'group') then
    raise exception 'only the group''s creator can remove people';
  end if;
  if p_user = auth.uid() then raise exception 'use leave instead'; end if;
  delete from public.wordle_members where room_id = p_room and user_id = p_user;
end;
$$;

-- When someone leaves: an empty room goes away, and a creator who leaves hands over to the longest-standing member.
create function public.wordle_after_leave()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.wordle_members where room_id = old.room_id) then
    delete from public.wordle_rooms where id = old.room_id;
  else
    update public.wordle_rooms
      set created_by = (select user_id from public.wordle_members where room_id = old.room_id order by joined_at, slot limit 1)
      where id = old.room_id and created_by = old.user_id;
  end if;
  return null;
end;
$$;
create trigger wordle_after_leave after delete on public.wordle_members
  for each row execute function public.wordle_after_leave();

-- Invite preview: the group's icon and how full it is.
drop function public.wordle_room_preview(text);
create function public.wordle_room_preview(p_code text)
returns table (room_id uuid, room_name text, member_names text[], is_full boolean, already_member boolean,
               room_kind text, room_icon text, member_count integer, max_members smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name,
         coalesce(array_agg(m.emoji || ' ' || m.display_name order by m.slot) filter (where m.user_id is not null), '{}'),
         count(m.user_id) >= r.max_members,
         bool_or(m.user_id = auth.uid()) is true,
         r.kind, r.icon, count(m.user_id)::integer, r.max_members
  from public.wordle_rooms r
  left join public.wordle_members m on m.room_id = r.id
  where r.invite_code = upper(trim(p_code))
  group by r.id;
$$;

revoke all on function public.wordle_shares_room(uuid) from public, anon;
revoke all on function public.wordle_has_played(integer) from public, anon;
revoke all on function public.wordle_create_room(text, text, text, text, text) from public, anon;
revoke all on function public.wordle_remove_member(uuid, uuid) from public, anon;
revoke all on function public.wordle_after_leave() from public, anon, authenticated;
revoke all on function public.wordle_room_preview(text) from public, anon;

grant execute on function public.wordle_shares_room(uuid) to authenticated;
grant execute on function public.wordle_has_played(integer) to authenticated;
grant execute on function public.wordle_create_room(text, text, text, text, text) to authenticated;
grant execute on function public.wordle_remove_member(uuid, uuid) to authenticated;
grant execute on function public.wordle_room_preview(text) to authenticated;
