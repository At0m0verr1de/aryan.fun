// Wordle Duo UI: onboarding (create / join a room) and the room view.
import { isConfigured, currentUser, signInWithGoogle, firstName } from '../../shared/supabase.js';
import { loadSpace, forgetSpace, emojiOf, EMOJIS } from '../../shared/space.js';
import { track, reportError } from '../../shared/telemetry.js';
import { GOOGLE } from '../../shared/icons.js';
import { buildTemplates, browserRenderer, REFERENCE_FONTS, readGlyphs, scoreBoard, learnFromGreens } from './ocr.js';
import { decodeBoard, verifyBoard, splitWords, wordFitsRow } from './solve.js';
import * as api from './api.js';
import { parsePixels, parseShareText } from './parse.js';
import {
  SLOTS, localDateStr, addDays, puzzleNo, dateForPuzzle, mondayIndex, toUTC,
  scoreLabel, other, winnerOf, computeStats, weekStandings,
} from './scoring.js';

const MAX_SIDE = 900;
const HISTORY_DAYS = 400;
const HISTORY_PAGE = 21;
const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const CALENDAR_WEEKS = 12;
const LAST_ROOM_KEY = 'wordle-duo:last-room';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s, opts) => new Date(toUTC(s)).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });
const errMsg = (e) => e?.message || 'Something went wrong';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

const ui = {
  me: null,
  myName: '',
  space: null,          // couple, rooms, access and mode (src/shared/space.js)
  room: null,
  members: [],
  results: new Map(),   // puzzle → { [userId]: result } (only rows the no-spoiler rule lets us see)
  submitted: new Map(), // puzzle → Set(userId)
  selected: localDateStr(),
  pending: null,
  celebrate: false,
  live: null,
  historyLimit: HISTORY_PAGE,
  openDays: new Set(), // history rows the player has expanded
};

/* ---------- room data helpers ---------- */
const memberIn = (p) => ui.members.find((m) => m.slot === (p === 'p1' ? 1 : 2));
const mySlot = () => SLOTS.find((p) => memberIn(p)?.user_id === ui.me);
const pname = (p) => esc(memberIn(p)?.display_name ?? 'your person');
const avatarHtml = (m) => (m ? `<span class="avatar emo">${esc(emojiOf(m))}</span>` : '<span class="avatar empty">?</span>');
const isCouple = () => ui.room?.kind === 'couple';
const inCoupleMode = () => ui.space?.mode === 'couple' && isCouple();

// A row of emoji buttons feeding a hidden input, for the create/join forms and settings.
function emojiPicker(name, chosen) {
  return `<div class="emoji-pick" data-emoji-pick>
    <input type="hidden" name="${name}" value="${esc(chosen)}">
    ${EMOJIS.map((e) => `<button type="button" class="${e === chosen ? 'on' : ''}" data-pick="${e}" aria-label="${e}">${e}</button>`).join('')}
  </div>`;
}
const pavatar = (p) => avatarHtml(memberIn(p));
const inviteLink = () => `${location.origin}${location.pathname}?join=${ui.room.invite_code}`;

function dayFor(puzzle) {
  const row = ui.results.get(puzzle) || {};
  const day = {};
  for (const p of SLOTS) {
    const m = memberIn(p);
    if (m && row[m.user_id]) day[p] = row[m.user_id];
  }
  return day;
}
const playedFor = (puzzle, p) => {
  const m = memberIn(p);
  return !!m && !!ui.submitted.get(puzzle)?.has(m.user_id);
};

function apply({ room, members, results, submissions }) {
  ui.room = room;
  ui.members = members;
  ui.results = new Map();
  for (const r of results) {
    const row = ui.results.get(r.puzzle_no) || {};
    row[r.user_id] = r;
    ui.results.set(r.puzzle_no, row);
  }
  ui.submitted = new Map();
  for (const s of submissions) {
    if (!ui.submitted.has(s.puzzle_no)) ui.submitted.set(s.puzzle_no, new Set());
    ui.submitted.get(s.puzzle_no).add(s.user_id);
  }
}

/* ---------- screens ---------- */
function showGate(html) {
  $('gate').innerHTML = html;
  $('gate').hidden = false;
  $('room-view').hidden = true;
}

function showSignIn(authError) {
  showGate(`
    <div class="card center narrow">
      <h2>You've been invited</h2>
      <p class="muted">Sign in with Google to accept. 💌</p>
      ${authError ? `<p class="muted" style="color:var(--danger)">${esc(authError)}</p>` : ''}
      <button class="google-btn" data-action="google">${GOOGLE}Continue with Google</button>
    </div>`);
}

