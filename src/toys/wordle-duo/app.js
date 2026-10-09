// Wordle Duo UI: onboarding (create / join a room) and the room view.
import { isConfigured, currentUser, signInWithGoogle, signOut, firstName } from '../../shared/supabase.js';
import * as api from './api.js';
import { parsePixels, parseShareText } from './parse.js';
import {
  SLOTS, localDateStr, addDays, puzzleNo, dateForPuzzle, mondayIndex, toUTC,
  scoreLabel, other, winnerOf, computeStats, weekStandings,
} from './scoring.js';

const MAX_SIDE = 900;
const HISTORY_DAYS = 400;
const HISTORY_ROWS = 30;
const CALENDAR_WEEKS = 12;
const LAST_ROOM_KEY = 'wordle-duo:last-room';
const EMOJIS = ['🐻', '🐰', '🐱', '🐶', '🦊', '🐼', '🐸', '🐧', '🦄', '🐝', '🌸', '🍓'];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s, opts) => new Date(toUTC(s)).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });
const errMsg = (e) => e?.message || 'Something went wrong 😵';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

const ui = {
  me: null,
  myName: '',
  room: null,
  members: [],
  results: new Map(),   // puzzle → { [userId]: result } (only rows the no-spoiler rule lets us see)
  submitted: new Map(), // puzzle → Set(userId)
  selected: localDateStr(),
  pending: null,
  celebrate: false,
  live: null,
};

/* ---------- room data helpers ---------- */
const memberIn = (p) => ui.members.find((m) => m.slot === (p === 'p1' ? 1 : 2));
const mySlot = () => SLOTS.find((p) => memberIn(p)?.user_id === ui.me);
const pname = (p) => esc(memberIn(p)?.display_name ?? 'your person');
const pemoji = (p) => esc(memberIn(p)?.emoji ?? '❔');
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

function emojiPicker(name, chosen) {
  return `<div class="emoji-row" data-emoji-group="${name}">${EMOJIS.map((e) =>
    `<button type="button" class="emoji-chip ${e === chosen ? 'on' : ''}" data-action="pick-emoji" data-e="${e}">${e}</button>`).join('')}</div>`;
}
const pickedEmoji = (name) => document.querySelector(`[data-emoji-group="${name}"] .on`)?.dataset.e || EMOJIS[0];

function showSignIn(authError) {
  const joining = new URLSearchParams(location.search).has('join');
  showGate(`
    <div class="card center narrow">
      <h2>${joining ? 'You\'ve been invited 💌' : 'Wordle, but make it a duo 💕'}</h2>
      <p class="muted">Sign in so your rooms and scores follow you to any device.</p>
      ${authError ? `<p class="muted" style="color:var(--danger)">${esc(authError)}</p>` : ''}
      <button class="btn" data-action="google" style="--pc:var(--blue)">Continue with Google</button>
    </div>`);
}

async function showHome() {
  ui.live?.close();
  ui.live = null;
  ui.room = null;
  history.replaceState(null, '', location.pathname);
  let rooms = [];
  try { rooms = await api.listMyRooms(); } catch (e) { toast(errMsg(e)); }
  showGate(`
    <div class="gate-grid">
      ${rooms.length ? `<div class="card span"><h2>Your rooms 🏠</h2><div class="room-list">${rooms.map((r) =>
        `<button class="btn ghost" data-action="open-room" data-id="${r.id}">${esc(r.name)}</button>`).join('')}</div></div>` : ''}
      <form class="card" data-form="create">
        <h2>Start a room 💌</h2>
        <p class="muted">Make a room, send the invite link to your person, and the daily showdown begins.</p>
        <label>Room name<input class="field-input" name="room" maxlength="40" value="Us" required></label>
        <label>Your name<input class="field-input" name="name" maxlength="24" placeholder="Aryan" value="${esc(ui.myName)}" required></label>
        <label>Your emoji</label>${emojiPicker('create', '🐻')}
        <button class="btn" style="--pc:var(--pink)">Create room</button>
      </form>
      <form class="card" data-form="code">
        <h2>Got a code? 🔑</h2>
        <p class="muted">If someone sent you a 6-letter code, pop it in.</p>
        <input class="field-input code" name="code" maxlength="6" placeholder="AB12CD" required>
        <button class="btn" style="--pc:var(--blue)">Continue</button>
      </form>
    </div>`);
}

