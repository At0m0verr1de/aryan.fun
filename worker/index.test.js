import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { cleanProps, toLogLines, answerDateAllowed } from './index.js';

const SESSION = '11111111-2222-3333-4444-555555555555';
const req = (body, headers = {}) => new Request('https://madebyaryan.example/api/events', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers,
});

test('keeps known events, drops unknown ones', () => {
  const lines = toLogLines({ session: SESSION, user: null, events: [
    { name: 'account_created', at: '2026-10-09T00:00:00Z', path: '/', props: { provider: 'google' } },
    { name: 'drop_table', props: {} },
  ] }, req({}));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, 'account_created');
  assert.equal(lines[0].provider, 'google');
  assert.equal(lines[0].session, SESSION);
  assert.equal(lines[0].level, 'info');
});

test('errors are logged at error level', () => {
  const [line] = toLogLines({ events: [{ name: 'error', props: { message: 'boom' } }] }, req({}));
  assert.equal(line.level, 'error');
  assert.equal(line.message, 'boom');
});

test('props are flattened, clipped and capped', () => {
  const props = cleanProps({ long: 'x'.repeat(1000), nested: { a: 1 }, list: [1], ok: true, n: 3 });
  assert.equal(props.long.length, 300);
  assert.equal(props.nested, undefined);
  assert.equal(props.list, undefined);
  assert.equal(props.ok, true);
  const many = cleanProps(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])));
  assert.equal(Object.keys(many).length, 12);
});

test('bad ids become null and batches are capped', () => {
  const events = Array.from({ length: 60 }, () => ({ name: 'sign_in' }));
  const lines = toLogLines({ session: 'not-a-uuid', user: '<script>', events }, req({}));
  assert.equal(lines.length, 25);
  assert.equal(lines[0].session, null);
  assert.equal(lines[0].user, null);
});

test('endpoint rejects other sites, junk, and wrong methods', async () => {
  const env = { ASSETS: { fetch: () => new Response('asset') } };
  const silence = console.log;
  console.log = () => {};
  try {
    assert.equal((await worker.fetch(req({ events: [] }, { origin: 'https://evil.example' }), env)).status, 403);
    assert.equal((await worker.fetch(req('{nope'), env)).status, 400);
    assert.equal((await worker.fetch(req({ events: [{ name: 'sign_in' }] }), env)).status, 204);
    assert.equal((await worker.fetch(new Request('https://madebyaryan.example/api/events'), env)).status, 405);
    assert.equal(await (await worker.fetch(new Request('https://madebyaryan.example/nope'), env)).text(), 'asset');
  } finally {
    console.log = silence;
  }
});

test('answer dates: real, not before Wordle #0, not after tomorrow', () => {
  const now = Date.parse('2026-10-09T12:00:00Z');
  assert.ok(answerDateAllowed('2026-10-09', now));
  assert.ok(answerDateAllowed('2026-10-10', now));
  assert.ok(answerDateAllowed('2021-06-19', now));
  assert.ok(!answerDateAllowed('2026-10-12', now));
  assert.ok(!answerDateAllowed('2021-06-18', now));
  assert.ok(!answerDateAllowed('2026-02-30', now));
  assert.ok(!answerDateAllowed('../etc', now));
});

test('answer endpoint returns the uppercase solution and caches it', async () => {
  const stored = new Map();
  globalThis.caches = { default: { match: async (k) => stored.get(k.url)?.clone(), put: async (k, r) => { stored.set(k.url, r); } } };
  const realFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async (url) => {
    upstreamCalls++;
    assert.equal(url, 'https://www.nytimes.com/svc/wordle/v2/2026-10-08.json');
    return Response.json({ solution: 'strew', days_since_launch: 1937 });
  };
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  try {
    const first = await worker.fetch(new Request('https://madebyaryan.example/api/wordle/2026-10-08'), {}, ctx);
    assert.deepEqual(await first.json(), { date: '2026-10-08', puzzle: 1937, solution: 'STREW' });
    await Promise.all(pending);
    const second = await worker.fetch(new Request('https://madebyaryan.example/api/wordle/2026-10-08'), {}, ctx);
    assert.equal((await second.json()).solution, 'STREW');
    assert.equal(upstreamCalls, 1);
    assert.equal((await worker.fetch(new Request('https://madebyaryan.example/api/wordle/2099-01-01'), {}, ctx)).status, 400);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.caches;
  }
});