async function showHome() {
  ui.live?.close();
  ui.live = null;
  ui.room = null;
  history.replaceState(null, '', location.pathname);
  let rooms = [];
  try { rooms = await api.listMyRooms(); } catch (e) { fail(e, 'list-rooms'); }
  // Your partner lives in partner mode only; Groups lists everything else.
  rooms = rooms.filter((r) => r.kind !== 'couple');
  const single = !ui.space?.couple;
  const create = ui.space?.access ? `
      <form class="card" data-form="create">
        <h2>Start a room</h2>
        <p class="muted">Make a room, send the invite link to your person, and the daily showdown begins.</p>
        <label>Room name<input class="field-input" name="room" maxlength="40" value="Us" required></label>
        <label>Your name<input class="field-input" name="name" maxlength="24" placeholder="Aryan" value="${esc(ui.myName)}" required></label>
        <label>Your emoji</label>${emojiPicker('emoji', EMOJIS[0])}
        ${single ? '<label class="check"><input type="checkbox" name="couple"> This is for my partner 💞</label>' : ''}
        <button class="btn" style="--pc:var(--pink)">Create room</button>
      </form>` : `
      <div class="card">
        <h2>Invite only, for now</h2>
        <p class="muted">Rooms open with an invite. If someone sent you a code, pop it in here. 💌</p>
      </div>`;
  showGate(`
    <div class="gate-grid">
      ${rooms.length ? `<div class="card span"><h2>Your rooms</h2><div class="room-list">${rooms.map((r) =>
        `<button class="btn ghost" data-action="open-room" data-id="${r.id}">${r.kind === 'couple' ? '💞 ' : ''}${esc(r.name)}</button>`).join('')}</div></div>` : ''}
      ${create}
      <form class="card" data-form="code">
        <h2>Got a code?</h2>
        <p class="muted">If someone sent you a 6-letter code, pop it in.</p>
        <input class="field-input code" name="code" maxlength="6" placeholder="AB12CD" required>
        <button class="btn" style="--pc:var(--blue)">Continue</button>
      </form>
    </div>`);
}

async function showJoin(code) {
  showGate('<div class="card center">Looking up that room…</div>');
  let preview;
  try { preview = await api.previewRoom(code); } catch (e) { fail(e, 'preview-room'); }
  if (!preview) {
    showGate(`<div class="card center"><h2>Hmm, no room with code ${esc(code.toUpperCase())}</h2>
      <button class="btn ghost" data-action="home">Back</button></div>`);
    return;
  }
  if (preview.already_member && await openRoom(preview.room_id)) return;
  if (preview.is_full) {
    showGate(`<div class="card center"><h2>${esc(preview.room_name)} is full</h2>
      <p class="muted">It's a duo — two players max.</p><button class="btn ghost" data-action="home">Start your own</button></div>`);
    return;
  }
  const who = preview.member_names.map(esc).join(' &amp; ');
  const asPartner = preview.room_kind === 'couple';
  showGate(`
    <form class="card center narrow" data-form="join" data-code="${esc(code)}">
      <h2>Join “${esc(preview.room_name)}”</h2>
      ${who ? `<p class="muted">${asPartner ? `${who} wants you as their partner 💞` : `with ${who}`}</p>` : ''}
      <label>Your name<input class="field-input" name="name" maxlength="24" value="${esc(ui.myName)}" required></label>
      <label>Your emoji</label>${emojiPicker('emoji', EMOJIS[1])}
      <button class="btn" style="--pc:var(--pink)">Join</button>
    </form>`);
}

async function openRoom(roomId) {
  showGate('<div class="card center">Opening your room…</div>');
  try {
    const data = await api.loadRoom(roomId, puzzleNo(localDateStr()) - HISTORY_DAYS);
    if (!data.room) { store.del(LAST_ROOM_KEY); return false; }
    apply(data);
  } catch (e) {
    fail(e, 'open-room');
    return false;
  }
  if (roomId !== ui.space?.couple?.room.id) store.set(LAST_ROOM_KEY, roomId);
  history.replaceState(null, '', `${location.pathname}?room=${roomId}`);
  ui.live?.close();
  ui.live = api.subscribe(roomId, () => refresh());
  $('gate').hidden = true;
  $('room-view').hidden = false;
  render();
  return true;
}

// Refetch; celebrate if the selected day's winner just became visible.
async function refresh() {
  if (!ui.room) return false;
  const puzzle = puzzleNo(ui.selected);
  const before = winnerOf(dayFor(puzzle));
  try {
    const data = await api.loadRoom(ui.room.id, puzzleNo(localDateStr()) - HISTORY_DAYS);
    if (!data.room) { toast('You are no longer in that room'); await showHome(); return false; }
    apply(data);
  } catch (e) {
    fail(e, 'refresh');
    return false;
  }
  ui.celebrate = !before && !!winnerOf(dayFor(puzzle));
  const celebrated = ui.celebrate;
  render();
  return celebrated;
}

/* ---------- room rendering ---------- */
function miniGrid(grid, size = '', words = null) {
  return `<div class="grid ${size}">${grid.map((r, i) => `<div class="row">${[...r].map((c, j) =>
    `<span class="t ${c}">${words?.[i] ? esc(words[i][j]) : ''}</span>`).join('')}</div>`).join('')}</div>`;
}

const sourceLabel = (r) => ({ screenshot: '📸 screenshot', text: '📋 share text', manual: '✍️ by hand' }[r.source] || '') + (r.verified ? ' · ✅ checked' : '');

function renderHeader() {
  const between = isCouple() ? '<span class="heart beat">♥</span>' : '<span class="vs-x">vs</span>';
  $('vs').innerHTML = `<span class="a">${pavatar('p1')}${pname('p1')}</span>${between}<span class="b">${pname('p2')}${pavatar('p2')}</span>`;
  $('room-name').textContent = ui.room.name;
}