async function showJoin(code) {
  showGate('<div class="card center">Looking up that room… 🔍</div>');
  let preview;
  try { preview = await api.previewRoom(code); } catch (e) { toast(errMsg(e)); }
  if (!preview) {
    showGate(`<div class="card center"><h2>Hmm, no room with code ${esc(code.toUpperCase())} 🤔</h2>
      <button class="btn ghost" data-action="home">Back</button></div>`);
    return;
  }
  if (preview.already_member && await openRoom(preview.room_id)) return;
  if (preview.is_full) {
    showGate(`<div class="card center"><h2>${esc(preview.room_name)} is full 🙈</h2>
      <p class="muted">It's a duo — two players max.</p><button class="btn ghost" data-action="home">Start your own</button></div>`);
    return;
  }
  const who = preview.member_names.map(esc).join(' &amp; ');
  showGate(`
    <form class="card center narrow" data-form="join" data-code="${esc(code)}">
      <h2>Join “${esc(preview.room_name)}” 💞</h2>
      ${who ? `<p class="muted">with ${who}</p>` : ''}
      <label>Your name<input class="field-input" name="name" maxlength="24" value="${esc(ui.myName)}" required></label>
      <label>Your emoji</label>${emojiPicker('join', '🐰')}
      <button class="btn" style="--pc:var(--pink)">Join</button>
    </form>`);
}

async function openRoom(roomId) {
  showGate('<div class="card center">Opening your room… 💌</div>');
  try {
    const data = await api.loadRoom(roomId, puzzleNo(localDateStr()) - HISTORY_DAYS);
    if (!data.room) { store.del(LAST_ROOM_KEY); return false; }
    apply(data);
  } catch (e) {
    toast(errMsg(e));
    return false;
  }
  store.set(LAST_ROOM_KEY, roomId);
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
    toast(errMsg(e));
    return false;
  }
  ui.celebrate = !before && !!winnerOf(dayFor(puzzle));
  const celebrated = ui.celebrate;
  render();
  return celebrated;
}

/* ---------- room rendering ---------- */
function miniGrid(grid, size = '') {
  return `<div class="grid ${size}">${grid.map((r) => `<div class="row">${[...r].map((c) => `<span class="t ${c}"></span>`).join('')}</div>`).join('')}</div>`;
}

function renderHeader() {
  $('vs').innerHTML = `<span class="a">${pemoji('p1')} ${pname('p1')}</span> <span style="color:var(--faint)">vs</span> <span class="b">${pname('p2')} ${pemoji('p2')}</span>`;
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
      : `${pemoji(w)} ${pname(w)} wins! ${scoreLabel(day[w])}/6 vs ${scoreLabel(day[other(w)])}/6`;
    const sub = w === 'tie' ? 'Equally brilliant, obviously.' : day[other(w)].solved ? `Better luck tomorrow, ${pname(other(w))} 🌸` : `${pname(other(w))} got stumped. Tomorrow's yours 🌸`;
    m.innerHTML = `<div class="matchup ${ui.celebrate ? 'pop' : ''}" id="matchBox"><div class="headline">${headline}</div><div class="sub">${sub}</div></div>`;
    if (ui.celebrate) burst(w);
  } else if (me && day[me] && memberIn(them) && !playedFor(puzzle, them)) {
    m.innerHTML = `<div class="matchup waiting"><div class="headline">💌 Waiting for ${pname(them)}…</div><div class="sub">Your result stays sealed until they play. No spoilers 🤫</div></div>`;
  } else if (me && !day[me] && playedFor(puzzle, them)) {
    m.innerHTML = `<div class="matchup waiting"><div class="headline">👀 ${pname(them)} has played!</div><div class="sub">Add yours to unseal both boards.</div></div>`;
  } else {
    m.innerHTML = '';
  }
  ui.celebrate = false;
}

