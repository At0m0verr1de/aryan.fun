// Chess Mates page: first-time usernames, the rivalry (score + tug-of-war rope), the last game's final position,
// stats, the game list, and the sync bar. Games come only from the database's chess.com sync.
import { isConfigured, currentUser } from '../../shared/supabase.js';
import { loadSpace, emojiOf } from '../../shared/space.js';
import { track, reportError } from '../../shared/telemetry.js';
import * as api from './api.js';
import {
  headToHead, streak, byColour, byClass, favouriteOpening, fastestWin, bestAccuracy, ratingTrend, boardOf, howLabel,
  colourOf, outcomeFor, ratingOf, accuracyOf, CLASS_LABEL, CLASS_ICON,
} from './chess.js';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const PAGE = 20;                 // games listed before "show more"
const MAX_CATCH_UP_CALLS = 80;   // each call reads up to 3 months
const MINUTE_MS = 60000;
const FILES = 'abcdefgh';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  me: null, partner: null, members: [], roomId: null,
  names: [], games: [], sync: null,
  filter: 'all', shown: PAGE, syncing: false, catchUp: null, live: null,
};

const memberOf = (id) => ui.members.find((m) => m.user_id === id);
const nameOf = (id) => (id === ui.me ? 'You' : esc(memberOf(id)?.display_name ?? 'Them'));
const partnerName = () => esc(ui.partner?.display_name ?? 'your person');
const usernameOf = (id) => ui.names.find((n) => n.user_id === id)?.username ?? '';
const visible = () => (ui.filter === 'all' ? ui.games : ui.games.filter((g) => g.time_class === ui.filter));
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

function ago(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / MINUTE_MS);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function toast(text) {
  const el = $('chess-toast');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}

function apply(state) {
  if (!state) return;
  ui.names = state.names;
  ui.games = state.games;
  ui.sync = state.sync;
}

/* ---------- setup ---------- */
function renderSetup(error = '') {
  $('chess-main').hidden = true;
  $('chess-setup').hidden = false;
  $('chess-setup').innerHTML = `
    <div class="setup-card">
      <div class="kings" aria-hidden="true"><span class="k white">♚&#xFE0E;</span><span class="love">♥</span><span class="k black">♚&#xFE0E;</span></div>
      <h2>Link your chess.com accounts</h2>
      <p class="muted">Your games against each other show up here by themselves, a few minutes after you finish. Only public game data is read.</p>
      <form id="names-form" class="names-form" autocomplete="off">
        <label><span>${esc(emojiOf(memberOf(ui.me)))} Your chess.com username</span>
          <input class="field-input" name="mine" placeholder="your username" required minlength="3" maxlength="25" pattern="[A-Za-z0-9_\\-]{3,25}" value="${esc(usernameOf(ui.me))}" autocapitalize="none" spellcheck="false" /></label>
        <label><span>${esc(emojiOf(ui.partner))} ${partnerName()}'s chess.com username</span>
          <input class="field-input" name="partner" placeholder="their username" required minlength="3" maxlength="25" pattern="[A-Za-z0-9_\\-]{3,25}" value="${esc(usernameOf(ui.partner?.user_id))}" autocapitalize="none" spellcheck="false" /></label>
        <p class="form-error" role="alert">${esc(error)}</p>
        <div class="setup-actions">
          <button class="btn" type="submit" style="--pc:var(--lilac)">Find our games ♟</button>
          ${ui.names.length ? '<button class="btn ghost" type="button" data-action="cancel-setup">Cancel</button>' : ''}
        </div>
      </form>
      ${ui.names.length ? '<p class="muted small">Changing a username starts the history over from chess.com.</p>' : ''}
    </div>`;
}

async function saveNames(form) {
  const f = new FormData(form);
  const mine = String(f.get('mine')).trim();
  const theirs = String(f.get('partner')).trim();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Checking…';
  try {
    const [a, b] = await Promise.all([api.playerExists(mine), api.playerExists(theirs)]).catch(() => [true, true]);
    if (!a || !b) { renderSetup(`chess.com has no player called “${!a ? mine : theirs}”.`); return; }
    apply(await api.setNames(mine, theirs));
    track('chess_names_set');
    showMain();
    await syncNow(false);
  } catch (e) {
    reportError(e, 'chess-names');
    renderSetup(e.message || 'Couldn’t save that. Try again?');
  }
}