function renderDay() {
  const t = localDateStr();
  const puzzle = puzzleNo(ui.selected);
  $('dayLabel').textContent = ui.selected === t ? 'Today' : ui.selected === addDays(t, -1) ? 'Yesterday' : fmtDate(ui.selected, { weekday: 'short', month: 'short', day: 'numeric' });
  $('puzzleLabel').textContent = `Wordle #${puzzle.toLocaleString()} · ${fmtDate(ui.selected, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  $('nextBtn').disabled = ui.selected >= t;

  const day = dayFor(puzzle);
  const w = winnerOf(day);
  $('duo').innerHTML = SLOTS.map((p) => playerCard(p, day, w, puzzle)).join('');

  const me = mySlot();
  const them = me && other(me);
  const m = $('matchup');
  if (w) {
    const headline = w === 'tie'
      ? `💞 It's a tie at ${scoreLabel(day.p1)}/6!`
      : `👑 ${pname(w)} wins! ${scoreLabel(day[w])}/6 vs ${scoreLabel(day[other(w)])}/6`;
    const sub = w === 'tie' ? 'Equally brilliant, obviously.' : day[other(w)].solved ? `Better luck tomorrow, ${pname(other(w))} 🌸` : `${pname(other(w))} got stumped. Tomorrow's yours 🌸`;
    m.innerHTML = `<div class="matchup ${ui.celebrate ? 'pop' : ''}" id="matchBox"><div class="headline">${headline}</div><div class="sub">${sub}</div></div>`;
    if (ui.celebrate) burst(w);
  } else if (me && day[me] && memberIn(them) && !playedFor(puzzle, them)) {
    m.innerHTML = `<div class="matchup waiting"><div class="headline">💌 Waiting for ${pname(them)}…</div><div class="sub">Your board and words stay sealed until they play. No spoilers 🤫</div></div>`;
  } else if (me && !day[me] && playedFor(puzzle, them)) {
    m.innerHTML = `<div class="matchup waiting"><div class="headline">👀 ${pname(them)} has played!</div><div class="sub">Add yours to unseal both boards and words.</div></div>`;
  } else {
    m.innerHTML = '';
  }
  ui.celebrate = false;
}

function inviteCard() {
  return `<div class="card player" style="--pc:var(--p2)">
    <div class="phead">${avatarHtml(null)}<span class="pname">Your person</span></div>
    <div class="sealed"><div class="env">💌</div><b>Invite them in</b>
      <small>Send this link. It's a duo, so the room locks once they join.</small>
      <code class="invite">${esc(ui.room.invite_code)}</code>
      <button class="btn" data-action="copy-invite" style="--pc:var(--p2)">Copy invite link</button></div></div>`;
}

function playerCard(p, day, winner, puzzle) {
  const m = memberIn(p);
  if (!m) return inviteCard();
  const isMe = m.user_id === ui.me;
  const r = day[p];
  const crown = winner === p ? '<span class="crown" title="Winner">👑</span>' : winner === 'tie' ? '<span class="crown" title="Tie">💞</span>' : '';
  const you = isMe ? ' <span class="you">you</span>' : '';
  const head = `<div class="phead">${avatarHtml(m)}<span class="pname">${esc(m.display_name)}${you}</span>${crown}</div>`;
  const isPast = ui.selected < localDateStr();
  let body;
  if (r) {
    body = `<div class="result">${r.grid?.length ? miniGrid(r.grid, r.words ? 'lettered' : '', r.words) : ''}
      <div class="score">${scoreLabel(r)}<small>/6</small></div>
      <div class="meta-row"><span>${sourceLabel(r)}</span>${isMe ? '<button class="link-btn" data-action="redo">redo</button>' : ''}</div></div>`;
  } else if (isMe) {
    const pend = ui.pending;
    if (pend?.kind === 'confirm') return `<div class="card player" style="--pc:var(--${p})">${head}${confirmPanel(pend)}</div>`;
    const retry = pend?.otherDay ? ` <button class="link-btn" data-action="use-other-day">Save it for ${esc(fmtDate(pend.otherDay, { month: 'short', day: 'numeric' }))} instead</button>` : '';
    body = `<label class="drop" data-drop>
        <input type="file" accept="image/*" data-file>
        <span class="big">📸</span><span class="t">Add your screenshot</span>
        <span class="s">tap to choose · drag &amp; drop · or paste</span>
      </label>
      ${pend ? `<div class="note ${pend.ok ? 'info' : ''}">${pend.ok && pend.grid?.length ? miniGrid(pend.grid, 'sm') + '<br>' : ''}${esc(pend.note || '')}${pend.ok ? ' Pick your score below to save it.' : ''}${retry}</div>` : ''}
      <div class="alts">
        <div class="quick">or quick pick: ${[1, 2, 3, 4, 5, 6, 'X'].map((g) => `<button class="chip" data-action="manual" data-g="${g}">${g}</button>`).join('')}</div>
        <details><summary>or paste the Wordle share text</summary>
          <textarea data-text placeholder="Wordle 1,936 3/6&#10;&#10;⬛🟨⬛⬛⬛&#10;🟩🟩⬛🟨⬛&#10;🟩🟩🟩🟩🟩"></textarea>
          <button class="btn" data-action="use-text" style="margin-top:8px">Use this</button>
        </details>
      </div>`;
  } else if (playedFor(puzzle, p)) {
    body = `<div class="sealed"><div class="env">💌</div><b>Sealed</b><small>Add yours to unseal it</small></div>`;
  } else {
    body = `<div class="sealed idle"><div class="env">💤</div><b>${isPast ? "Didn't play" : "Hasn't played yet"}</b></div>`;
  }
  return `<div class="card player" style="--pc:var(--${p})">${head}${body}</div>`;
}

