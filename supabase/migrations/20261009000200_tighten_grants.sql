-- Supabase grants ALL on new public tables and functions to anon and authenticated by default.
-- That silently widens the column-level grants above, so reset to exactly what each toy needs.

-- Future objects: start with nothing; each toy migration grants what it uses.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;

-- Existing tables
revoke all on public.counters, public.scores,
  public.wordle_rooms, public.wordle_members, public.wordle_results
  from anon, authenticated;

grant select on public.counters, public.scores to anon, authenticated;
grant insert, delete on public.scores to authenticated;

grant select on public.wordle_rooms to authenticated;
grant update (name) on public.wordle_rooms to authenticated;
grant select, delete on public.wordle_members to authenticated;
grant update (display_name, emoji) on public.wordle_members to authenticated;
grant select, insert, delete on public.wordle_results to authenticated;

-- Existing functions: Wordle Duo is signed-in only, so anon gets none of them.
revoke all on function public.wordle_today() from anon;
revoke all on function public.wordle_is_member(uuid) from anon;
revoke all on function public.wordle_has_submitted(uuid, integer) from anon;
revoke all on function public.wordle_create_room(text, text, text) from anon;
revoke all on function public.wordle_room_preview(text) from anon;
revoke all on function public.wordle_join_room(text, text, text) from anon;
revoke all on function public.wordle_submissions(uuid, integer) from anon;