function inviteCard() {
  return `<div class="card player" style="--pc:var(--p2)">
    <div class="phead"><span class="avatar">❔</span><span class="pname">Your person</span></div>
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
  const crown = winner === p ? '<span class="crown">👑</span>' : winner === 'tie' ? '<span class="crown">💞</span>' : '';
  const you = isMe ? ' <span class="you">you</span>' : '';
  const head = `<div class="phead"><span class="avatar">${esc(m.emoji)}</span><span class="pname">${esc(m.display_name)}${you}</span>${crown}</div>`;
  const isPast = ui.selected < localDateStr();
  let body;
  if (r) {
    const src = { screenshot: '📸 from screenshot', text: '📋 from share text', manual: '✍️ entered by hand' }[r.source] || '';
    body = `<div class="result">${r.grid?.length ? miniGrid(r.grid) : ''}
      <div class="score">${scoreLabel(r)}<small>/6</small></div>
      <div class="meta-row"><span>${src}</span>${isMe ? '<button class="link-btn" data-action="redo">redo</button>' : ''}</div></div>`;
  } else if (isMe) {
    const pend = ui.pending;
    body = `<label class="drop" data-drop>
        <input type="file" accept="image/*" data-file>
        <span class="big">📸</span><span class="t">Add your screenshot</span>
        <span class="s">tap to choose · drag &amp; drop · or paste</span>
      </label>
      ${pend ? `<div class="note ${pend.ok ? 'info' : ''}">${pend.ok && pend.grid?.length ? miniGrid(pend.grid, 'sm') + '<br>' : ''}${esc(pend.note || '')}${pend.ok ? ' Pick your score below to save it.' : ''}</div>` : ''}
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
      <div class="phead" style="margin-bottom:0"><span class="avatar">${pemoji(p)}</span><span class="pname">${pname(p)}</span></div>
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

function renderHistory() {
  const puzzles = [...new Set([...ui.results.keys(), ...ui.submitted.keys()])].sort((a, b) => b - a).slice(0, HISTORY_ROWS);
  if (!puzzles.length) {
    $('hist').innerHTML = `<div class="card" style="text-align:center;color:var(--muted)">No games yet. Today's the day 🌱</div>`;
    return;
  }
  $('hist').innerHTML = puzzles.map((n) => {
    const d = dateForPuzzle(n);
    const day = dayFor(n);
    const w = winnerOf(day);
    const side = (p, right) => {
      const r = day[p];
      if (!r) return `<div class="who ${right ? 'right' : ''}" style="color:var(--faint)">${playedFor(n, p) ? '🔒' : '—'}</div>`;
      const sc = `<span class="sc ${w === p ? 'win' : ''}">${scoreLabel(r)}/6</span>`;
      const g = r.grid?.length ? miniGrid(r.grid, 'sm') : '';
      return `<div class="who ${right ? 'right' : ''}">${right ? sc + g : g + sc}</div>`;
    };
    const mid = w === 'tie' ? '💞' : w === 'p1' ? '◀👑' : w === 'p2' ? '👑▶' : '⏳';
    return `<button class="hrow" data-action="goto" data-d="${d}">
      <span class="date">${esc(fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }))}<small>#${n.toLocaleString()}</small></span>
      ${side('p1', false)}<span class="mid">${mid}</span>${side('p2', true)}</button>`;
  }).join('');
}

function render() {
  renderHeader();
  renderDay();
  renderScoreboard();
  renderCalendar();
  renderHistory();
}

/* ---------- effects ---------- */
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
    toast(e?.code === '23505' ? 'Already saved for that day. Hit redo first.' : errMsg(e));
    return;
  }
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
    return parsePixels(ctx.getImageData(0, 0, w, h).data, w, h);
  } catch {
    return { ok: false, note: "Couldn't open that image. If it's HEIC, try a PNG/JPG screenshot." };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/') || !ui.room) return;
  toast('Reading the board… 🔍');
  const result = await readScreenshot(file);
  if (result.ok && result.confidence === 'high') {
    await saveMine(puzzleNo(ui.selected), result);
  } else {
    ui.pending = result;
    renderDay();
  }
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
  $('set-emoji').value = me?.emoji ?? '';
  $('set-name').value = me?.display_name ?? '';
  $('set-room').value = ui.room.name;
  $('set-room').disabled = ui.room.created_by !== ui.me;
  $('set-invite').textContent = inviteLink();
  $('settings').showModal();
}

