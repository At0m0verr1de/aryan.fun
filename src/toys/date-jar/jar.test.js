import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareOf, money, fairness, vetoesLeft, matches, jarLine, costBand, seeded, pictureOf, WEEK_MS } from './jar.js';

const A = 'a';
const B = 'b';
const members = [{ user_id: A }, { user_id: B }];
const slip = (o) => ({ status: 'jar', cost: 0, payer: null, place: 'out', length: 'evening', added_by: A, ...o });

test('a share is half when split, all or nothing when one person treats', () => {
  assert.equal(shareOf(slip({ cost: 1000 }), A), 500);
  assert.equal(shareOf(slip({ cost: 1000, payer: B }), A), 0);
  assert.equal(shareOf(slip({ cost: 1000, payer: B }), B), 1000);
  assert.equal(shareOf(slip({ cost: 1000, status: 'done', spent: 1400 }), A), 700);
  assert.equal(shareOf(slip({ cost: 1000, status: 'done', spent: null }), A), 500);
});

test('money: whole jar, average draw, up next, this month', () => {
  const slips = [
    slip({ cost: 1000 }),                                               // jar, split
    slip({ cost: 3000, payer: A }),                                     // jar, A treats
    slip({ cost: 600, status: 'drawn', payer: B }),                     // up next, B treats
    slip({ cost: 2000, status: 'done', spent: 2400, done_at: '2026-10-05T10:00:00Z' }),
    slip({ cost: 800, status: 'done', spent: 800, done_at: '2026-09-20T10:00:00Z' }),
  ];
  const [a, b] = money(slips, members, '2026-10-01');
  assert.deepEqual(a, { userId: A, jar: 3500, nextDraw: 1750, upNext: 0, month: 1200, ever: 1600 });
  assert.deepEqual(b, { userId: B, jar: 500, nextDraw: 250, upNext: 600, month: 1200, ever: 1600 });
  assert.equal(money([], members, '2026-10-01')[0].nextDraw, 0);
});

test('fairness line', () => {
  const name = (id) => (id === A ? 'Aryan' : 'Rupali');
  assert.equal(fairness([{ userId: A, jar: 500 }, { userId: B, jar: 520 }], name), 'Pretty even ⚖️');
  assert.equal(fairness([{ userId: A, jar: 300 }, { userId: B, jar: 600 }], name), 'Rupali treats more 💸');
  assert.equal(fairness([{ userId: A, jar: 3500 }, { userId: B, jar: 500 }], name), 'Aryan treats more 💸💸');
  assert.equal(fairness([{ userId: A, jar: 0 }, { userId: B, jar: 0 }], name), '');
  assert.equal(fairness([{ userId: A, jar: 900 }, { userId: B, jar: 100 }], () => 'You'), 'You treat more 💸💸');
});

test('a picture for each date', () => {
  assert.equal(pictureOf('Pottery class', 'out'), '🎨');
  assert.equal(pictureOf('Blanket fort and the first movie', 'in'), '🎬');
  assert.equal(pictureOf('Something new', 'in'), '🛋️');
  assert.equal(pictureOf(null, 'out'), '🌆');
});

test('one veto a rolling week', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  assert.deepEqual(vetoesLeft([], A, now), { left: 1, backAt: null });
  const used = [{ user_id: A, at: '2026-10-07T12:00:00Z' }, { user_id: B, at: '2026-10-08T12:00:00Z' }];
  assert.deepEqual(vetoesLeft(used, A, now), { left: 0, backAt: Date.parse('2026-10-07T12:00:00Z') + WEEK_MS });
  assert.equal(vetoesLeft([{ user_id: A, at: '2026-10-01T11:00:00Z' }], A, now).left, 1);
});

test('mood filters', () => {
  const s = slip({ cost: 400, place: 'in', length: 'quick' });
  assert.ok(matches(s, {}));
  assert.ok(matches(s, { place: 'in', max: 500 }));
  assert.ok(!matches(s, { place: 'out' }));
  assert.ok(!matches(s, { max: 300 }));
  assert.ok(!matches({ ...s, status: 'drawn' }, {}));
});

test('home line', () => {
  assert.equal(jarLine([], A), 'Empty jar. Write the first date idea ✍️');
  assert.equal(jarLine([slip({}), slip({ added_by: B }), slip({ added_by: B })], A), '3 dates folded inside · 2 secrets 🤫');
  assert.equal(jarLine([slip({})], A), '1 date folded inside');
  assert.equal(jarLine([slip({ status: 'drawn', idea: 'Pottery class' })], A), 'Up next: Pottery class 💌');
});

test('cost bands and stable randomness', () => {
  assert.deepEqual([0, 400, 1500, 4000, 9000].map(costBand), ['Free', '₹', '₹₹', '₹₹₹', '₹₹₹₹']);
  assert.equal(seeded('x', 1), seeded('x', 1));
  assert.notEqual(seeded('x', 1), seeded('x', 2));
  assert.ok(seeded('y', 3) >= 0 && seeded('y', 3) < 1);
});
