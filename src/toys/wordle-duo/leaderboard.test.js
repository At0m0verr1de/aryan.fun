import test from 'node:test';
import assert from 'node:assert/strict';
import { pointsOf, rankDay, standings, streakOf, dayHeadline } from './leaderboard.js';

const m = (id, name) => ({ user_id: id, display_name: name });
const members = [m('a', 'Aryan'), m('k', 'Kabir'), m('r', 'Rupali'), m('z', 'Zoya')];
const won = (guesses, t = '1') => ({ solved: true, guesses, created_at: t });
const lost = { solved: false, guesses: null, created_at: '9' };

test('points: 6 for a one-guess solve down to 1, nothing for a fail', () => {
  assert.equal(pointsOf(won(1)), 6);
  assert.equal(pointsOf(won(6)), 1);
  assert.equal(pointsOf(lost), 0);
  assert.equal(pointsOf(undefined), 0);
});

test('a day ranks by guesses, ties share, then sealed, then not played', () => {
  const rows = rankDay(members, { a: won(4, '2'), k: won(3), r: won(4, '1') }, new Set(['z', 'a', 'k', 'r']));
  assert.deepEqual(rows.map((r) => [r.member.user_id, r.rank]), [['k', 1], ['r', 2], ['a', 2], ['z', null]]);
  assert.equal(rows[3].played, true);
  const idle = rankDay(members, { a: lost }, new Set(['a']));
  assert.deepEqual(idle.map((r) => r.member.user_id), ['a', 'k', 'r', 'z']);
  assert.equal(idle[0].rank, 1);
  assert.equal(idle[1].played, false);
});

test('standings add points, share ranks on ties, and track streaks', () => {
  const days = { 10: { a: won(3), k: won(2) }, 11: { a: won(4), k: lost }, 12: { a: lost, r: won(1) }, 13: { k: won(5) } };
  const get = (n) => days[n];
  const rows = standings(members, get, 10, 13);
  assert.deepEqual(rows.map((r) => [r.member.user_id, r.points, r.rank]), [['a', 7, 1], ['k', 7, 1], ['r', 6, 3], ['z', 0, 4]]);
  assert.equal(rows[0].avg, 3.5);
  assert.equal(rows.find((r) => r.member.user_id === 'a').streak, 3, 'day 13 (today) not played yet');
  assert.equal(streakOf('a', get, 14, 0), 0, 'a whole missed day breaks it');
  assert.equal(streakOf('r', get, 13, 12), 1, 'never counts before the floor');
  assert.equal(streakOf('k', get, 14, 0), 1, 'not having played today yet keeps the streak');
});

test('headline covers each stage of the day', () => {
  const played = new Set(['a', 'k', 'r', 'z']);
  assert.match(dayHeadline(rankDay([m('a', 'Aryan')]), 'a', true), /Just you/);
  assert.match(dayHeadline(rankDay(members), 'a', true), /Go first/);
  assert.equal(dayHeadline(rankDay(members, {}, new Set(['k', 'r'])), 'a', true), '2 of 4 played. Add yours to see their boards 🤫');
  assert.equal(dayHeadline(rankDay(members, { a: won(3), k: won(4) }), 'a', true), 'You lead with 3/6 · 2 of 4 played');
  assert.equal(dayHeadline(rankDay(members, { a: won(3), k: won(3), r: won(5), z: lost }, played), 'a', true), '👑 You & Kabir tie with 3/6');
  assert.equal(dayHeadline(rankDay(members, { a: won(4), k: won(2) }), 'a', false), '👑 Kabir wins with 2/6');
});
