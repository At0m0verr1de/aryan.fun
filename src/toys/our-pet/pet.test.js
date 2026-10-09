import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moodOf, meterWord, speech, ageLabel, eventText, diary, petHomeLine, istDay } from './pet.js';

const NOON_IST = Date.parse('2026-10-09T06:30:00Z');
const MIDNIGHT_IST = Date.parse('2026-10-09T19:00:00Z');
const pet = (o = {}) => ({ name: 'Mochi', colour: 'pink', born_at: '2026-10-01T00:00:00Z', hunger: 80, happiness: 80, health: 80, died_at: null, ...o });

test('mood follows the emptiest meter, sleeps at night, dies', () => {
  assert.equal(moodOf(null, NOON_IST), 'egg');
  assert.equal(moodOf(pet(), NOON_IST), 'happy');
  assert.equal(moodOf(pet(), MIDNIGHT_IST), 'sleepy');
  assert.equal(moodOf(pet({ hunger: 10 }), NOON_IST), 'hungry');
  assert.equal(moodOf(pet({ happiness: 10 }), NOON_IST), 'sad');
  assert.equal(moodOf(pet({ health: 10, hunger: 5 }), NOON_IST), 'sick');
  assert.equal(moodOf(pet({ died_at: '2026-10-08T00:00:00Z' }), NOON_IST), 'dead');
  assert.equal(moodOf(pet({ hunger: 50 }), NOON_IST), 'okay');
});

test('meter words', () => {
  assert.equal(meterWord('hunger', 90), 'Full');
  assert.equal(meterWord('hunger', 0), 'Starving');
  assert.equal(meterWord('health', 30), 'Poorly');
});

test('speech nudges about toys not played, never shouts', () => {
  const state = { pet: pet(), last: { feed: '2026-10-09T05:00:00Z', kitne: '2026-10-09T05:00:00Z' } };
  const all = new Set(Array.from({ length: 40 }, (_, i) => speech(state, NOON_IST, 'Rupali', () => i % 40)).filter(Boolean));
  const lines = [...all].join('\n');
  assert.match(lines, /Wordle tiles/);
  assert.doesNotMatch(lines, /mango at the market/); // Kitne Ka? was played today
  assert.match(lines, /Rupali fed me/);
  assert.equal(speech({ pet: pet({ health: 5 }), last: {} }, NOON_IST, 'Rupali', () => 0), 'If I fade away, tell the Wordle tiles I loved them');
  assert.equal(speech({ pet: pet({ died_at: 'x' }) }, NOON_IST, 'R'), '🕊️');
});

test('age, diary and home line', () => {
  assert.equal(ageLabel('2026-10-09T05:00:00Z', NOON_IST), 'hatched today');
  assert.equal(ageLabel('2026-10-01T00:00:00Z', NOON_IST), '8 days old');
  const who = (id) => (id === 'a' ? 'You' : 'Rupali');
  assert.equal(eventText({ kind: 'feed', user_id: 'r' }, who, 'Mochi'), 'Rupali fed Mochi');
  const d = diary([
    { kind: 'pet', user_id: 'a', at: '2026-10-09T06:00:00Z' }, { kind: 'pet', user_id: 'a', at: '2026-10-09T05:00:00Z' },
    { kind: 'feed', user_id: 'r', at: '2026-10-09T04:00:00Z' },
  ]);
  assert.deepEqual(d.map((e) => [e.kind, e.n]), [['pet', 2], ['feed', 1]]);
  assert.equal(petHomeLine({ pet: null, graves: [] }, NOON_IST, 'R'), 'Hatch a pet together 🥚');
  assert.equal(petHomeLine({ pet: pet({ died_at: 'x' }) }, NOON_IST, 'R'), 'Mochi waited for you… 🕊️');
  assert.match(petHomeLine({ pet: pet(), last: {} }, NOON_IST, 'R'), /^Mochi: “/);
  assert.equal(istDay(MIDNIGHT_IST), '2026-10-10');
});
