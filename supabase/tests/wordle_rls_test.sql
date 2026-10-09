-- Exercises the Wordle Duo security rules as three users. Every check prints PASS or FAIL.
\set ON_ERROR_STOP on
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
insert into auth.users values (:'A'), (:'B'), (:'C');

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

-- A creates a room
set request.jwt.claim.sub = :'A';
select invite_code as code, id as room from public.wordle_create_room('Us', 'Aryan', '🐻') \gset
select pg_temp.check('A sees own room', (select count(*) = 1 from public.wordle_rooms));

-- B previews and joins
set request.jwt.claim.sub = :'B';
select pg_temp.check('B cannot see room before joining', (select count(*) = 0 from public.wordle_rooms));
select pg_temp.check('B preview shows Aryan', (select member_names = array['Aryan'] from public.wordle_room_preview(:'code')));
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
update public.wordle_members set avatar_url = 'https://lh3.googleusercontent.com/a/abc=s96-c' where user_id = :'B';
select pg_temp.check('B can set a Google photo', (select avatar_url like 'https://lh3.googleusercontent.com/%' from public.wordle_members where user_id = :'B'));
select pg_temp.expect_error('B cannot set a non-Google photo', format(
  'update public.wordle_members set avatar_url = %L where user_id = %L', 'https://evil.example/pixel.gif', :'B'));
select pg_temp.expect_error('lookalike Google domain is rejected', format(
  'update public.wordle_members set avatar_url = %L where user_id = %L', 'https://googleusercontent.com.evil.example/x', :'B'));
delete from public.wordle_results where user_id = :'A';
set request.jwt.claim.sub = :'A';
select pg_temp.check('B could not delete A''s results', (select count(*) = 2 from public.wordle_results where user_id = :'A'));

-- Shared tables
select pg_temp.check('counter bumps', (select public.bump_counter('wordle-duo', 'plays') = 1 and public.bump_counter('wordle-duo', 'plays') = 2));
insert into public.scores (toy, display_name, value) values ('wordle-duo', 'Aryan', 3);
select pg_temp.expect_error('cannot post a score as someone else', format(
  'insert into public.scores (toy, user_id, display_name, value) values (%L, %L, %L, 1)', 'wordle-duo', :'B', 'Fake'));
