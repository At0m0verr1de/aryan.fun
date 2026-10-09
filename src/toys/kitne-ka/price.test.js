import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inr, inWords, parseGuess, points, verdict, meterPos, standings, kitneLine } from './price.js';

test('rupees are grouped the Indian way', () => {
  assert.equal(inr(5), '₹5');
  assert.equal(inr(4500), '₹4,500');
  assert.equal(inr(123456), '₹1,23,456');
  assert.equal(inr(12345678), '₹1,23,45,678');
  assert.equal(inWords(150000), '₹1.5 lakh');
  assert.equal(inWords(23000000), '₹2.3 crore');
  assert.equal(inWords(999), '₹999');
});

test('typed guesses understand k, lakh and crore', () => {
  assert.equal(parseGuess('499'), 499);
  assert.equal(parseGuess('₹ 1,20,000'), 120000);
  assert.equal(parseGuess('12k'), 12000);
  assert.equal(parseGuess('1.5L'), 150000);
  assert.equal(parseGuess('2 lakh'), 200000);
  assert.equal(parseGuess('3.2cr'), 32000000);
  assert.equal(parseGuess('0'), null);
  assert.equal(parseGuess('abc'), null);
  assert.equal(parseGuess('5 bananas'), null);
});

test('scoring matches the database', () => {
  assert.equal(points(100, 100), 100);
  assert.equal(points(200, 100), 37);
  assert.equal(points(50, 100), 37);
  assert.equal(points(300, 100), 0);
  assert.equal(points(110, 100), 91);
});

test('verdicts and the meter', () => {
  assert.equal(verdict(100, 100).title, 'Spot on!');
  assert.equal(verdict(1000, 100).sub, '10× too high');
  assert.equal(verdict(25, 100).title, 'Way too cheap');
  assert.equal(meterPos(100, 100), 0.5);
  assert.equal(meterPos(1, 100), 0);
  assert.equal(meterPos(300, 100), 1);
});

test('month standings count days you both finished', () => {
  const h = [
    { day: '2026-10-08', user_id: 'a', points: 300, n: 5 }, { day: '2026-10-08', user_id: 'r', points: 250, n: 5 },
    { day: '2026-10-07', user_id: 'a', points: 200, n: 5 }, { day: '2026-10-07', user_id: 'r', points: 200, n: 5 },
    { day: '2026-10-06', user_id: 'a', points: 100, n: 3 }, { day: '2026-10-06', user_id: 'r', points: 400, n: 5 },
    { day: '2026-09-30', user_id: 'a', points: 1, n: 5 }, { day: '2026-09-30', user_id: 'r', points: 400, n: 5 },
  ];
  assert.deepEqual(standings(h, 'a', 'r', '2026-10'), { me: 1, partner: 0, ties: 1, days: 2 });
});

test('home line', () => {
  const item = (o) => ({ guess: null, points: null, partner_played: false, partner_points: null, ...o });
  assert.equal(kitneLine({ items: Array(5).fill(item({})) }, 'Rupali'), 'Five new things to price today 🛒');
  assert.equal(kitneLine({ items: Array(5).fill(item({ partner_played: true })) }, 'Rupali'), 'Rupali has guessed today\'s prices, your turn 🛒');
  assert.equal(kitneLine({ items: Array(5).fill(item({ guess: 1, points: 60 })) }, 'Rupali'), 'You scored 300/500 · Rupali yet to finish');
  assert.equal(kitneLine({ items: Array(5).fill(item({ guess: 1, points: 60, partner_played: true, partner_points: 50 })) }, 'Rupali'), 'You won today 300–250 🏆');
});
