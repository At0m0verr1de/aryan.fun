import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puzzleNo, dateForPuzzle, addDays, winnerOf, computeStats, weekStandings, scoreLabel } from './scoring.js';

const won = (guesses) => ({ solved: true, guesses });
const lost = { solved: false, guesses: null };

test('puzzle numbers round-trip with dates', () => {
  assert.equal(puzzleNo('2021-06-19'), 0);
  assert.equal(dateForPuzzle(puzzleNo('2026-10-09')), '2026-10-09');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('winner', () => {
  const cases = [
    { day: { p1: won(3), p2: won(4) }, want: 'p1' },
    { day: { p1: won(5), p2: won(2) }, want: 'p2' },
    { day: { p1: won(4), p2: won(4) }, want: 'tie' },
    { day: { p1: won(6), p2: lost }, want: 'p1' },
    { day: { p1: lost, p2: lost }, want: 'tie' },
    { day: { p1: won(3) }, want: null },
    { day: undefined, want: null },
  ];
  for (const c of cases) assert.equal(winnerOf(c.day), c.want);
});

test('score label', () => {
  assert.equal(scoreLabel(won(2)), '2');
  assert.equal(scoreLabel(lost), 'X');
});

test('stats: wins, ties, distribution, streaks', () => {
  const s = computeStats([
    [3, { p1: won(3), p2: won(4) }],
    [1, { p1: won(5), p2: won(2) }],
    [2, { p1: won(4), p2: won(4) }],
    [4, { p1: won(2), p2: lost }],
    [5, { p1: won(3) }], // only one played: counts for p1's dist, not for wins
  ]);
  assert.deepEqual(s.wins, { p1: 2, p2: 1 });
  assert.equal(s.ties, 1);
  assert.equal(s.per.p1.played, 5);
  assert.deepEqual(s.per.p1.dist, [0, 1, 2, 1, 1, 0, 0]);
  assert.deepEqual(s.per.p2.dist, [0, 1, 0, 2, 0, 0, 1]);
  assert.equal(s.per.p1.streak, 2);
  assert.equal(s.per.p1.best, 2);
  assert.equal(s.per.p2.streak, 0);
  assert.equal(s.per.p2.best, 1);
});

test('week standings count Monday through today', () => {
  // 2026-10-09 is a Friday; Monday is 2026-10-05.
  const days = {
    [puzzleNo('2026-10-04')]: { p1: won(2), p2: won(5) }, // Sunday, previous week
    [puzzleNo('2026-10-05')]: { p1: won(2), p2: won(5) },
    [puzzleNo('2026-10-07')]: { p1: won(6), p2: won(3) },
    [puzzleNo('2026-10-09')]: { p1: won(4), p2: won(4) },
  };
  assert.deepEqual(weekStandings((n) => days[n], '2026-10-09'), { p1: 1, p2: 1 });
});