// The words read from a screenshot, editable before saving. Every word must fit its row's colours.
function confirmPanel(pend) {
  const rows = pend.rows.map((row, i) => {
    const colours = pend.shot.grid[i];
    const locked = colours === 'GGGGG';
    const alts = !row.confident && !locked && row.alternatives.length
      ? `<div class="alts-row">or ${row.alternatives.map((a) => `<button type="button" class="chip" data-action="pick-alt" data-row="${i}" data-word="${a}">${a}</button>`).join('')}</div>`
      : '';
    return `<div class="crow ${row.confident || locked ? '' : 'check'}" data-crow="${i}">
      <div class="tiles">${[...colours].map((c, j) => `<span class="lt ${c}">${esc(row.word[j] || '')}</span>`).join('')}</div>
      <input class="word-input" data-row="${i}" value="${esc(row.word)}" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false"
        aria-label="Guess ${i + 1}" ${locked ? 'readonly' : ''}>
      ${alts}</div>`;
  }).join('');
  const status = pend.verified ? '✅ Matches this day’s puzzle.' : '⚠️ Couldn’t fully confirm this is this day’s board.';
  return `<div class="confirm">
    <div class="confirm-head"><b>Check your words ✍️</b><small>${status} Fix anything that’s off; each word has to fit its colours.</small></div>
    <div class="crows">${rows}</div>
    <div class="confirm-actions">
      <button class="btn ghost" data-action="confirm-cancel">Cancel</button>
      <button class="btn" data-action="confirm-save" data-confirm-save ${confirmReady(pend) ? '' : 'disabled'}>Save ${scoreLabel(pend.shot)}/6</button>
    </div></div>`;
}

const confirmReady = (pend) => pend.rows.every((r, i) => wordFitsRow(r.word, pend.shot.grid[i], pend.answer));

// Live-update one row while typing, without re-rendering (keeps focus in the input).
function updateConfirmRow(i, word) {
  const pend = ui.pending;
  if (pend?.kind !== 'confirm') return;
  pend.rows[i].word = word;
  const row = document.querySelector(`[data-crow="${i}"]`);
  row.querySelectorAll('.lt').forEach((t, j) => { t.textContent = word[j] || ''; });
  row.classList.toggle('bad', word.length === 5 && !wordFitsRow(word, pend.shot.grid[i], pend.answer));
  document.querySelector('[data-confirm-save]').disabled = !confirmReady(pend);
}

function renderScoreboard() {
  const s = computeStats([...ui.results.keys()].map((n) => [n, dayFor(n)]));
  const total = s.wins.p1 + s.wins.p2 + s.ties || 1;
  const wk = weekStandings(dayFor, localDateStr());
  const weekLine = wk.p1 === wk.p2
    ? `This week it's neck and neck at ${wk.p1}–${wk.p2}. Loser picks dinner 🍜`
    : `This week ${pname(wk.p1 > wk.p2 ? 'p1' : 'p2')} leads ${Math.max(wk.p1, wk.p2)}–${Math.min(wk.p1, wk.p2)}. Loser picks dinner 🍜`;
  $('h2h').innerHTML = `
    <div class="h2h">
      <div class="side"><div class="num" style="color:var(--p1)">${s.wins.p1}</div><div class="lbl">${pname('p1')}</div></div>
      <div class="bar" title="${s.ties} ties">
        <span style="width:${(s.wins.p1 / total) * 100}%;background:var(--p1)"></span>
        <span style="width:${(s.ties / total) * 100}%;background:var(--tie)"></span>
        <span style="width:${(s.wins.p2 / total) * 100}%;background:var(--p2)"></span>
      </div>
      <div class="side"><div class="num" style="color:var(--p2)">${s.wins.p2}</div><div class="lbl">${pname('p2')}</div></div>
    </div>
    <div class="week">${s.ties} tie${s.ties === 1 ? '' : 's'} so far · ${weekLine}</div>`;

  $('stats').innerHTML = SLOTS.filter(memberIn).map((p) => {
    const ps = s.per[p];
    const max = Math.max(1, ...ps.dist);
    const avg = ps.solved ? (ps.total / ps.solved).toFixed(2) : '–';
    const rate = ps.played ? Math.round((ps.solved / ps.played) * 100) + '%' : '–';
    return `<div class="card stat-card" style="--pc:var(--${p})">
      <div class="phead" style="margin-bottom:0">${pavatar(p)}<span class="pname">${pname(p)}</span></div>
      <div class="kpis">
        <div class="kpi"><div class="v">${avg}</div><div class="l">avg</div></div>
        <div class="kpi"><div class="v">${rate}</div><div class="l">solved</div></div>
        <div class="kpi"><div class="v">${ps.streak}${ps.streak >= 3 ? '🔥' : ''}</div><div class="l">streak</div></div>
        <div class="kpi"><div class="v">${ps.best}</div><div class="l">best</div></div>
      </div>
      <div class="dist">${ps.dist.map((n, i) => `<div class="r"><span>${i === 6 ? 'X' : i + 1}</span>
        <span class="fill ${n ? '' : 'zero'}" style="width:${n ? Math.max(8, (n / max) * 100) : 0}%">${n}</span></div>`).join('')}</div>
    </div>`;
  }).join('');
}