async function saveSettings() {
  const me = ui.members.find((m) => m.user_id === ui.me);
  const name = $('set-name').value.trim();
  const emoji = $('set-emoji').value.trim();
  const roomName = $('set-room').value.trim();
  try {
    if (me && (name !== me.display_name || emoji !== me.emoji)) {
      await api.updateMe(ui.room.id, ui.me, { display_name: name || me.display_name, emoji: emoji || me.emoji });
    }
    if (ui.room.created_by === ui.me && roomName && roomName !== ui.room.name) await api.renameRoom(ui.room.id, roomName);
  } catch (e) {
    toast(errMsg(e));
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
    members: ui.members.map((m) => ({ slot: m.slot, name: m.display_name, emoji: m.emoji })),
    results: [...ui.results.entries()].flatMap(([n, row]) => Object.values(row).map((r) => ({
      puzzle: n, date: dateForPuzzle(n), player: ui.members.find((m) => m.user_id === r.user_id)?.display_name,
      solved: r.solved, guesses: r.guesses, grid: r.grid,
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
    try { await navigator.share({ title: 'Wordle Duo', text: `Join my Wordle Duo room "${ui.room.name}" 💌`, url: link }); return; } catch { /* fall back to copy */ }
  }
  try { await navigator.clipboard.writeText(link); toast('Invite link copied 💌'); } catch { prompt('Copy this link:', link); }
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, g, d, id } = el.dataset;
  switch (action) {
    case 'prev': ui.selected = addDays(ui.selected, -1); ui.pending = null; render(); break;
    case 'next': if (ui.selected < localDateStr()) { ui.selected = addDays(ui.selected, 1); ui.pending = null; render(); } break;
    case 'goto': ui.selected = d; ui.pending = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'redo':
      try { await api.deleteResult(ui.room.id, ui.me, puzzleNo(ui.selected)); } catch (err) { toast(errMsg(err)); break; }
      ui.live?.ping();
      await refresh();
      break;
    case 'manual': await handleManual(g); break;
    case 'use-text': await handleShareText(); break;
    case 'pick-emoji':
      el.parentElement.querySelectorAll('.emoji-chip').forEach((c) => c.classList.toggle('on', c === el));
      break;
    case 'open-room': await openRoom(id); break;
    case 'home': await showHome(); break;
    case 'copy-invite': await copyInvite(); break;
    case 'settings': openSettings(); break;
    case 'close-settings': $('settings').close(); break;
    case 'save-settings': await saveSettings(); break;
    case 'export': exportData(); break;
    case 'switch-room': $('settings').close(); store.del(LAST_ROOM_KEY); await showHome(); break;
    case 'google':
      el.disabled = true;
      try { await signInWithGoogle(); } catch (err) { toast(errMsg(err)); el.disabled = false; }
      break;
    case 'sign-out':
      ui.live?.close();
      store.del(LAST_ROOM_KEY);
      await signOut();
      location.replace(location.pathname);
      break;
    case 'leave-room':
      if (!confirm(`Leave “${ui.room.name}”? Your results in this room are deleted.`)) break;
      try { await api.leaveRoom(ui.room.id, ui.me); } catch (err) { toast(errMsg(err)); break; }
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
      const room = await api.createRoom(f.get('room').trim(), f.get('name').trim(), pickedEmoji('create'));
      await openRoom(room.id);
    } else if (form.dataset.form === 'code') {
      history.replaceState(null, '', `${location.pathname}?join=${encodeURIComponent(f.get('code').trim())}`);
      await showJoin(f.get('code').trim());
    } else if (form.dataset.form === 'join') {
      const roomId = await api.joinRoom(form.dataset.code, f.get('name').trim(), pickedEmoji('join'));
      if (await openRoom(roomId)) ui.live?.ping();
    }
  } catch (err) {
    toast(errMsg(err));
  } finally {
    button.disabled = false;
  }
});

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
    showGate(`<div class="card center"><h2>Almost there 🔧</h2><p class="muted">Add <code>PUBLIC_SUPABASE_URL</code> and <code>PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env</code>, then restart.</p></div>`);
    return;
  }
  showGate('<div class="card center">Waking up… 🌙</div>');
  const authError = new URLSearchParams(location.search).get('error_description');
  let user;
  try {
    user = await currentUser();
  } catch (e) {
    showGate(`<div class="card center"><h2>Couldn't sign you in 😵</h2><p class="muted">${esc(errMsg(e))}</p></div>`);
    return;
  }
  if (!user) { showSignIn(authError); return; }
  ui.me = user.id;
  ui.myName = firstName(user);
  const params = new URLSearchParams(location.search);
  if (params.get('join')) { await showJoin(params.get('join')); return; }
  const roomId = params.get('room') || store.get(LAST_ROOM_KEY);
  if (roomId && await openRoom(roomId)) return;
  await showHome();
}

boot();
