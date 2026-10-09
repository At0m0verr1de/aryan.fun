import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, groupLine } from './summary.js';

const A = 'a';
const R = 'r';
const members = [{ user_id: A, slot: 1, display_name: 'Aryan' }, { user_id: R, slot: 2, display_name: 'Rupali' }];
const base = { members, meId: A, today: 100, monthStart: 95 };
const res = (user_id, puzzle_no, guesses) => ({ user_id, puzzle_no, solved: guesses !== null, guesses });
const sub = (user_id, puzzle_no) => ({ user_id, puzzle_no });

test('today line covers each state', () => {
  assert.equal(summarize({ ...base, submissions: [], results: [] }).today, "New puzzle today. Who's first? 👀");
  assert.equal(summarize({ ...base, submissions: [sub(R, 100)], results: [] }).today, 'Rupali played, your turn 👀');
  assert.equal(summarize({ ...base, submissions: [sub(A, 100)], results: [res(A, 100, 3)] }).today, 'Waiting for Rupali 💌');
  const both = { ...base, submissions: [sub(A, 100), sub(R, 100)] };
  assert.equal(summarize({ ...both, results: [res(A, 100, 3), res(R, 100, 4)] }).today, 'You won today 👑');
  assert.equal(summarize({ ...both, results: [res(A, 100, null), res(R, 100, 4)] }).today, 'Rupali won today 👑');
  assert.equal(summarize({ ...both, results: [res(A, 100, 4), res(R, 100, 4)] }).today, 'Tied today 💞');
});

test('month tally counts only this month and only days both played', () => {
  const results = [
    res(A, 90, 2), res(R, 90, 5),   // last month
    res(A, 96, 3), res(R, 96, 4),   // me
    res(A, 97, 5), res(R, 97, 2),   // partner
    res(A, 98, 5), res(R, 98, 3),   // partner
    res(A, 99, 4), res(R, 99, 4),   // tie
    res(A, 100, 3),                 // partner hasn't played
  ];
  assert.equal(summarize({ ...base, submissions: [], results }).tally, 'Rupali leads 2–1 👑 · 1 tie');
  assert.equal(summarize({ ...base, submissions: [], results: [] }).tally, '');
});

test('a couple still waiting for the partner', () => {
  assert.equal(summarize({ ...base, members: [members[0]], submissions: [], results: [] }).today, 'Waiting for your person to join 💌');
});

test('group home line: progress, then your place', () => {
  const people = [{ user_id: 'a', display_name: 'Aryan' }, { user_id: 'k', display_name: 'Kabir' }, { user_id: 'z', display_name: 'Zoya' }];
  const won = (g) => ({ solved: true, guesses: g });
  assert.match(groupLine(people.slice(0, 1), 'a', {}, new Set()), /Just you/);
  assert.equal(groupLine(people, 'a', {}, new Set()), "Nobody's played today. Go first 👀");
  assert.equal(groupLine(people, 'a', {}, new Set(['k'])), '1 of 3 played today, your turn 👀');
  assert.equal(groupLine(people, 'a', { a: won(3), k: won(2) }, new Set()), "2 of 3 played today · you're 2nd");
  assert.equal(groupLine(people, 'a', { a: won(2), k: won(4) }, new Set()), '2 of 3 played today · you lead 👑');
});