function renderCalendar() {
  const t = localDateStr();
  const start = addDays(t, -((CALENDAR_WEEKS - 1) * 7 + mondayIndex(t)));
  const cells = [];
  for (let i = 0; i < CALENDAR_WEEKS * 7; i++) {
    const d = addDays(start, i);
    if (d > t) { cells.push('<span class="c future"></span>'); continue; }
    const n = puzzleNo(d);
    const w = winnerOf(dayFor(n));
    const anyone = SLOTS.some((p) => playedFor(n, p));
    const cls = w ? (w === 'tie' ? 'tie' : w) : anyone ? 'half' : '';
    const label = w ? (w === 'tie' ? 'tie' : `${memberIn(w).display_name} won`) : anyone ? 'only one of you played' : 'no games';
    cells.push(`<button class="c ${cls} ${d === ui.selected ? 'sel' : ''}" data-action="goto" data-d="${d}" title="${esc(fmtDate(d, { month: 'short', day: 'numeric' }))} · ${esc(label)}"></button>`);
  }
  $('cal').innerHTML = cells.join('');
  $('legend').innerHTML =
    `<span><i style="background:var(--p1)"></i>${pname('p1')} won</span><span><i style="background:var(--p2)"></i>${pname('p2')} won</span>
     <span><i style="background:linear-gradient(135deg,var(--p1) 50%,var(--p2) 50%)"></i>tie</span><span><i style="border:2px solid var(--faint)"></i>one of you played</span>`;
}

// The day's answer, if any visible board reveals it (so nothing the no-spoiler rule hides).
function answerFor(n) {
  for (const r of Object.values(ui.results.get(n) || {})) {
    if (r.answer) return r.answer;
    if (r.solved && r.words?.length) return r.words[r.words.length - 1];
  }
  return null;
}

function renderHistory() {
  const all = [...new Set([...ui.results.keys(), ...ui.submitted.keys()])].sort((a, b) => b - a);
  if (!all.length) {
    $('hist').innerHTML = `<div class="card" style="text-align:center;color:var(--muted)">No games yet. Today's the day 🌱</div>`;
    return;
  }
  const shown = all.slice(0, ui.historyLimit);
  const weeks = [];
  for (const n of shown) {
    const d = dateForPuzzle(n);
    const start = addDays(d, -mondayIndex(d));
    if (weeks[weeks.length - 1]?.start !== start) weeks.push({ start, days: [] });
    weeks[weeks.length - 1].days.push(n);
  }
  const more = all.length > shown.length ? '<button class="btn ghost more" data-action="more-history">Show older games</button>' : '';
  $('hist').innerHTML = weeks.map(historyWeek).join('') + more;
}

function historyWeek({ start, days }) {
  const tally = { p1: 0, p2: 0, tie: 0 };
  for (const n of days) {
    const w = winnerOf(dayFor(n));
    if (w) tally[w]++;
  }
  const today = localDateStr();
  const label = start === addDays(today, -mondayIndex(today)) ? 'This week' : `Week of ${esc(fmtDate(start, { month: 'short', day: 'numeric' }))}`;
  const lead = tally.p1 === tally.p2
    ? (tally.p1 ? `all square at ${tally.p1}–${tally.p2}` : '')
    : `👑 ${pname(tally.p1 > tally.p2 ? 'p1' : 'p2')} ${Math.max(tally.p1, tally.p2)}–${Math.min(tally.p1, tally.p2)}`;
  const ties = tally.tie ? ` · ${tally.tie} tie${tally.tie === 1 ? '' : 's'}` : '';
  return `<div class="hweek">
    <div class="hweek-head"><span>${label}</span><span class="tally">${lead}${ties}</span></div>
    ${days.map(historyDay).join('')}</div>`;
}

function historyDay(n) {
  const d = dateForPuzzle(n);
  const day = dayFor(n);
  const w = winnerOf(day);
  const answer = answerFor(n);
  const score = (p) => {
    const r = day[p];
    if (r) return `<span class="hs ${w === p ? 'win' : ''}">${scoreLabel(r)}</span>`;
    return `<span class="hs none" title="${playedFor(n, p) ? 'sealed' : "didn't play"}">${playedFor(n, p) ? '🔒' : '–'}</span>`;
  };
  const word = answer
    ? `<span class="hword">${[...answer].map((ch) => `<i>${ch}</i>`).join('')}</span>`
    : '<span class="hword hidden" title="Revealed once you both play"><i></i><i></i><i></i><i></i><i></i></span>';
  const badge = w === 'tie' ? '💞' : w ? '👑' : '';
  return `<details class="hday ${w ? `won-${w}` : ''}" data-n="${n}" ${ui.openDays.has(n) ? 'open' : ''}>
    <summary>
      <span class="hdate"><b>${esc(fmtDate(d, { weekday: 'short' }))}</b> ${esc(fmtDate(d, { month: 'short', day: 'numeric' }))}<small>#${n.toLocaleString()}</small></span>
      ${word}
      <span class="hplayers"><span class="hp" style="--pc:var(--p1)">${pavatar('p1')}${score('p1')}</span><span class="hp" style="--pc:var(--p2)">${score('p2')}${pavatar('p2')}</span></span>
      <span class="hbadge">${badge}</span>
    </summary>
    <div class="hdetail">
      ${SLOTS.filter(memberIn).map((p) => historySide(p, day, n, w)).join('')}
      <button class="link-btn hopen" data-action="goto" data-d="${d}">Open this day →</button>
    </div>
  </details>`;
}

function historySide(p, day, n, w) {
  const r = day[p];
  const body = r
    ? `${r.grid?.length ? miniGrid(r.grid, r.words ? 'md lettered' : 'md', r.words) : ''}
       <div class="hmeta">${scoreLabel(r)}/6${w === p ? ' 👑' : ''} · ${sourceLabel(r)}</div>`
    : `<div class="hmeta">${playedFor(n, p) ? '🔒 sealed until you play' : "💤 didn't play"}</div>`;
  return `<div class="hside" style="--pc:var(--${p})"><div class="hname">${pavatar(p)}${pname(p)}</div>${body}</div>`;
}

function render() {
  renderHeader();
  renderDay();
  renderScoreboard();
  renderCalendar();
  renderHistory();
}