/* ---------- sync ---------- */
async function syncNow(manual) {
  if (ui.syncing) return;
  ui.syncing = true;
  const before = new Set(ui.games.map((g) => g.id));
  const triedBefore = ui.sync?.tried_at;
  renderSync();
  try {
    let state = await api.sync();
    let calls = 0;
    // First link-up: older months are read a few per call, one call at a time.
    while (state?.sync?.backlog > 0 && !state.sync.error && calls++ < MAX_CATCH_UP_CALLS) {
      ui.catchUp = { left: state.sync.backlog, total: Math.max(ui.catchUp?.total ?? 0, state.sync.backlog) };
      apply(state);
      render();
      state = await api.sync();
    }
    ui.catchUp = null;
    apply(state);
    const added = ui.games.filter((g) => !before.has(g.id)).length;
    if (added) {
      ui.live?.ping();
      if (before.size) toast(`${added} new game${added === 1 ? '' : 's'} ♟`);
    } else if (manual && !ui.sync?.error) {
      toast(ui.sync?.tried_at === triedBefore ? 'Just checked. chess.com updates about once a minute.' : 'No new games yet');
    }
    track('chess_synced', { manual, added, error: Boolean(ui.sync?.error) });
  } catch (e) {
    reportError(e, 'chess-sync');
    toast('Couldn’t reach the server. Try again?');
  } finally {
    ui.syncing = false;
    render();
  }
}

function renderSync() {
  const s = ui.sync;
  const status = ui.syncing ? (ui.catchUp ? `Catching up: ${ui.catchUp.left} month${ui.catchUp.left === 1 ? '' : 's'} left…` : 'Checking chess.com…')
    : s?.error ? `⚠️ ${esc(s.error)}` : `Last checked ${ago(s?.synced_at)}`;
  $('sync-bar').innerHTML = `
    <span class="sync-status ${s?.error && !ui.syncing ? 'bad' : ''}">${ui.syncing ? '<span class="spinner" aria-hidden="true"></span>' : ''}${status}</span>
    <span class="sync-actions">
      <button class="btn small" data-action="sync" ${ui.syncing ? 'disabled' : ''} style="--pc:var(--lilac)">Fetch new games</button>
      <button class="link-btn" data-action="setup">${esc(usernameOf(ui.me))} vs ${esc(usernameOf(ui.partner?.user_id))} ✎</button>
    </span>`;
}

/* ---------- rivalry ---------- */
function renderRivalry(games) {
  const t = headToHead(games, ui.me, ui.partner.user_id);
  const s = streak(games);
  const side = (id, wins, lead) => `
    <div class="side ${lead ? 'lead' : ''}">
      <span class="face">${esc(emojiOf(memberOf(id)))}</span>
      <span class="who">${id === ui.me ? 'You' : partnerName()}</span>
      <span class="wins" data-count="${wins}">${wins}</span>
      ${lead ? '<span class="crown" aria-label="leading">👑</span>' : ''}
    </div>`;
  const line = !games.length ? `No games between you yet${ui.filter === 'all' ? '' : ` in ${CLASS_LABEL[ui.filter].toLowerCase()}`}. Challenge ${partnerName()} on chess.com!`
    : s && s.n >= 2 ? `🔥 ${s.who === ui.me ? 'You have' : `${partnerName()} has`} won ${s.n} in a row`
    : games[0].winner == null ? '🤝 The last one was a draw' : `${games[0].winner === ui.me ? 'You' : partnerName()} won the last one`;
  // Rope: the knot slides toward whoever's ahead (draws count half).
  const x = 20 + t.share * 260;
  $('rivalry').innerHTML = `
    <div class="score">
      ${side(ui.me, t.me, t.me > t.partner)}
      <div class="mid"><span class="vs">vs</span><span class="draws">${t.draws} draw${t.draws === 1 ? '' : 's'}</span><span class="total">${t.total} game${t.total === 1 ? '' : 's'}</span></div>
      ${side(ui.partner.user_id, t.partner, t.partner > t.me)}
    </div>
    <svg class="rope" viewBox="0 0 300 40" aria-hidden="true">
      <line class="mark" x1="150" y1="6" x2="150" y2="34" />
      <path class="rope-line" d="M10 20 Q 80 26 150 20 T 290 20" />
      <g class="knot" style="--x: ${x - 150}px"><circle cx="150" cy="20" r="9" /><path d="M150 26 l-6 10 M150 26 l6 10" /></g>
    </svg>
    <p class="streak">${line}</p>`;
  if (!reduce) {
    for (const el of $('rivalry').querySelectorAll('[data-count]')) countUp(el, Number(el.dataset.count));
  }
}

