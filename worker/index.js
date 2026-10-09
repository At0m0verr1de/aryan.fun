// Cloudflare Worker for madebyaryan. Static files in dist/ are served before this runs;
// it only sees requests that match no file, plus misses (passed back to assets for the 404).
//
// /api/events          browser telemetry (src/shared/telemetry.js) → Workers Logs lines.
//                      Free tier is 200k log events/day, so everything is capped and unknown events dropped.
// /api/wordle/<date>   that day's Wordle answer from NYT, so the browser can check a screenshot locally.

export const EVENTS = new Set([
  'session_start', 'account_created', 'sign_in', 'sign_in_failed', 'sign_out', 'error',
  'wordle_room_created', 'wordle_room_joined', 'wordle_room_left', 'wordle_result_saved',
  'wordle_screenshot_unreadable', 'wordle_invite_shared', 'wordle_screenshot_rejected', 'wordle_words_read',
  'wordle_answer_unavailable',
]);
const MAX_BODY_BYTES = 16 * 1024;
const MAX_EVENTS = 25;
const MAX_PROPS = 12;
const MAX_TEXT = 300;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIRST_WORDLE = '2021-06-19';
const DAY_MS = 86400000;
const ANSWER_CACHE_SECONDS = 86400;
const NYT_URL = (date) => `https://www.nytimes.com/svc/wordle/v2/${date}.json`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const clip = (v, n = MAX_TEXT) => (typeof v === 'string' ? v.slice(0, n) : v);
const uuidOrNull = (v) => (typeof v === 'string' && UUID.test(v) ? v : null);

// Keeps only flat primitive props, clipped, so one bad client can't blow up a log line.
export function cleanProps(props) {
  const out = {};
  if (!props || typeof props !== 'object') return out;
  for (const [k, v] of Object.entries(props).slice(0, MAX_PROPS)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[clip(k, 40)] = clip(v);
  }
  return out;
}

// Returns the log lines for a request body, or null if the body is rejected.
export function toLogLines(body, request) {
  if (!body || !Array.isArray(body.events)) return null;
  const session = uuidOrNull(body.session);
  const user = uuidOrNull(body.user);
  const country = request.cf?.country ?? null;
  const ua = clip(request.headers.get('user-agent') ?? '', 160);
  return body.events
    .slice(0, MAX_EVENTS)
    .filter((e) => e && EVENTS.has(e.name))
    .map((e) => ({
      level: e.name === 'error' || e.name === 'sign_in_failed' ? 'error' : 'info',
      event: e.name,
      at: clip(e.at, 40),
      path: clip(e.path, 120),
      session,
      user,
      country,
      ua,
      ...cleanProps(e.props),
    }));
}

const sameSite = (request) => {
  const origin = request.headers.get('origin');
  return !origin || new URL(origin).host === new URL(request.url).host;
};

async function ingest(request) {
  if (!sameSite(request)) return new Response(null, { status: 403 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  let body;
  try { body = JSON.parse(text); } catch { return new Response(null, { status: 400 }); }
  const lines = toLogLines(body, request);
  if (!lines) return new Response(null, { status: 400 });
  for (const line of lines) {
    if (line.level === 'error') console.error(line);
    else console.log(line);
  }
  return new Response(null, { status: 204 });
}

// Allowed: a real date from Wordle #0 up to tomorrow (UTC), since some time zones are a day ahead.
export function answerDateAllowed(date, now = Date.now()) {
  if (!DATE.test(date) || date < FIRST_WORDLE) return false;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== date) return false;
  return parsed <= now + DAY_MS;
}

const json = (body, status, maxAge) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
});

async function answer(date, ctx) {
  if (!answerDateAllowed(date)) return json({ error: 'date not allowed' }, 400);
  const cache = caches.default;
  const key = new Request(`https://cache.madebyaryan/wordle/${date}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  const upstream = await fetch(NYT_URL(date), { headers: { 'user-agent': 'madebyaryan (hobby site)' } });
  if (!upstream.ok) {
    console.error({ level: 'error', event: 'worker_error', where: 'wordle-answer', status: upstream.status, date });
    return json({ error: 'answer unavailable' }, 502);
  }
  const data = await upstream.json();
  if (typeof data.solution !== 'string' || !/^[a-z]{5}$/i.test(data.solution)) return json({ error: 'answer unavailable' }, 502);
  const response = json({ date, puzzle: data.days_since_launch ?? null, solution: data.solution.toUpperCase() }, 200, ANSWER_CACHE_SECONDS);
  ctx?.waitUntil?.(cache.put(key, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/wordle/')) {
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
      try {
        return await answer(pathname.slice('/api/wordle/'.length), ctx);
      } catch (err) {
        console.error({ level: 'error', event: 'worker_error', where: 'wordle-answer', message: clip(String(err?.message || err)) });
        return json({ error: 'answer unavailable' }, 502);
      }
    }
    if (pathname === '/api/events') {
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
      try {
        return await ingest(request);
      } catch (err) {
        console.error({ level: 'error', event: 'worker_error', message: clip(String(err?.message || err)) });
        return new Response(null, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