/* ---------- effects ---------- */
// Show the error to the player and log it.
function fail(e, where) {
  reportError(e, `wordle:${where}`);
  toast(errMsg(e));
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

function burst(w) {
  const box = $('matchBox');
  const icons = w === 'tie' ? ['💞', '💖', '✨'] : ['💖', '✨', '🌸', '🏆'];
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('span');
    s.className = 'burst';
    s.textContent = icons[i % icons.length];
    s.style.left = `${5 + Math.random() * 90}%`;
    s.style.animationDelay = `${Math.random() * 0.4}s`;
    box.appendChild(s);
    setTimeout(() => s.remove(), 2200);
  }
}

/* ---------- saving ---------- */
async function saveMine(puzzle, result) {
  try {
    await api.submitResult(ui.room.id, ui.me, puzzle, result);
  } catch (e) {
    if (e?.code === '23505') toast('Already saved for that day. Hit redo first.');
    else fail(e, 'save-result');
    return;
  }
  track('wordle_result_saved', {
    source: result.source, solved: result.solved, guesses: result.guesses ?? null, has_grid: Boolean(result.grid?.length),
    has_words: Boolean(result.words), verified: Boolean(result.verified), edited: result.edited ?? null,
    days_back: puzzleNo(localDateStr()) - puzzle,
  });
  ui.pending = null;
  ui.selected = dateForPuzzle(puzzle);
  ui.live?.ping();
  const celebrated = await refresh();
  if (!celebrated) toast(`Saved your ${scoreLabel(result)}/6 ✨`);
}