function countUp(el, to) {
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / 700);
    el.textContent = String(Math.round(to * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- boards ---------- */
// Drawn from your side: if you had black, black is at the bottom.
function boardHTML(fen, flip, cls = '') {
  const rows = boardOf(fen);
  if (!rows) return '';
  const order = flip ? [...rows].reverse().map((r) => [...r].reverse()) : rows;
  const cells = order.flatMap((row, r) => row.map((sq, c) => {
    const dark = (r + c) % 2 === 1;
    const piece = sq ? `<span class="pc ${sq.white ? 'w' : 'b'}" style="--i:${r * 8 + c}">${sq.piece}</span>` : '';
    return `<span class="sq ${dark ? 'd' : 'l'}">${piece}</span>`;
  })).join('');
  const files = (flip ? [...FILES].reverse() : [...FILES]).map((f) => `<i>${f}</i>`).join('');
  return `<div class="board ${cls}">${cells}</div><div class="files">${files}</div>`;
}

function playerRow(g, id) {
  const acc = accuracyOf(g, id);
  const out = outcomeFor(g, id);
  return `<div class="player ${out}">
    <span class="dot ${colourOf(g, id)}" title="${colourOf(g, id)}"></span>
    <span class="pname">${esc(emojiOf(memberOf(id)))} ${nameOf(id)}</span>
    <span class="prating">${ratingOf(g, id) ?? ''}</span>
    ${acc != null ? `<span class="acc"><span class="acc-bar"><span style="width:${acc}%"></span></span>${acc.toFixed(1)}%</span>` : '<span class="acc muted">no review</span>'}
  </div>`;
}

function renderLast(games) {
  const g = games[0];
  if (!g) { $('last-game').hidden = true; return; }
  $('last-game').hidden = false;
  const out = outcomeFor(g, ui.me);
  const headline = g.winner == null ? `Draw ${howLabel(g)}` : `${g.winner === ui.me ? 'You' : partnerName()} won ${howLabel(g)}`;
  $('last-game').innerHTML = `
    <div class="last-board">${boardHTML(g.fen, colourOf(g, ui.me) === 'black', 'big')}</div>
    <div class="last-info">
      <span class="eyebrow">Last game · ${fmtDate(g.ended_at)}</span>
      <h2 class="headline ${out}">${headline}</h2>
      <p class="meta">${CLASS_ICON[g.time_class] ?? ''} ${CLASS_LABEL[g.time_class] ?? esc(g.time_class)}${g.rated ? '' : ' · unrated'}${g.moves ? ` · ${g.moves} moves` : ''}</p>
      ${g.opening ? `<p class="opening">📖 ${esc(g.opening)}</p>` : ''}
      <div class="players">${playerRow(g, g.white)}${playerRow(g, g.black)}</div>
      <a class="game-link" href="${esc(g.url)}" target="_blank" rel="noopener">Open on chess.com ↗</a>
    </div>`;
}

/* ---------- stats ---------- */
function bar(me, them, draws = 0) {
  return `<span class="split">
    <span class="me" style="flex:${me}"></span><span class="dr" style="flex:${draws}"></span><span class="them" style="flex:${them}"></span>
  </span><span class="split-nums"><b>${me}</b>${draws ? `<i>${draws}</i>` : ''}<b>${them}</b></span>`;
}

function pct(r) {
  return r.n ? Math.round(((r.win + r.draw / 2) / r.n) * 100) : null;
}

function sparkline(trend) {
  const all = [...trend.me, ...trend.partner];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(hi - lo, 20);
  const path = (pts) => pts.map((v, i) => `${i ? 'L' : 'M'}${(i / Math.max(pts.length - 1, 1)) * 280 + 10} ${70 - ((v - lo) / span) * 60}`).join(' ');
  const last = (pts) => pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 300 80" aria-hidden="true">
      <path class="line me" d="${path(trend.me)}" /><path class="line them" d="${path(trend.partner)}" />
    </svg>
    <p class="legend"><span class="me">You ${last(trend.me) ?? ''}</span><span class="them">${partnerName()} ${last(trend.partner) ?? ''}</span></p>`;
}

function renderStats(games) {
  if (!games.length) { $('stats').innerHTML = ''; return; }
  const me = ui.me;
  const them = ui.partner.user_id;
  const classes = byClass(ui.games, me, them);
  const cMe = byColour(games, me);
  const cThem = byColour(games, them);
  const oMe = favouriteOpening(games, me);
  const oThem = favouriteOpening(games, them);
  const fMe = fastestWin(games, me);
  const fThem = fastestWin(games, them);
  const aMe = bestAccuracy(games, me);
  const aThem = bestAccuracy(games, them);
  const trend = ratingTrend(games, me, them);
  const colourRow = (label, a, b) => `<div class="crow"><span class="clabel">${label}</span>
    <span class="cval me">${pct(a) == null ? '–' : `${pct(a)}%`}</span><span class="cval them">${pct(b) == null ? '–' : `${pct(b)}%`}</span></div>`;
  const pair = (a, b, fmt) => `<div class="pair"><div class="me"><small>You</small>${a ? fmt(a) : '<span class="muted">–</span>'}</div>
    <div class="them"><small>${partnerName()}</small>${b ? fmt(b) : '<span class="muted">–</span>'}</div></div>`;
  $('stats').innerHTML = `
    ${classes.length > 1 ? `<section class="stat wide"><h3>By time control</h3>${classes.map((r) => `
      <div class="class-row"><span class="cl">${CLASS_ICON[r.c]} ${CLASS_LABEL[r.c]}</span>${bar(r.me, r.partner, r.draws)}</div>`).join('')}</section>` : ''}
    <section class="stat"><h3>White vs black</h3><p class="muted small">Score with each colour (draws count half)</p>
      <div class="crow head"><span></span><span class="cval me">You</span><span class="cval them">${partnerName()}</span></div>
      ${colourRow('♔&#xFE0E; White', cMe.white, cThem.white)}${colourRow('♚&#xFE0E; Black', cMe.black, cThem.black)}</section>
    <section class="stat"><h3>Signature openings</h3><p class="muted small">Most played with white</p>
      ${pair(oMe, oThem, (o) => `<b>${esc(o.name)}</b><span class="muted small">${o.n} game${o.n === 1 ? '' : 's'} · ${o.win} won</span>`)}</section>
    <section class="stat"><h3>Fastest win</h3>
      ${pair(fMe, fThem, (g) => `<b>${g.moves} moves</b><a class="muted small" href="${esc(g.url)}" target="_blank" rel="noopener">${howLabel(g)} · ${fmtDate(g.ended_at)} ↗</a>`)}</section>
    <section class="stat"><h3>Sharpest game</h3><p class="muted small">Best accuracy, from chess.com's review</p>
      ${pair(aMe, aThem, (a) => `<b>${a.a.toFixed(1)}%</b><a class="muted small" href="${esc(a.g.url)}" target="_blank" rel="noopener">${fmtDate(a.g.ended_at)} ↗</a>`)}</section>
    ${trend ? `<section class="stat trend"><h3>Ratings · ${CLASS_LABEL[trend.c]}</h3>${sparkline(trend)}</section>` : ''}`;
}

/* ---------- history ---------- */
function renderHistory(games) {
  if (!games.length) { $('history').innerHTML = ''; return; }
  let month = '';
  const rows = games.slice(0, ui.shown).map((g) => {
    const m = new Date(g.ended_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const head = m !== month ? `<h4 class="month">${m}</h4>` : '';
    month = m;
    const out = outcomeFor(g, ui.me);
    const text = g.winner == null ? `Draw ${howLabel(g)}` : `${g.winner === ui.me ? 'You' : partnerName()} won ${howLabel(g)}`;
    return `${head}<a class="game ${out}" href="${esc(g.url)}" target="_blank" rel="noopener">
      <span class="badge">${out === 'win' ? 'W' : out === 'loss' ? 'L' : '½'}</span>
      <span class="gtext"><b>${text}</b><small>${CLASS_ICON[g.time_class] ?? ''} ${CLASS_LABEL[g.time_class] ?? ''}${g.moves ? ` · ${g.moves} moves` : ''}${g.opening ? ` · ${esc(g.opening)}` : ''}</small></span>
      <span class="gside"><span class="pcol ${colourOf(g, ui.me)}" title="you had ${colourOf(g, ui.me)}"></span>${fmtDate(g.ended_at)}</span>
    </a>`;
  }).join('');
  const more = games.length > ui.shown ? `<button class="btn ghost more" data-action="more">Show ${Math.min(PAGE, games.length - ui.shown)} more</button>` : '';
  $('history').innerHTML = `<h3>Every game</h3><div class="games">${rows}</div>${more}`;
}

function renderFilters() {
  const present = ['bullet', 'blitz', 'rapid', 'daily'].filter((c) => ui.games.some((g) => g.time_class === c));
  if (present.length < 2) { $('filters').innerHTML = ''; ui.filter = 'all'; return; }
  $('filters').innerHTML = ['all', ...present].map((c) => `<button class="chip ${ui.filter === c ? 'on' : ''}" data-filter="${c}">
    ${c === 'all' ? 'All' : `${CLASS_ICON[c]} ${CLASS_LABEL[c]}`}</button>`).join('');
}

function render() {
  if (ui.names.length < 2) { renderSetup(); return; }
  const games = visible();
  renderSync();
  renderFilters();
  renderRivalry(games);
  renderLast(games);
  renderStats(games);
  renderHistory(games);
  $('chess-main').classList.toggle('catching-up', Boolean(ui.catchUp));
}

function showMain() {
  $('chess-setup').hidden = true;
  $('chess-main').hidden = false;
  render();
}

/* ---------- events ---------- */
document.addEventListener('submit', (e) => {
  if (e.target.id === 'names-form') { e.preventDefault(); saveNames(e.target); }
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action], [data-filter]');
  if (!el) return;
  if (el.dataset.filter) { ui.filter = el.dataset.filter; ui.shown = PAGE; render(); return; }
  const action = el.dataset.action;
  if (action === 'sync') syncNow(true);
  if (action === 'setup') renderSetup();
  if (action === 'cancel-setup') showMain();
  if (action === 'more') { ui.shown += PAGE; renderHistory(visible()); }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ui.names.length >= 2) syncNow(false);
});

/* ---------- boot ---------- */
function showGate(html) {
  $('gate').innerHTML = html;
  $('gate').hidden = false;
  $('chess-view').hidden = true;
}

function fail(e, where) {
  reportError(e, `chess-${where}`);
  showGate('<div class="card center narrow"><h2>Something went wrong</h2><p class="muted">Try reloading the page.</p></div>');
}

async function boot() {
  if (!isConfigured) { showGate('<div class="card center">Not configured.</div>'); return; }
  let user;
  try { user = await currentUser(); } catch (e) { reportError(e, 'chess-session'); }
  if (!user) { location.replace(BASE); return; }
  ui.me = user.id;
  let space;
  try { space = await loadSpace(user); } catch (e) { fail(e, 'space'); return; }
  if (!space.couple?.partner) {
    showGate(`<div class="card center narrow"><span class="gate-icon" aria-hidden="true">♞&#xFE0E;</span><h2>Chess Mates is for couples</h2>
      <p class="muted">Pair up with your partner in Wordle first (room settings → “Make us a couple 💞”), then come back.</p>
      <a class="btn" href="${BASE}wordle-duo/">Go to Wordle</a></div>`);
    return;
  }
  ui.members = space.couple.members;
  ui.partner = space.couple.partner;
  ui.roomId = space.couple.room.id;
  // Same colours as the Date Jar: slot 2 is pink, slot 1 is blue.
  const pink = (id) => memberOf(id)?.slot === 2;
  $('chess-view').style.setProperty('--me', pink(ui.me) ? 'var(--pink)' : 'var(--blue)');
  $('chess-view').style.setProperty('--them', pink(ui.partner.user_id) ? 'var(--pink)' : 'var(--blue)');
  try { apply(await api.loadChess()); } catch (e) { fail(e, 'load'); return; }
  $('gate').hidden = true;
  $('chess-view').hidden = false;
  ui.live = api.subscribe(ui.roomId, async () => { if (!ui.syncing) { apply(await api.loadChess()); render(); } });
  if (ui.names.length < 2) { renderSetup(); return; }
  showMain();
  syncNow(false);
}

boot();
