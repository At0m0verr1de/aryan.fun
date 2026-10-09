import test from 'node:test';
import assert from 'node:assert/strict';
import { togetherLabel } from './together.js';

test('together label grows from days to months to years', () => {
  assert.equal(togetherLabel(null, '2026-10-09'), null);
  assert.equal(togetherLabel('2026-10-10', '2026-10-09'), null);
  assert.equal(togetherLabel('2026-10-09', '2026-10-09'), 'day 1 together 🌱');
  assert.equal(togetherLabel('2026-10-03', '2026-10-09'), 'day 7 together');
  assert.equal(togetherLabel('2026-10-03', '2026-11-02'), 'day 31 together');
  assert.equal(togetherLabel('2026-10-03', '2026-11-03'), '1 month together today 🎉');
  assert.equal(togetherLabel('2026-10-03', '2026-11-04'), '1 month, 1 day together');
  assert.equal(togetherLabel('2026-01-31', '2026-03-01'), '1 month, 1 day together');
  assert.equal(togetherLabel('2026-10-03', '2027-10-03'), '1 year together today 🎉');
  assert.equal(togetherLabel('2026-10-03', '2028-12-20'), '2 years, 2 months together');
  assert.equal(togetherLabel('2026-10-03', '2027-10-20'), '1 year together');
});