async function readScreenshot(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode'));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return { ...parsePixels(data, w, h), pixels: { data, width: w } };
  } catch {
    return { ok: false, note: "Couldn't open that image. If it's HEIC, try a PNG/JPG screenshot." };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Lazy pieces for reading words: the answer (via our worker), the word list, and reference letters.
const answers = new Map();
function fetchAnswer(date) {
  if (!answers.has(date)) {
    const pending = fetch(`${BASE}api/wordle/${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.solution ?? null)
      .catch(() => null)
      .then((solution) => { if (!solution) answers.delete(date); return solution; });
    answers.set(date, pending);
  }
  return answers.get(date);
}
let wordList = null;
const loadWords = () => (wordList ??= import('./words.js').then((m) => splitWords(m.WORDS)));
let templates = null;
const referenceLetters = () => (templates ??= buildTemplates(browserRenderer(), REFERENCE_FONTS));

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/') || !ui.room) return;
  toast('Reading the board… 🔍');
  const shot = await readScreenshot(file);
  if (!shot.ok || shot.confidence !== 'high') {
    // Parser misses are the main thing to improve, so log why (never the image).
    track('wordle_screenshot_unreadable', {
      ok: shot.ok, confidence: shot.confidence ?? null, note: shot.note ?? null, type: file.type, kb: Math.round(file.size / 1024),
    });
    const { pixels, ...rest } = shot; // don't keep the image around
    ui.pending = rest;
    renderDay();
    return;
  }
  const date = ui.selected;
  const puzzle = puzzleNo(date);
  const [answer, words] = await Promise.all([fetchAnswer(date), loadWords().catch(() => null)]);
  if (!answer || !words) {
    track('wordle_answer_unavailable', { date, has_words: Boolean(words) });
    toast("Couldn't look up this day's answer, so only the colours are saved");
    await saveMine(puzzle, shot);
    return;
  }

  const glyphs = readGlyphs(shot.pixels.data, shot.pixels.width, shot.boxes);
  const reference = referenceLetters();
  let scores = scoreBoard(glyphs, reference);
  const check = verifyBoard(shot.grid, scores, answer);
  if (check.verdict === 'mismatch') {
    // Most often it's yesterday's board uploaded after midnight; offer to file it there.
    const yesterday = addDays(date, -1);
    const prev = await fetchAnswer(yesterday);
    const me = mySlot();
    const fitsYesterday = Boolean(prev) && verifyBoard(shot.grid, scores, prev).verdict === 'match' && !(me && dayFor(puzzleNo(yesterday))[me]);
    track('wordle_screenshot_rejected', { ratio: check.ratio, evidence: check.evidence, fits_yesterday: fitsYesterday });
    ui.pending = {
      ok: false,
      note: fitsYesterday
        ? `That's the board for ${fmtDate(yesterday, { weekday: 'long' })}, not this day 🤔`
        : `That doesn't look like Wordle #${puzzle.toLocaleString()}. Upload the screenshot for this day 🤔`,
      otherDay: fitsYesterday ? yesterday : null,
      file: fitsYesterday ? file : null,
    };
    renderDay();
    return;
  }
  if (check.verdict === 'match') scores = scoreBoard(glyphs, learnFromGreens(reference, glyphs, shot.grid, answer));
  const rows = decodeBoard(shot.grid, scores, answer, words);
  track('wordle_words_read', {
    rows: rows.length, confident: rows.filter((r) => r.confident).length, unlisted: rows.filter((r) => !r.listed).length,
    verdict: check.verdict, ratio: check.ratio,
  });
  const { grid, guesses, solved, source } = shot;
  ui.pending = {
    kind: 'confirm', puzzle, answer, verified: check.verdict === 'match',
    shot: { grid, guesses, solved, source },
    rows: rows.map((r) => ({ ...r, read: r.word })),
  };
  renderDay();
}

async function saveConfirmed() {
  const pend = ui.pending;
  if (pend?.kind !== 'confirm' || !confirmReady(pend)) return;
  const words = pend.rows.map((r) => r.word);
  const edited = pend.rows.filter((r) => r.word !== r.read).length;
  await saveMine(pend.puzzle, { ...pend.shot, words, answer: pend.answer, verified: pend.verified, edited });
}

async function handleShareText() {
  const parsed = parseShareText(document.querySelector('textarea[data-text]')?.value || '');
  if (!parsed) { toast("That doesn't look like Wordle share text 🤔"); return; }
  if (parsed.puzzle > puzzleNo(localDateStr()) + 1) { toast('That puzzle is from the future?! 🔮'); return; }
  await saveMine(parsed.puzzle, parsed);
}

async function handleManual(g) {
  const solved = g !== 'X';
  const grid = ui.pending?.ok ? ui.pending.grid : [];
  await saveMine(puzzleNo(ui.selected), { guesses: solved ? Number(g) : null, solved, grid, source: 'manual' });
}

/* ---------- settings ---------- */
function openSettings() {
  const me = ui.members.find((m) => m.user_id === ui.me);
  $('set-name').value = me?.display_name ?? '';
  $('set-emoji').innerHTML = emojiPicker('emoji', emojiOf(me));
  $('set-room').value = ui.room.name;
  $('set-room').disabled = ui.room.created_by !== ui.me;
  $('set-invite').textContent = inviteLink();
  $('set-couple').hidden = !isCouple();
  $('set-since').value = ui.room.since ?? '';
  // Turning a duo into your couple room: only when it's just the two of you and you're both single.
  $('make-couple').hidden = isCouple() || Boolean(ui.space?.couple) || ui.room.max_members !== 2;
  for (const id of ['switch-room-btn', 'leave-room-btn']) $(id).hidden = inCoupleMode();
  $('settings').showModal();
}

async function saveSettings() {
  const me = ui.members.find((m) => m.user_id === ui.me);
  const name = $('set-name').value.trim();
  const emoji = $('settings').querySelector('input[name="emoji"]').value;
  const roomName = $('set-room').value.trim();
  const since = $('set-since').value || null;
  try {
    const patch = {};
    if (me && name && name !== me.display_name) patch.display_name = name;
    if (me && emoji && emoji !== me.emoji) patch.emoji = emoji;
    if (Object.keys(patch).length) await api.updateMe(ui.room.id, ui.me, patch);
    if (ui.room.created_by === ui.me && roomName && roomName !== ui.room.name) await api.renameRoom(ui.room.id, roomName);
    if (isCouple() && since !== (ui.room.since ?? null)) await api.setCouple(ui.room.id, true, since);
    forgetSpace();
  } catch (e) {
    fail(e, 'save-settings');
    return;
  }
  $('settings').close();
  ui.live?.ping();
  await refresh();
  toast('Saved ✨');
}

function exportData() {
  const data = {
    room: ui.room.name,
    exported_at: new Date().toISOString(),
    members: ui.members.map((m) => ({ slot: m.slot, name: m.display_name })),
    results: [...ui.results.entries()].flatMap(([n, row]) => Object.values(row).map((r) => ({
      puzzle: n, date: dateForPuzzle(n), player: ui.members.find((m) => m.user_id === r.user_id)?.display_name,
      solved: r.solved, guesses: r.guesses, grid: r.grid, words: r.words ?? undefined, answer: r.answer ?? undefined,
    }))),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `wordle-duo-${localDateStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyInvite() {
  const link = inviteLink();
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Wordle Duo', text: `Join my Wordle Duo room "${ui.room.name}" 💌`, url: link });
      track('wordle_invite_shared', { method: 'share' });
      return;
    } catch { /* fall back to copy */ }
  }
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied 💌');
    track('wordle_invite_shared', { method: 'copy' });
  } catch {
    prompt('Copy this link:', link);
  }
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const box = pick.closest('[data-emoji-pick]');
    box.querySelector('input').value = pick.dataset.pick;
    box.querySelectorAll('[data-pick]').forEach((b) => b.classList.toggle('on', b === pick));
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, g, d, id } = el.dataset;
  switch (action) {
    case 'prev': ui.selected = addDays(ui.selected, -1); ui.pending = null; render(); break;
    case 'next': if (ui.selected < localDateStr()) { ui.selected = addDays(ui.selected, 1); ui.pending = null; render(); } break;
    case 'goto': ui.selected = d; ui.pending = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'redo':
      try { await api.deleteResult(ui.room.id, ui.me, puzzleNo(ui.selected)); } catch (err) { fail(err, 'redo'); break; }
      ui.live?.ping();
      await refresh();
      break;
    case 'manual': await handleManual(g); break;
    case 'confirm-save':
      el.disabled = true;
      await saveConfirmed();
      if (ui.pending?.kind === 'confirm') renderDay(); // save failed; re-enable
      break;
    case 'confirm-cancel': ui.pending = null; renderDay(); break;
    case 'pick-alt': {
      const input = document.querySelector(`.word-input[data-row="${el.dataset.row}"]`);
      input.value = el.dataset.word;
      updateConfirmRow(Number(el.dataset.row), el.dataset.word);
      break;
    }
    case 'use-other-day': {
      const { otherDay, file } = ui.pending || {};
      if (!otherDay || !file) break;
      ui.selected = otherDay;
      ui.pending = null;
      render();
      await handleFile(file);
      break;
    }
    case 'more-history': ui.historyLimit += HISTORY_PAGE; renderHistory(); break;
    case 'use-text': await handleShareText(); break;
    case 'open-room': await openRoom(id); break;
    case 'home': await showHome(); break;
    case 'copy-invite': await copyInvite(); break;
    case 'settings': openSettings(); break;
    case 'close-settings': $('settings').close(); break;
    case 'save-settings': await saveSettings(); break;
    case 'export': exportData(); break;
    case 'make-couple':
      if (!confirm(`Make “${ui.room.name}” your couple room? 💞 It becomes your home screen together.`)) break;
      try { await api.setCouple(ui.room.id, true, null); } catch (err) { fail(err, 'make-couple'); break; }
      track('couple_set', { since: false });
      forgetSpace();
      ui.space = await loadSpace({ id: ui.me });
      $('settings').close();
      ui.live?.ping();
      await refresh();
      toast('You two are official 💞');
      break;
    case 'switch-room': $('settings').close(); store.del(LAST_ROOM_KEY); await showHome(); break;
    case 'google':
      el.disabled = true;
      try { await signInWithGoogle(); } catch (err) { fail(err, 'signin'); el.disabled = false; }
      break;
    case 'leave-room':
      if (!confirm(`Leave “${ui.room.name}”? Your results in this room are deleted.`)) break;
      try { await api.leaveRoom(ui.room.id, ui.me); } catch (err) { fail(err, 'leave-room'); break; }
      track('wordle_room_left');
      ui.live?.ping();
      $('settings').close();
      store.del(LAST_ROOM_KEY);
      await showHome();
      break;
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const f = new FormData(form);
  const button = form.querySelector('button:not([type=button])');
  button.disabled = true;
  try {
    if (form.dataset.form === 'create') {
      const kind = f.get('couple') ? 'couple' : 'duo';
      const room = await api.createRoom(f.get('room').trim(), f.get('name').trim(), f.get('emoji'), kind);
      track('wordle_room_created', { kind });
      forgetSpace();
      ui.space = await loadSpace({ id: ui.me });
      await openRoom(room.id);
    } else if (form.dataset.form === 'code') {
      history.replaceState(null, '', `${location.pathname}?join=${encodeURIComponent(f.get('code').trim())}`);
      await showJoin(f.get('code').trim());
    } else if (form.dataset.form === 'join') {
      const roomId = await api.joinRoom(form.dataset.code, f.get('name').trim(), f.get('emoji'));
      track('wordle_room_joined');
      forgetSpace();
      ui.space = await loadSpace({ id: ui.me });
      if (await openRoom(roomId)) ui.live?.ping();
    }
  } catch (err) {
    fail(err, `form-${form.dataset.form}`);
  } finally {
    button.disabled = false;
  }
});

document.addEventListener('input', (e) => {
  if (!e.target.matches('.word-input')) return;
  const clean = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  if (clean !== e.target.value) e.target.value = clean;
  updateConfirmRow(Number(e.target.dataset.row), clean);
});
// <details> toggle doesn't bubble; listen in the capture phase to remember expanded history rows.
document.addEventListener('toggle', (e) => {
  if (!e.target.matches?.('.hday')) return;
  const n = Number(e.target.dataset.n);
  if (e.target.open) ui.openDays.add(n);
  else ui.openDays.delete(n);
}, true);

document.addEventListener('change', (e) => {
  if (e.target.matches('input[data-file]')) handleFile(e.target.files[0]);
});
document.addEventListener('dragover', (e) => {
  const zone = e.target.closest('[data-drop]');
  if (!zone) return;
  e.preventDefault();
  zone.classList.add('over');
});
document.addEventListener('dragleave', (e) => e.target.closest?.('[data-drop]')?.classList.remove('over'));
document.addEventListener('drop', (e) => {
  const zone = e.target.closest('[data-drop]');
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove('over');
  handleFile(e.dataTransfer.files[0]);
});
document.addEventListener('paste', (e) => {
  if (!ui.room || e.target.matches('textarea, input')) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  const me = mySlot();
  if (me && dayFor(puzzleNo(ui.selected))[me]) { toast('Your board is already in for this day'); return; }
  handleFile(item.getAsFile());
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ui.room) refresh();
});

/* ---------- boot ---------- */
async function boot() {
  if (!isConfigured) {
    showGate(`<div class="card center"><h2>Almost there</h2><p class="muted">Add <code>PUBLIC_SUPABASE_URL</code> and <code>PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env</code>, then restart.</p></div>`);
    return;
  }
  showGate('<div class="card center">Waking up…</div>');
  const authError = new URLSearchParams(location.search).get('error_description');
  let user;
  try {
    user = await currentUser();
  } catch (e) {
    reportError(e, 'boot-session');
    showGate(`<div class="card center"><h2>Couldn't sign you in</h2><p class="muted">${esc(errMsg(e))}</p></div>`);
    return;
  }
  const params = new URLSearchParams(location.search);
  if (!user) {
    // Invite links sign in here; everyone else goes through the door on the home page.
    if (params.get('join')) showSignIn(authError);
    else location.replace(BASE);
    return;
  }
  ui.me = user.id;
  ui.myName = firstName(user);
  try {
    ui.space = await loadSpace(user);
  } catch (e) {
    fail(e, 'load-space');
  }
  if (params.get('join')) { await showJoin(params.get('join')); return; }
  // Partner mode: Wordle simply is your couple room. Groups never opens it.
  const coupleRoom = ui.space?.couple?.room.id ?? null;
  const roomId = ui.space?.mode === 'couple'
    ? coupleRoom
    : [params.get('room'), store.get(LAST_ROOM_KEY)].find((id) => id && id !== coupleRoom);
  if (roomId && await openRoom(roomId)) return;
  await showHome();
}

boot();
