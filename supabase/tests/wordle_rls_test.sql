-- Exercises the Wordle Duo security rules as three users. Every check prints PASS or FAIL.
\set ON_ERROR_STOP on
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
insert into auth.users values (:'A'), (:'B'), (:'C');
insert into public.site_access values (:'A');

create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

-- expect_error runs a statement and passes only if it fails
create function pg_temp.expect_error(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice 'FAIL % (no error)', label;
exception when others then
  raise notice 'PASS % (%)', label, sqlerrm;
end $$;

-- Chess: no http extension here, so chess.com is a table of canned answers (url → status, etag, body).
create table public.test_chess (url text primary key, status int not null, etag text, body jsonb);
create or replace function public.chess_get(p_url text, p_etag text, out status integer, out etag text, out body jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  select t.status, t.etag, t.body into status, etag, body from public.test_chess t where t.url = p_url;
  if not found then status := 404; etag := null; body := null; return; end if;
  if p_etag is not null and p_etag = etag then status := 304; body := null; end if;
end $$;
create function pg_temp.game(id text, w text, wres text, b text, bres text, ended text, rules text default 'chess') returns jsonb language sql as $$
  select jsonb_build_object('uuid', id, 'url', 'https://www.chess.com/game/live/' || id, 'end_time', extract(epoch from ended::timestamptz)::bigint,
    'time_class', 'blitz', 'rated', true, 'rules', rules, 'fen', '8/8/8/8/8/8/8/8 w - - 0 31',
    'eco', 'https://www.chess.com/openings/Italian-Game-Two-Knights-Defense-4.d3', 'accuracies', jsonb_build_object('white', 81.5, 'black', 74.2),
    'white', jsonb_build_object('username', w, 'result', wres, 'rating', 900), 'black', jsonb_build_object('username', b, 'result', bres, 'rating', 950)) $$;
select to_char(now() at time zone 'utc', 'YYYY/MM') as chess_month \gset
insert into public.test_chess values
  ('https://api.chess.com/pub/player/aryan_b/games/archives', 200, null, jsonb_build_object('archives', jsonb_build_array(
    'https://api.chess.com/pub/player/aryan_b/games/2026/07', 'https://api.chess.com/pub/player/aryan_b/games/2026/08',
    'https://api.chess.com/pub/player/aryan_b/games/' || :'chess_month'))),
  ('https://api.chess.com/pub/player/rupa/games/archives', 200, null, jsonb_build_object('archives', jsonb_build_array(
    'https://api.chess.com/pub/player/rupa/games/2026/08', 'https://api.chess.com/pub/player/rupa/games/' || :'chess_month'))),
  ('https://api.chess.com/pub/player/aryan_b/games/' || :'chess_month', 200, 'e1', jsonb_build_object('games', jsonb_build_array(
    pg_temp.game('g1', 'Aryan_B', 'win', 'Rupa', 'checkmated', '2026-10-02 20:00Z'),
    pg_temp.game('g2', 'rupa', 'repetition', 'aryan_b', 'repetition', '2026-10-03 20:00Z'),
    pg_temp.game('g3', 'aryan_b', 'win', 'stranger', 'resigned', '2026-10-04 20:00Z'),
    pg_temp.game('g4', 'aryan_b', 'win', 'rupa', 'resigned', '2026-10-05 20:00Z', 'chess960')))),
  ('https://api.chess.com/pub/player/aryan_b/games/2026/08', 200, null, jsonb_build_object('games', jsonb_build_array(
    pg_temp.game('g5', 'rupa', 'win', 'aryan_b', 'resigned', '2026-08-20 20:00Z'))));

set role authenticated;

-- Invite-only: C has no invite and isn't on the allowlist
set request.jwt.claim.sub = :'C';
select pg_temp.check('C has no access', (select not public.site_has_access()));
select pg_temp.expect_error('C cannot start a room', format('select public.wordle_create_room(%L, %L, %L)', 'Mine', 'Eve', '😈'));

-- Request access: C can ask, sees only their own request, can't read others or approve themselves
select pg_temp.check('C has not asked yet', (select public.my_access_request() is null));
select pg_temp.check('C asks for access', (select public.request_access() is not null));
select pg_temp.check('asking twice keeps the first time', (select public.request_access() = public.my_access_request()));
select pg_temp.check('asking still gives no access', (select not public.site_has_access()));
select pg_temp.expect_error('C cannot read the requests', 'select * from public.access_requests');
select pg_temp.expect_error('C cannot approve themselves', format('insert into public.site_access values (%L)', :'C'));
select pg_temp.expect_error('the clean-up trigger is not callable', 'select public.access_request_granted()');
set request.jwt.claim.sub = :'A';
select pg_temp.check('A already has access, so asking does nothing', (select public.request_access() is null and public.my_access_request() is null));
reset role;
begin;
insert into public.site_access values (:'C');
select pg_temp.check('approving clears the request', (select not exists (select 1 from public.access_requests where user_id = :'C')));
rollback;
set role anon;
select pg_temp.expect_error('signed-out visitors cannot ask', 'select public.request_access()');
set role authenticated;
set request.jwt.claim.sub = :'C';

-- A creates a room
set request.jwt.claim.sub = :'A';
select invite_code as code, id as room from public.wordle_create_room('Us', 'Aryan', '🐻') \gset
select pg_temp.check('A sees own room', (select count(*) = 1 from public.wordle_rooms));
select pg_temp.check('new rooms are groups of 10', (select kind = 'group' and max_members = 10 and icon = '🎲' from public.wordle_rooms where id = :'room'));

-- B previews and joins
set request.jwt.claim.sub = :'B';
select pg_temp.check('B cannot see room before joining', (select count(*) = 0 from public.wordle_rooms));
select pg_temp.check('B preview shows Aryan', (select member_names = array['🐻 Aryan'] from public.wordle_room_preview(:'code')));
select pg_temp.check('B join returns room', (select public.wordle_join_room(lower(:'code'), 'Bae', '🐰') = :'room'::uuid));
select pg_temp.check('B join is idempotent', (select public.wordle_join_room(:'code', 'Bae', '🐰') = :'room'::uuid));
select pg_temp.check('B got slot 2', (select slot = 2 from public.wordle_members where user_id = :'B'));

-- C, with no invite, can't post results
set request.jwt.claim.sub = :'C';
select pg_temp.expect_error('C cannot post a result without an invite', format(
  'insert into public.wordle_results (user_id, puzzle_no, solved, guesses, source) values (%L, public.wordle_today(), true, 3, %L)',
  :'C', 'manual'));

-- A plays today
set request.jwt.claim.sub = :'A';
insert into public.wordle_results (user_id, puzzle_no, solved, guesses, grid, source)
  values (:'A', public.wordle_today(), true, 3, array['BYBBB', 'GGYBB', 'GGGGG'], 'screenshot');
insert into public.wordle_results (user_id, puzzle_no, solved, guesses, source)
  values (:'A', public.wordle_today() - 5, true, 4, 'manual');

-- No spoilers for B
set request.jwt.claim.sub = :'B';
select pg_temp.check('B cannot read A''s result for today', (select count(*) = 0 from public.wordle_results where puzzle_no = public.wordle_today()));
select pg_temp.check('B can see that A played today', (select count(*) = 1 from public.wordle_submissions(:'room', public.wordle_today() - 10) where puzzle_no = public.wordle_today()));
select pg_temp.check('B can read A''s 5-day-old result', (select count(*) = 1 from public.wordle_results where puzzle_no = public.wordle_today() - 5));

-- B plays, then sees both
insert into public.wordle_results (user_id, puzzle_no, solved, guesses, source)
  values (:'B', public.wordle_today(), false, null, 'manual');
select pg_temp.check('B sees both results after playing', (select count(*) = 2 from public.wordle_results where puzzle_no = public.wordle_today()));

-- Tampering
select pg_temp.expect_error('B cannot submit as A', format(
  'insert into public.wordle_results (user_id, puzzle_no, solved, guesses, source) values (%L, public.wordle_today() - 1, true, 2, %L)',
  :'A', 'manual'));
select pg_temp.expect_error('B cannot submit a future puzzle', format(
  'insert into public.wordle_results (user_id, puzzle_no, solved, guesses, source) values (%L, public.wordle_today() + 3, true, 2, %L)',
  :'B', 'manual'));
select pg_temp.expect_error('solved without guesses is rejected', format(
  'insert into public.wordle_results (user_id, puzzle_no, solved, guesses, source) values (%L, public.wordle_today() - 1, true, null, %L)',
  :'B', 'manual'));
select pg_temp.expect_error('bad grid is rejected', format(
  'insert into public.wordle_results (user_id, puzzle_no, solved, guesses, grid, source) values (%L, public.wordle_today() - 1, true, 1, %L, %L)',
  :'B', '{GGGGX}', 'manual'));
insert into public.wordle_results (user_id, puzzle_no, solved, guesses, grid, words, answer, verified, source)
  values (:'B', public.wordle_today() - 2, true, 2, array['BYBBB', 'GGGGG'], array['CRANE', 'STREW'], 'STREW', true, 'screenshot');
select pg_temp.check('words and answer save', (select words = array['CRANE', 'STREW'] and verified
  from public.wordle_results where user_id = :'B' and puzzle_no = public.wordle_today() - 2));
select pg_temp.expect_error('word count must match rows', format(
  'insert into public.wordle_results (user_id, puzzle_no, solved, guesses, grid, words, answer, source) values (%L, public.wordle_today() - 3, true, 2, %L, %L, %L, %L)',
  :'B', '{BYBBB,GGGGG}', '{STREW}', 'STREW', 'screenshot'));
select pg_temp.expect_error('lowercase or short words are rejected', format(
  'insert into public.wordle_results (user_id, puzzle_no, solved, guesses, grid, words, source) values (%L, public.wordle_today() - 3, true, 1, %L, %L, %L)',
  :'B', '{GGGGG}', '{stre}', 'screenshot'));
select pg_temp.expect_error('solved board must end on the answer', format(
  'insert into public.wordle_results (user_id, puzzle_no, solved, guesses, grid, words, answer, source) values (%L, public.wordle_today() - 3, true, 1, %L, %L, %L, %L)',
  :'B', '{GGGGG}', '{CRANE}', 'STREW', 'screenshot'));
select pg_temp.expect_error('verified needs an answer', format(
  'insert into public.wordle_results (user_id, puzzle_no, solved, guesses, grid, verified, source) values (%L, public.wordle_today() - 3, true, 1, %L, true, %L)',
  :'B', '{GGGGG}', 'screenshot'));
select pg_temp.expect_error('B cannot change own slot', 'update public.wordle_members set slot = 5 where user_id = auth.uid()');
select pg_temp.expect_error('B cannot move self to another room', format(
  'update public.wordle_members set room_id = gen_random_uuid() where user_id = %L', :'B'));
select pg_temp.expect_error('B cannot rewrite a result', format(
  'update public.wordle_results set guesses = 1 where user_id = %L', :'B'));
select pg_temp.expect_error('B cannot change the invite code', format('update public.wordle_rooms set invite_code = %L', 'HACKED'));

update public.wordle_members set display_name = 'Bub' where user_id = :'B';
select pg_temp.check('B can rename self', (select display_name = 'Bub' from public.wordle_members where user_id = :'B'));
update public.wordle_members set emoji = '🐱' where user_id = :'B';
select pg_temp.check('B can change emoji', (select emoji = '🐱' from public.wordle_members where user_id = :'B'));
select pg_temp.check('B has access via the invite', (select public.site_has_access()));
select pg_temp.expect_error('B cannot flip the room kind directly', format('update public.wordle_rooms set kind = %L', 'couple'));
delete from public.wordle_results where user_id = :'A';
set request.jwt.claim.sub = :'A';
select pg_temp.check('B could not delete A''s results', (select count(*) = 2 from public.wordle_results where user_id = :'A'));

-- Couples: one per person
select pg_temp.check('a partner makes the room a couple room', (select kind = 'couple' and since = date '2025-02-14'
  from public.wordle_set_couple(:'room', true, date '2025-02-14')));
set request.jwt.claim.sub = :'A';
select pg_temp.check('A sees the couple room', (select kind = 'couple' from public.wordle_rooms where id = :'room'));
select pg_temp.expect_error('A cannot start a second couple', format('select public.wordle_create_room(%L, %L, %L, %L)', 'Two', 'Aryan', '🐻', 'couple'));
select invite_code as code2, id as room2 from public.wordle_create_room('Friends', 'Aryan', '🐻') \gset
set request.jwt.claim.sub = :'C';
select pg_temp.check('C preview shows a group invite', (select room_kind = 'group' and member_count = 1 and max_members = 10 from public.wordle_room_preview(:'code2')));
select pg_temp.check('C joins the friends room', (select public.wordle_join_room(:'code2', 'Cleo', '🦊') = :'room2'::uuid));
select pg_temp.check('C has access after joining', (select public.site_has_access()));
select pg_temp.expect_error('C cannot make A''s friends room a couple', format('select public.wordle_set_couple(%L, true)', :'room2'));
select invite_code as code3 from public.wordle_create_room('Cleo+?', 'Cleo', '🦊', 'couple') \gset
set request.jwt.claim.sub = :'A';
select pg_temp.expect_error('A cannot join someone else''s couple room', format('select public.wordle_join_room(%L, %L, %L)', :'code3', 'Aryan', '🐻'));
select pg_temp.expect_error('outsiders cannot change a couple', format('select public.wordle_set_couple(%L, false)', (select room_id from public.wordle_room_preview(:'code3'))));
select pg_temp.check('A can turn the couple off', (select kind = 'group' and since is null and max_members = 10 from public.wordle_set_couple(:'room', false)));
select pg_temp.check('and back on', (select kind = 'couple' and max_members = 2 from public.wordle_set_couple(:'room', true)));
select pg_temp.expect_error('in_couple is not callable by players', format('select public.wordle_in_couple(%L)', :'A'));

-- Drinks: you and your partner only (A and B are a couple; C shares only a group with A)
insert into public.drinks (day, kind, ml, abv, qty) values (current_date, 'beer', 330, 5, 2) returning id as drink \gset
set request.jwt.claim.sub = :'B';
select pg_temp.check('partner sees the drink', (select count(*) = 1 from public.drinks where user_id = :'A'));
select pg_temp.expect_error('partner cannot log as A', format(
  'insert into public.drinks (user_id, day, kind, ml, abv) values (%L, current_date, %L, 30, 40)', :'A', 'shot'));
select pg_temp.expect_error('no drinks from the future', 'insert into public.drinks (day, kind, ml, abv) values (current_date + 3, ''shot'', 30, 40)');
select pg_temp.expect_error('silly strength is rejected', 'insert into public.drinks (day, kind, ml, abv) values (current_date, ''shot'', 30, 140)');
delete from public.drinks where id = :'drink';
insert into public.drink_days (day, hangover, note) values (current_date, 2, 'never again')
  on conflict (user_id, day) do update set day = excluded.day, hangover = excluded.hangover, note = excluded.note;
insert into public.drink_days (day, hangover, note) values (current_date, 3, 'okay maybe again')
  on conflict (user_id, day) do update set day = excluded.day, hangover = excluded.hangover, note = excluded.note;
select pg_temp.check('hangover note upserts', (select hangover = 3 from public.drink_days where user_id = :'B'));
set request.jwt.claim.sub = :'A';
select pg_temp.check('partner could not delete the drink', (select count(*) = 1 from public.drinks where id = :'drink'));
select pg_temp.check('A reads B''s hangover note', (select note = 'okay maybe again' from public.drink_days where user_id = :'B'));
insert into public.drink_goals (weekly_shots) values (10)
  on conflict (user_id) do update set weekly_shots = excluded.weekly_shots;
update public.drink_days set note = 'edited' where user_id = :'B';
select pg_temp.check('A cannot edit B''s note', (select note = 'okay maybe again' from public.drink_days where user_id = :'B'));
set request.jwt.claim.sub = :'C';
select pg_temp.check('a friend sees no drinks', (select count(*) = 0 from public.drinks));
select pg_temp.check('a friend sees no notes or goals', (select count(*) = 0 from public.drink_days) and (select count(*) = 0 from public.drink_goals));
set request.jwt.claim.sub = :'B';
select pg_temp.check('partner sees the goal', (select weekly_shots = 10 from public.drink_goals where user_id = :'A'));
select public.wordle_set_couple(:'room', false);
select pg_temp.check('after unpairing the drinks are private again', (select count(*) = 0 from public.drinks where user_id = :'A'));
select public.wordle_set_couple(:'room', true);
set request.jwt.claim.sub = :'A';

-- Chess: games come only from chess.com via the database; only the couple sees them
set request.jwt.claim.sub = :'A';
select pg_temp.check('no usernames yet', (select jsonb_array_length(public.chess_state() -> 'names') = 0));
select pg_temp.expect_error('junk usernames are refused', 'select public.chess_set_names(''no spaces!'', ''rupa'')');
select pg_temp.expect_error('two of the same are refused', 'select public.chess_set_names(''rupa'', ''RUPA'')');
select pg_temp.check('usernames save, lowercased', (select public.chess_set_names(' Aryan_B ', 'Rupa') -> 'names' @> '[{"username": "aryan_b"}, {"username": "rupa"}]'));
select public.chess_sync() as chess \gset
select pg_temp.check('first sync reads this month: our two games, not the stranger or the variant', (select jsonb_array_length(:'chess'::jsonb -> 'games') = 2));
select pg_temp.check('a month you both played is left to catch up on', (select (:'chess'::jsonb -> 'sync' ->> 'backlog')::int = 1));
select pg_temp.check('checkmate: winner and how', (select exists (select 1 from jsonb_array_elements(:'chess'::jsonb -> 'games') g
  where g ->> 'id' = 'g1' and g ->> 'winner' = :'A' and g ->> 'how' = 'checkmated' and g ->> 'white' = :'A' and (g ->> 'moves')::int = 31)));
select pg_temp.check('a draw has no winner', (select exists (select 1 from jsonb_array_elements(:'chess'::jsonb -> 'games') g
  where g ->> 'id' = 'g2' and g ->> 'winner' is null and g ->> 'how' = 'repetition')));
select pg_temp.check('opening name is tidied', (select :'chess'::jsonb -> 'games' -> 0 ->> 'opening' = 'Italian Game Two Knights Defense'));
select pg_temp.check('catching up skips the once-a-minute wait', (select jsonb_array_length(public.chess_sync() -> 'games') = 3));
select pg_temp.check('nothing left to catch up on', (select (public.chess_state() -> 'sync' ->> 'backlog')::int = 0));
select pg_temp.check('syncing again straight away is a no-op', (select jsonb_array_length(public.chess_sync() -> 'games') = 3));
select pg_temp.expect_error('nobody reads the games table', 'select * from public.chess_games');
select pg_temp.expect_error('nobody writes a game', format('insert into public.chess_games (room_id, id, url, ended_at, time_class, rated, white, black, how) values (public.jar_room(), %L, %L, now(), %L, true, %L, %L, %L)', 'fake', 'x', 'blitz', :'A', :'B', 'checkmated'));
select pg_temp.expect_error('the chess.com fetcher is not callable', 'select public.chess_get(''https://example.com'', null)');
select pg_temp.expect_error('nor is a raw sync of any room', 'select public.chess_sync_room(public.jar_room(), 9)');
select pg_temp.expect_error('nor the background run', 'select public.chess_sync_all()');
set request.jwt.claim.sub = :'B';
select pg_temp.check('B sees the same games', (select jsonb_array_length(public.chess_state() -> 'games') = 3));
set request.jwt.claim.sub = :'C';
select pg_temp.check('a friend (alone in their own couple room) sees none of our chess', (select public.chess_state() -> 'games' = '[]'::jsonb and public.chess_state() -> 'names' = '[]'::jsonb));
select pg_temp.expect_error('a friend cannot set usernames', 'select public.chess_set_names(''eve'', ''aryan_b'')');
set request.jwt.claim.sub = :'A';
select pg_temp.check('a wrong username is reported and the old history cleared', (select (public.chess_set_names('ghost_x', 'rupa') -> 'games') = '[]'::jsonb
  and public.chess_sync() -> 'sync' ->> 'error' = 'chess.com has no player called ghost_x'));
select public.chess_set_names('aryan_b', 'rupa');

-- Date Jar: only the couple; partner's slips stay folded until drawn; one shared draw; one veto a week
select public.jar_add('Pottery class', 3000, null, 'out', 'evening') as slip_a \gset
set request.jwt.claim.sub = :'B';
select public.jar_add('Blanket fort movie night', 0, :'B', 'in', 'evening') as slip_b \gset
select pg_temp.check('B sees both slips', (select jsonb_array_length(public.jar_state()->'slips') = 2));
select pg_temp.check('A''s slip is folded for B, cost still showing', (select s->>'idea' is null and (s->>'cost')::int = 3000
  from jsonb_array_elements(public.jar_state()->'slips') s where s->>'id' = :'slip_a'));
select pg_temp.check('B reads their own slip', (select s->>'idea' = 'Blanket fort movie night'
  from jsonb_array_elements(public.jar_state()->'slips') s where s->>'id' = :'slip_b'));
select pg_temp.expect_error('nobody reads the jar table directly', 'select * from public.jar_slips');
select pg_temp.expect_error('the payer has to be one of the couple', format('select public.jar_add(%L, 100, %L, %L, %L)', 'Dinner', :'C', 'out', 'evening'));
select pg_temp.expect_error('B cannot take out A''s slip', format('select public.jar_remove(%L)', :'slip_a'));
select pg_temp.expect_error('a draw with no match fails', 'select public.jar_draw(''in'', ''day'', null)');
select (public.jar_draw('out', null, 5000))->>'idea' as drawn_idea \gset
select pg_temp.check('B draws A''s slip and can read it', (:'drawn_idea' = 'Pottery class'));
select pg_temp.expect_error('one date at a time', 'select public.jar_draw()');
set request.jwt.claim.sub = :'A';
select pg_temp.check('A sees B drew it', (select s->>'status' = 'drawn' and s->>'drawn_by' = :'B'
  from jsonb_array_elements(public.jar_state()->'slips') s where s->>'id' = :'slip_a'));
select public.jar_veto(:'slip_a');
select pg_temp.check('a veto puts it back', (select s->>'status' = 'jar'
  from jsonb_array_elements(public.jar_state()->'slips') s where s->>'id' = :'slip_a'));
select pg_temp.check('and the veto is counted', (select jsonb_array_length(public.jar_state()->'vetoes') = 1));
select public.jar_draw('out', null, null);
select pg_temp.expect_error('one veto a week', format('select public.jar_veto(%L)', :'slip_a'));
set request.jwt.claim.sub = :'B';
select public.jar_done(:'slip_a', 2800, 5::smallint, 'we made a wonky bowl');
set request.jwt.claim.sub = :'A';
select pg_temp.check('the memory is shared', (select s->>'memory' = 'we made a wonky bowl' and (s->>'spent')::int = 2800
  from jsonb_array_elements(public.jar_state()->'slips') s where s->>'id' = :'slip_a'));
select pg_temp.expect_error('done dates cannot be taken out', format('select public.jar_remove(%L)', :'slip_a'));
select pg_temp.expect_error('jar_room is not callable', 'select public.jar_room()');
set request.jwt.claim.sub = :'C';
select pg_temp.check('a friend sees none of the jar', (select jsonb_array_length(public.jar_state()->'slips') = 0));
select pg_temp.expect_error('a friend cannot veto it', format('select public.jar_veto(%L)', :'slip_a'));
select pg_temp.expect_error('or rewrite the memory', format('select public.jar_done(%L, 0, 1::smallint, %L)', :'slip_a', 'hacked'));
set request.jwt.claim.sub = :'A';
select public.wordle_set_couple(:'room', false);
select pg_temp.check('unpaired, the jar is closed', (select jsonb_array_length(public.jar_state()->'slips') = 0));
select public.wordle_set_couple(:'room', true);

-- Our pet: shared by the couple, meters drain with time, dies after 7 days alone, other toys feed it
set request.jwt.claim.sub = :'A';
select pg_temp.check('no pet yet', (select public.pet_state() -> 'pet' = 'null'::jsonb));
select pg_temp.expect_error('a nameless pet is refused', 'select public.pet_adopt(''  '', ''pink'')');
select pg_temp.expect_error('an odd colour is refused', 'select public.pet_adopt(''Mochi'', ''plaid'')');
select pg_temp.check('A hatches Mochi, meters full', (select p -> 'name' = '"Mochi"' and (p ->> 'hunger')::real = 100 and (p ->> 'health')::real = 100
  from (select public.pet_adopt(' Mochi ', 'pink') -> 'pet' as p) x));
select pg_temp.expect_error('one pet at a time', 'select public.pet_adopt(''Bun'', ''blue'')');
select pg_temp.expect_error('nobody reads the pet table', 'select * from public.pets');
select pg_temp.expect_error('nobody writes the meters', 'update public.pets set health = 100');
select pg_temp.expect_error('the boost is not callable', 'select public.pet_boost(public.jar_room(), null, ''wordle'')');
select pg_temp.expect_error('nor the meter maths', 'select public.pet_apply(public.jar_room(), 100, 100, 100)');
select pg_temp.expect_error('unknown actions are refused', 'select public.pet_act(''tickle'')');
select public.pet_act('feed');
select public.pet_act('feed');
select public.pet_act('feed');
select pg_temp.check('three feeds a day count', (select (public.pet_act('feed') -> 'today' ->> 'feed')::int = 3));
set request.jwt.claim.sub = :'B';
select pg_temp.check('B sees the same pet and what A did', (select s -> 'pet' ->> 'name' = 'Mochi' and s -> 'today' = '{}'::jsonb
  and s -> 'events' -> 0 ->> 'kind' = 'feed' and s -> 'events' -> 0 ->> 'user_id' = :'A' from (select public.pet_state() as s) x));
reset role;
update public.pets set hunger = 50, happiness = 50, health = 50, updated_at = now();
set role authenticated;
insert into public.drinks (day, kind, ml, abv, qty) values (current_date, 'beer', 330, 5, 1);
select pg_temp.check('logging a drink cheers the pet up', (select (p ->> 'hunger')::real between 59.9 and 60 and (p ->> 'health')::real between 69.9 and 70
  from (select public.pet_state() -> 'pet' as p) x));
insert into public.drinks (day, kind, ml, abv, qty) values (current_date, 'beer', 330, 5, 1);
select pg_temp.check('but only once a day per toy', (select (public.pet_state() -> 'pet' ->> 'health')::real < 70.1));
select pg_temp.check('and the toy shows as recently played', (select public.pet_state() -> 'last' ? 'drinks'));
reset role;
update public.pets set hunger = 100, happiness = 100, health = 100, updated_at = now() - interval '48 hours';
set role authenticated;
select pg_temp.check('two days alone: starving, a bit sad, health mostly fine', (select (p ->> 'hunger')::real = 0
  and (p ->> 'happiness')::real between 33 and 34 and (p ->> 'health')::real between 85 and 86 and p ->> 'died_at' is null
  from (select public.pet_state() -> 'pet' as p) x));
reset role;
update public.pets set hunger = 100, happiness = 100, health = 100, updated_at = now() - interval '6 days 23 hours';
set role authenticated;
select pg_temp.check('just under 7 days alone: still hanging on', (select p ->> 'died_at' is null and (p ->> 'health')::real between 0.1 and 1.5
  from (select public.pet_state() -> 'pet' as p) x));
reset role;
update public.pets set hunger = 100, happiness = 100, health = 100, updated_at = now() - interval '7 days 1 hour';
set role authenticated;
select pg_temp.check('7 days alone and it dies, right at 7 days', (select abs(extract(epoch from (p ->> 'died_at')::timestamptz - (now() - interval '1 hour'))) < 120
  and (p ->> 'health')::real = 0 from (select public.pet_state() -> 'pet' as p) x));
select pg_temp.check('feeding cannot bring it back', (select public.pet_act('feed') -> 'pet' ->> 'died_at' is not null));
select pg_temp.check('a new egg after a loss', (select s -> 'pet' ->> 'name' = 'Bun' and s -> 'pet' ->> 'died_at' is null
  and s -> 'graves' -> 0 ->> 'name' = 'Mochi' from (select public.pet_adopt('Bun', 'blue') as s) x));
set request.jwt.claim.sub = :'C';
select pg_temp.check('a friend sees no pet of ours', (select public.pet_state() -> 'pet' = 'null'::jsonb and public.pet_state() -> 'graves' = '[]'::jsonb));
select pg_temp.expect_error('and cannot hatch one alone', 'select public.pet_adopt(''Solo'', ''mint'')');
set request.jwt.claim.sub = :'A';

-- Kitne Ka?: same five for both, prices and partner guesses only after you guess
select pg_temp.check('five things to price today, no prices shown', (select jsonb_array_length(t -> 'items') = 5
  and not exists (select 1 from jsonb_array_elements(t -> 'items') i where i ->> 'price' is not null)
  from (select public.price_today() as t) x));
reset role;
select i.price as p0, i.id as i0 from public.price_items_for(public.price_today_date()) t join public.price_items i on i.id = t.item_id where t.slot = 0 \gset
set role authenticated;
select pg_temp.check('a spot-on guess scores 100 and shows the price', (select (i ->> 'points')::int = 100 and (i ->> 'price')::bigint = :p0
  from (select public.price_guess(0, :p0) -> 'items' -> 0 as i) x));
select pg_temp.expect_error('one guess per thing', format('select public.price_guess(0, %s)', :p0));
select pg_temp.expect_error('no sixth item', 'select public.price_guess(5, 100)');
select pg_temp.expect_error('no free things', 'select public.price_guess(1, 0)');
select pg_temp.expect_error('nobody reads the price list', 'select * from public.price_items');
select pg_temp.expect_error('nobody reads guesses directly', 'select * from public.price_guesses');
select pg_temp.expect_error('the day''s picks are not callable', 'select * from public.price_items_for(current_date)');
set request.jwt.claim.sub = :'B';
select pg_temp.check('B sees A played, but not A''s guess or the price', (select (i ->> 'partner_played')::boolean and i ->> 'partner_guess' is null and i ->> 'price' is null
  from (select public.price_today() -> 'items' -> 0 as i) x));
select pg_temp.check('double the price scores 37, and now A''s guess shows', (select (i ->> 'points')::int = 37 and (i ->> 'partner_guess')::bigint = :p0 and (i ->> 'partner_points')::int = 100
  from (select public.price_guess(0, :p0 * 2) -> 'items' -> 0 as i) x));
select pg_temp.check('playing feeds the pet', (select public.pet_state() -> 'last' ? 'kitne'));
set request.jwt.claim.sub = :'A';
select pg_temp.check('B''s total today stays hidden until A finishes', (select not exists (select 1 from jsonb_array_elements(public.price_today() -> 'history') h where h ->> 'user_id' = :'B')));
select public.price_guess(1, 100);
select public.price_guess(2, 1000);
select public.price_guess(3, 10000);
select pg_temp.check('after all five, B''s total shows', (select exists (select 1 from jsonb_array_elements(public.price_guess(4, 100000) -> 'history') h
  where h ->> 'user_id' = :'B' and (h ->> 'points')::int = 37)));
set request.jwt.claim.sub = :'C';
select pg_temp.check('a friend gets the same five but none of our guesses', (select not exists (select 1 from jsonb_array_elements(public.price_today() -> 'items') i
  where (i ->> 'partner_played')::boolean or i ->> 'guess' is not null)));
set request.jwt.claim.sub = :'A';

-- Groups: a result belongs to the person and shows in every room you share with them
set request.jwt.claim.sub = :'C';
select pg_temp.check('a group sees A''s old result', (select count(*) = 1 from public.wordle_results where user_id = :'A' and puzzle_no = public.wordle_today() - 5));
select pg_temp.check('but not today''s until C plays', (select count(*) = 0 from public.wordle_results where user_id = :'A' and puzzle_no = public.wordle_today()));
select pg_temp.check('and nothing of B, who shares no room with C', (select count(*) = 0 from public.wordle_results where user_id = :'B'));
insert into public.wordle_results (user_id, puzzle_no, solved, guesses, source) values (:'C', public.wordle_today(), true, 4, 'manual');
select pg_temp.check('one play unlocks today in the group', (select count(*) = 1 from public.wordle_results where user_id = :'A' and puzzle_no = public.wordle_today()));
select pg_temp.expect_error('one result per person per day', format(
  'insert into public.wordle_results (user_id, puzzle_no, solved, guesses, source) values (%L, public.wordle_today(), true, 2, %L)', :'C', 'manual'));
select pg_temp.check('a room lists only its own people''s plays', (select count(distinct user_id) = 2 from public.wordle_submissions(:'room2', public.wordle_today() - 10)));
set request.jwt.claim.sub = :'B';
select pg_temp.check('the couple room does not list C', (select count(*) = 0 from public.wordle_submissions(:'room', 0) where user_id = :'C'));

-- Groups hold 10 (A and C are in Friends; eight more fill it)
reset role;
insert into auth.users select ('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid from generate_series(1, 9) n;
set role authenticated;
select set_config('test.code2', :'code2', false);
do $$ begin
  for n in 1..8 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'), false);
    perform public.wordle_join_room(current_setting('test.code2'), 'P' || n, '🐸');
  end loop;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000109';
select pg_temp.check('a group holds 10', (select is_full and member_count = 10 from public.wordle_room_preview(:'code2')));
select pg_temp.expect_error('the 11th person is turned away', format('select public.wordle_join_room(%L, %L, %L)', :'code2', 'P9', '🐸'));

-- Only the creator removes people; a leaving creator hands over
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select pg_temp.expect_error('members cannot remove each other', format('select public.wordle_remove_member(%L, %L)', :'room2', '00000000-0000-0000-0000-000000000102'));
select pg_temp.expect_error('a big group cannot become a couple', format('select public.wordle_set_couple(%L, true)', :'room2'));
set request.jwt.claim.sub = :'A';
select public.wordle_remove_member(:'room2', :'C');
select pg_temp.check('the creator removes someone', (select count(*) = 9 from public.wordle_members where room_id = :'room2'));
select pg_temp.expect_error('nobody is removed from a couple', format('select public.wordle_remove_member(%L, %L)', :'room', :'B'));
set request.jwt.claim.sub = :'C';
select pg_temp.check('a removed member loses the group', (select count(*) = 0 from public.wordle_rooms where id = :'room2'));
select pg_temp.check('and sight of its people''s results', (select count(*) = 0 from public.wordle_results where user_id = :'A'));
set request.jwt.claim.sub = :'A';
delete from public.wordle_members where room_id = :'room2' and user_id = :'A';
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';
select pg_temp.check('a leaving creator hands the group on', (select created_by = auth.uid() from public.wordle_rooms where id = :'room2'));
select pg_temp.expect_error('the trigger is not callable', 'select public.wordle_after_leave()');
set request.jwt.claim.sub = :'A';

-- Shared tables
select pg_temp.check('counter bumps', (select public.bump_counter('wordle-duo', 'plays') = 1 and public.bump_counter('wordle-duo', 'plays') = 2));
insert into public.scores (toy, display_name, value) values ('wordle-duo', 'Aryan', 3);
select pg_temp.expect_error('cannot post a score as someone else', format(
  'insert into public.scores (toy, user_id, display_name, value) values (%L, %L, %L, 1)', 'wordle-duo', :'B', 'Fake'));
