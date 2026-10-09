import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shotsOf, round1, bottlesOf, currentNight, personStats, dryStreak, weeksOf, monthsOf,
  hangoverInsight, jugOf, monthEnd, addMonths, mondayOf,
} from './stats.js';
import { drinksLine } from './summary.js';

const A = 'a';
const R = 'r';
const drink = (user_id, day, kind, ml, abv, qty = 1) => ({ user_id, day, kind, ml, abv, qty });

test('everything is measured in 30 ml / 40% shots', () => {
  assert.equal(shotsOf(drink(A, 'x', 'shot', 30, 40)), 1);
  assert.equal(shotsOf(drink(A, 'x', 'shot', 60, 40)), 2);
  assert.equal(round1(shotsOf(drink(A, 'x', 'beer', 650, 5))), 2.7);
  assert.equal(round1(shotsOf(drink(A, 'x', 'wine', 150, 12, 2))), 3);
  assert.equal(bottlesOf(25), 1);
});

test('drinks after midnight count for the night before', () => {
  assert.equal(currentNight(new Date(2026, 9, 10, 2, 30)), '2026-10-09');
  assert.equal(currentNight(new Date(2026, 9, 10, 6, 0)), '2026-10-10');
  assert.equal(currentNight(new Date(2026, 9, 10, 21, 0)), '2026-10-10');
});

test('month helpers', () => {
  assert.equal(monthEnd('2026-02-10'), '2026-02-28');
  assert.equal(monthEnd('2026-12-03'), '2026-12-31');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-01');
  assert.equal(addMonths('2026-01-15', -1), '2025-12-01');
  assert.equal(mondayOf('2026-10-11'), '2026-10-05');
});

const drinks = [
  drink(A, '2026-10-02', 'beer', 650, 5, 2),
  drink(A, '2026-10-02', 'shot', 30, 40),
  drink(A, '2026-10-05', 'shot', 30, 40, 3),
  drink(R, '2026-10-02', 'wine', 150, 12, 2),
  drink(R, '2026-09-30', 'wine', 150, 12),
];

test('person stats: totals, dry days so far, biggest night, favourite', () => {
  const s = personStats(drinks, A, '2026-10-01', '2026-10-31', '2026-10-09');
  assert.equal(round1(s.total), 9.4);
  assert.equal(s.nights, 2);
  assert.equal(s.dry, 7); // 9 days elapsed, 2 drinking nights
  assert.equal(s.biggest.day, '2026-10-02');
  assert.equal(s.favourite, 'shot'); // 4 shots vs 2 beers
  const r = personStats(drinks, R, '2026-10-01', '2026-10-31', '2026-10-09');
  assert.equal(round1(r.total), 3);
  const future = personStats(drinks, A, '2026-11-01', '2026-11-30', '2026-10-09');
  assert.equal(future.dry, 0);
});

test('dry streak counts back from today', () => {
  assert.equal(dryStreak(drinks, A, '2026-10-09'), 4);
  assert.equal(dryStreak(drinks, A, '2026-10-05'), 0);
});

test('weeks and months add up', () => {
  const weeks = weeksOf(drinks, '2026-10-01', '2026-10-31');
  assert.equal(weeks[0].start, '2026-09-28');
  assert.equal(round1(weeks[0].totals[A]), 6.4);
  assert.equal(round1(weeks[0].totals[R]), 3); // Sep 30 is outside the month
  assert.equal(weeks[1].totals[A], 3);
  const months = monthsOf(drinks, 2026);
  assert.equal(months.length, 12);
  assert.equal(round1(months[8].totals[R]), 1.5);
  assert.equal(round1(months[9].totals[A]), 9.4);
});

test('hangover insight needs a few rated nights of each kind', () => {
  const many = [
    drink(A, 'd1', 'shot', 30, 40, 2), drink(A, 'd2', 'shot', 30, 40, 3),
    drink(A, 'd3', 'shot', 30, 40, 6), drink(A, 'd4', 'shot', 30, 40, 8),
  ];
  const notes = [
    { user_id: A, day: 'd1', hangover: 0 }, { user_id: A, day: 'd2', hangover: 1 },
    { user_id: A, day: 'd3', hangover: 2 }, { user_id: A, day: 'd4', hangover: 3 },
  ];
  assert.deepEqual(hangoverInsight(many, notes, A), { easy: 2.5, rough: 7, threshold: 6, rated: 4 });
  assert.equal(hangoverInsight(many, notes.slice(0, 3), A), null);
});

test('the jug holds 15 shots a month, 180 a year, then you are cut off', () => {
  assert.deepEqual(jugOf(0), { cap: 15, level: 0, left: 15, over: false });
  assert.deepEqual(jugOf(6), { cap: 15, level: 0.4, left: 9, over: false });
  assert.deepEqual(jugOf(15), { cap: 15, level: 1, left: 0, over: false });
  assert.deepEqual(jugOf(15.1), { cap: 15, level: 1, left: 0, over: true });
  assert.deepEqual(jugOf(90, 12), { cap: 180, level: 0.5, left: 90, over: false });
});

test('home line shows this week, or a dry week', () => {
  const members = [{ user_id: A, display_name: 'Aryan' }, { user_id: R, display_name: 'Rupali' }];
  assert.equal(drinksLine(drinks, members, A, '2026-10-09'), 'This week: you 3 · Rupali 0 shots');
  assert.equal(drinksLine(drinks, members, A, '2026-10-20'), 'A dry week so far 🌱');
});
