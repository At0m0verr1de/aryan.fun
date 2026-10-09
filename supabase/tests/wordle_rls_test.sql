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

set role authenticated;

-- Invite-only: C has no invite and isn't on the allowlist
set request.jwt.claim.sub = :'C';
select pg_temp.check('C has no access', (select not public.site_has_access()));
select pg_temp.expect_error('C cannot start a room', format('select public.wordle_create_room(%L, %L, %L)', 'Mine', 'Eve', '😈'));

-- A creates a room
set request.jwt.claim.sub = :'A';
select invite_code as code, id as room from public.wordle_create_room('Us', 'Aryan', '🐻') \gset
select pg_temp.check('A sees own room', (select count(*) = 1 from public.wordle_rooms));

-- B previews and joins
set request.jwt.claim.sub = :'B';
select pg_temp.check('B cannot see room before joining', (select count(*) = 0 from public.wordle_rooms));
select pg_temp.check('B preview shows Aryan', (select member_names = array['🐻 Aryan'] from public.wordle_room_preview(:'code')));
select pg_temp.check('B join returns room', (select public.wordle_join_room(lower(:'code'), 'Bae', '🐰') = :'room'::uuid));
select pg_temp.check('B join is idempotent', (select public.wordle_join_room(:'code', 'Bae', '🐰') = :'room'::uuid));
select pg_temp.check('B got slot 2', (select slot = 2 from public.wordle_members where user_id = :'B'));

-- C is locked out
set request.jwt.claim.sub = :'C';
select pg_temp.expect_error('C cannot join a full room', format('select public.wordle_join_room(%L, %L, %L)', :'code', 'Eve', '😈'));
select pg_temp.check('C preview says full', (select is_full from public.wordle_room_preview(:'code')));
select pg_temp.expect_error('C cannot insert into the room', format(
  'insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, source) values (%L, %L, public.wordle_today(), true, 3, %L)',
  :'room', :'C', 'manual'));

-- A plays today
set request.jwt.claim.sub = :'A';
insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, grid, source)
  values (:'room', :'A', public.wordle_today(), true, 3, array['BYBBB', 'GGYBB', 'GGGGG'], 'screenshot');
insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, source)
  values (:'room', :'A', public.wordle_today() - 5, true, 4, 'manual');

-- No spoilers for B
set request.jwt.claim.sub = :'B';
select pg_temp.check('B cannot read A''s result for today', (select count(*) = 0 from public.wordle_results where puzzle_no = public.wordle_today()));
select pg_temp.check('B can see that A played today', (select count(*) = 1 from public.wordle_submissions(:'room', public.wordle_today() - 10) where puzzle_no = public.wordle_today()));
select pg_temp.check('B can read A''s 5-day-old result', (select count(*) = 1 from public.wordle_results where puzzle_no = public.wordle_today() - 5));

-- B plays, then sees both
insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, source)
  values (:'room', :'B', public.wordle_today(), false, null, 'manual');
select pg_temp.check('B sees both results after playing', (select count(*) = 2 from public.wordle_results where puzzle_no = public.wordle_today()));

-- Tampering
select pg_temp.expect_error('B cannot submit as A', format(
  'insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, source) values (%L, %L, public.wordle_today() - 1, true, 2, %L)',
  :'room', :'A', 'manual'));
select pg_temp.expect_error('B cannot submit a future puzzle', format(
  'insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, source) values (%L, %L, public.wordle_today() + 3, true, 2, %L)',
  :'room', :'B', 'manual'));
select pg_temp.expect_error('solved without guesses is rejected', format(
  'insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, source) values (%L, %L, public.wordle_today() - 1, true, null, %L)',
  :'room', :'B', 'manual'));
select pg_temp.expect_error('bad grid is rejected', format(
  'insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, grid, source) values (%L, %L, public.wordle_today() - 1, true, 1, %L, %L)',
  :'room', :'B', '{GGGGX}', 'manual'));
insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, grid, words, answer, verified, source)
  values (:'room', :'B', public.wordle_today() - 2, true, 2, array['BYBBB', 'GGGGG'], array['CRANE', 'STREW'], 'STREW', true, 'screenshot');
select pg_temp.check('words and answer save', (select words = array['CRANE', 'STREW'] and verified
  from public.wordle_results where user_id = :'B' and puzzle_no = public.wordle_today() - 2));
select pg_temp.expect_error('word count must match rows', format(
  'insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, grid, words, answer, source) values (%L, %L, public.wordle_today() - 3, true, 2, %L, %L, %L, %L)',
  :'room', :'B', '{BYBBB,GGGGG}', '{STREW}', 'STREW', 'screenshot'));
select pg_temp.expect_error('lowercase or short words are rejected', format(
  'insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, grid, words, source) values (%L, %L, public.wordle_today() - 3, true, 1, %L, %L, %L)',
  :'room', :'B', '{GGGGG}', '{stre}', 'screenshot'));
select pg_temp.expect_error('solved board must end on the answer', format(
  'insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, grid, words, answer, source) values (%L, %L, public.wordle_today() - 3, true, 1, %L, %L, %L, %L)',
  :'room', :'B', '{GGGGG}', '{CRANE}', 'STREW', 'screenshot'));
select pg_temp.expect_error('verified needs an answer', format(
  'insert into public.wordle_results (room_id, user_id, puzzle_no, solved, guesses, grid, verified, source) values (%L, %L, public.wordle_today() - 3, true, 1, %L, true, %L)',
  :'room', :'B', '{GGGGG}', 'screenshot'));
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
select pg_temp.check('C preview shows a duo invite', (select room_kind = 'duo' from public.wordle_room_preview(:'code2')));
select pg_temp.check('C joins the friends room', (select public.wordle_join_room(:'code2', 'Cleo', '🦊') = :'room2'::uuid));
select pg_temp.check('C has access after joining', (select public.site_has_access()));
select pg_temp.expect_error('C cannot make A''s friends room a couple', format('select public.wordle_set_couple(%L, true)', :'room2'));
select invite_code as code3 from public.wordle_create_room('Cleo+?', 'Cleo', '🦊', 'couple') \gset
set request.jwt.claim.sub = :'A';
select pg_temp.expect_error('A cannot join someone else''s couple room', format('select public.wordle_join_room(%L, %L, %L)', :'code3', 'Aryan', '🐻'));
select pg_temp.expect_error('outsiders cannot change a couple', format('select public.wordle_set_couple(%L, false)', (select room_id from public.wordle_room_preview(:'code3'))));
select pg_temp.check('A can turn the couple off', (select kind = 'duo' and since is null from public.wordle_set_couple(:'room', false)));
select pg_temp.check('and back on', (select kind = 'couple' from public.wordle_set_couple(:'room', true)));
select pg_temp.expect_error('in_couple is not callable by players', format('select public.wordle_in_couple(%L)', :'A'));

-- Drinks: you and your partner only (A and B are a couple; C shares only a duo room with A)
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

-- Shared tables
select pg_temp.check('counter bumps', (select public.bump_counter('wordle-duo', 'plays') = 1 and public.bump_counter('wordle-duo', 'plays') = 2));
insert into public.scores (toy, display_name, value) values ('wordle-duo', 'Aryan', 3);
select pg_temp.expect_error('cannot post a score as someone else', format(
  'insert into public.scores (toy, user_id, display_name, value) values (%L, %L, %L, 1)', 'wordle-duo', :'B', 'Fake'));
