// Lightweight event logging to /api/events (worker/index.js → Cloudflare Workers Logs).
// Budget: Workers Logs free tier is 200k events/day, so events are batched, deduped, and capped per page.
// Never send names, emails, or anything a player typed; the Supabase user id is enough to look things up.

const ENDPOINT = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}api/events`;
const FLUSH_MS = 4000;
const MAX_EVENTS_PER_PAGE = 40;
const MAX_ERRORS_PER_PAGE = 10;
const MAX_TEXT = 300;
const SESSION_KEY = 'mba:session';

const queue = [];
const seenErrors = new Set();
let sent = 0;
let errorsSent = 0;
let userId = null;
let timer = null;

// crypto.randomUUID only exists on https pages; getRandomValues works everywhere, so plain http can't break every page.
function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// One id per browser tab; isNewSession is true only on the tab's first page.
let isNew = false;
const sessionId = (() => {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) { id = newId(); sessionStorage.setItem(SESSION_KEY, id); isNew = true; }
    return id;
  } catch {
    isNew = true;
    return newId();
  }
})();
export const isNewSession = isNew;

const clip = (value) => (typeof value === 'string' ? value.slice(0, MAX_TEXT) : value);

export function setUser(id) {
  userId = id || null;
}

// Queue one event. Props must be flat primitives; strings are clipped.
export function track(name, props = {}) {
  if (sent >= MAX_EVENTS_PER_PAGE) return;
  sent++;
  const clean = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) clean[k] = clip(v);
  }
  queue.push({ name, at: new Date().toISOString(), path: location.pathname, props: clean });
  clearTimeout(timer);
  timer = setTimeout(flush, FLUSH_MS);
}

// Report an error once per page per message. `where` says which feature hit it.
export function reportError(err, where = 'app') {
  const message = String(err?.message || err || 'unknown error');
  const key = `${where}:${message}`;
  if (seenErrors.has(key) || errorsSent >= MAX_ERRORS_PER_PAGE) return;
  seenErrors.add(key);
  errorsSent++;
  const stack = typeof err?.stack === 'string' ? err.stack.split('\n').slice(0, 4).join(' | ') : undefined;
  track('error', { where, message, code: err?.code ?? err?.status ?? null, stack });
}

export function flush() {
  clearTimeout(timer);
  if (!queue.length) return;
  const body = JSON.stringify({ session: sessionId, user: userId, events: queue.splice(0) });
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon?.(ENDPOINT, blob)) return;
    fetch(ENDPOINT, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
  } catch { /* logging must never break the page */ }
}

addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
addEventListener('pagehide', flush);
addEventListener('error', (e) => {
  // Resource load errors (img/script) have no message; skip them.
  if (e.message) reportError(e.error || e.message, 'window');
});
addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
