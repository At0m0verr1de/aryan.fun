-- Players show their Google profile photo instead of an emoji. The old emoji column stays but is unused.

-- Only Google-hosted photos, so a player can't point the other's browser at an arbitrary URL.
alter table public.wordle_members add column avatar_url text
  check (avatar_url is null or (avatar_url ~ '^https://[a-z0-9-]+\.googleusercontent\.com/' and char_length(avatar_url) <= 500));

grant update (avatar_url) on public.wordle_members to authenticated;

-- Invite preview lists names only (it used to prefix each with the emoji).
create or replace function public.wordle_room_preview(p_code text)
returns table (room_id uuid, room_name text, member_names text[], is_full boolean, already_member boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name,
         coalesce(array_agg(m.display_name order by m.slot) filter (where m.user_id is not null), '{}'),
         count(m.user_id) >= r.max_members,
         bool_or(m.user_id = auth.uid()) is true
  from public.wordle_rooms r
  left join public.wordle_members m on m.room_id = r.id
  where r.invite_code = upper(trim(p_code))
  group by r.id;
$$;
