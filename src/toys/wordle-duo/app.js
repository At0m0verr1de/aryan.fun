// Wordle UI: onboarding (create / join), the couple's head-to-head (Wordle Duo) and a group's leaderboard.
import { isConfigured, currentUser, signInWithGoogle, firstName } from '../../shared/supabase.js';
import {
  loadSpace, forgetSpace, emojiOf, EMOJIS, GROUP_ICONS, GROUP_MAX, GROUP_EVENT, setGroup, groupChanged, setMode,
} from '../../shared/space.js';
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
import { rankDay, standings, dayHeadline } from './leaderboard.js';

const MAX_SIDE = 900;
const HISTORY_DAYS = 400;
const HISTORY_PAGE = 21;
const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const CALENDAR_WEEKS = 12;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (s, opts) => new Date(toUTC(s)).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });
const errMsg = (e) => e?.message || 'Something went wrong';

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
  openRows: new Set(), // leaderboard rows tapped open (user ids)
  boardTab: 'week',
};

/* ---------- room data helpers ---------- */
const memberIn = (p) => ui.members.find((m) => m.slot === (p === 'p1' ? 1 : 2));
const mySlot = () => SLOTS.find((p) => memberIn(p)?.user_id === ui.me);
const pname = (p) => esc(memberIn(p)?.display_name ?? 'your person');
const avatarHtml = (m) => (m ? `<span class="avatar emo">${esc(emojiOf(m))}</span>` : '<span class="avatar empty">?</span>');
const isCouple = () => ui.room?.kind === 'couple';
const isGroup = () => ui.room?.kind === 'group';
const inCoupleMode = () => ui.space?.mode === 'couple' && isCouple();
const myResult = (puzzle) => ui.results.get(puzzle)?.[ui.me] ?? null;
// Groups colour people by slot; the couple keeps blue and pink.
const SLOT_COLOURS = ['var(--blue)', 'var(--pink)', 'var(--mint)', 'var(--gold)', 'var(--lilac)', '#7dd3fc', '#f9a8d4', '#86efac', '#fdba74', '#c4b5fd'];
const colourOf = (m) => SLOT_COLOURS[(m.slot - 1) % SLOT_COLOURS.length];

// A row of emoji buttons feeding a hidden input, for the create/join forms and settings.
function emojiPicker(name, chosen, choices = EMOJIS) {
  return `<div class="emoji-pick" data-emoji-pick>
    <input type="hidden" name="${name}" value="${esc(chosen)}">
    ${choices.map((e) => `<button type="button" class="${e === chosen ? 'on' : ''}" data-pick="${e}" aria-label="${e}">${e}</button>`).join('')}
  </div>`;
}
const pavatar = (p) => avatarHtml(memberIn(p));
const inviteLink = (room = ui.room) => `${location.origin}${location.pathname}?join=${room.invite_code}`;

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

// No group open: your groups, start one, or join with a code.
async function showHome() {
  ui.live?.close();
  ui.live = null;
  ui.room = null;
  history.replaceState(null, '', location.pathname);
  setTitle('group');
  const groups = ui.space?.groups ?? [];
  const single = !ui.space?.couple;
  const create = ui.space?.access ? `
      <form class="card" data-form="create">
        <h2>Start a group</h2>
        <p class="muted">Up to ${GROUP_MAX} people. Everyone uploads their Wordle and the leaderboard does the rest.</p>
        <label>Group name<input class="field-input" name="room" maxlength="40" placeholder="College gang" required></label>
        <label>Icon</label>${emojiPicker('icon', GROUP_ICONS[0], GROUP_ICONS)}
        <label>Your name<input class="field-input" name="name" maxlength="24" value="${esc(ui.myName)}" required></label>
        <label>Your emoji</label>${emojiPicker('emoji', EMOJIS[0])}
        ${single ? '<label class="check"><input type="checkbox" name="couple"> Actually, this is just me and my partner 💞</label>' : ''}
        <button class="btn" style="--pc:var(--pink)">Create group</button>
      </form>` : `
      <div class="card">
        <h2>Invite only, for now</h2>
        <p class="muted">Groups open with an invite. If someone sent you a code, pop it in here. 💌</p>
      </div>`;
  showGate(`
    <div class="gate-grid">
      ${groups.length ? `<div class="card span"><h2>Your groups</h2><div class="gate-groups">${groups.map((g) =>
        `<button class="btn ghost" data-action="open-room" data-id="${g.id}">${esc(g.icon)} ${esc(g.name)} <small class="muted">${g.members.length}</small></button>`).join('')}</div></div>` : ''}
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
  const asPartner = preview.room_kind === 'couple';
  if (preview.already_member) {
    setMode(asPartner ? 'couple' : 'general');
    if (await openRoom(preview.room_id)) return;
  }
  if (preview.is_full) {
    showGate(`<div class="card center"><h2>${esc(preview.room_name)} is full</h2>
      <p class="muted">${asPartner ? "It's for two." : `Groups hold ${preview.max_members} people.`}</p><button class="btn ghost" data-action="home">Start your own</button></div>`);
    return;
  }
  const names = preview.member_names.map(esc);
  const who = asPartner ? names.join(' &amp; ')
    : names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
  showGate(`
    <form class="card center narrow" data-form="join" data-code="${esc(code)}" data-kind="${esc(preview.room_kind)}">
      <h2>Join ${asPartner ? '' : `${esc(preview.room_icon)} `}“${esc(preview.room_name)}”</h2>
      ${who ? `<p class="muted">${asPartner ? `${who} wants you as their partner 💞` : `Wordle leaderboard with ${who}`}</p>` : ''}
      <label>Your name<input class="field-input" name="name" maxlength="24" value="${esc(ui.myName)}" required></label>
      <label>Your emoji</label>${emojiPicker('emoji', EMOJIS[1])}
      <button class="btn" style="--pc:var(--pink)">Join</button>
    </form>`);
}

async function openRoom(roomId) {
  if (ui.room?.id !== roomId) showGate('<div class="card center">Opening…</div>');
  try {
    const data = await api.loadRoom(roomId, puzzleNo(localDateStr()) - HISTORY_DAYS);
    if (!data.room) return false;
    apply(data);
  } catch (e) {
    fail(e, 'open-room');
    return false;
  }
  ui.openRows = new Set();
  ui.pending = null;
  // Keep the header's group switcher on the group you're looking at.
  if (isGroup() && ui.space) setGroup(ui.space, roomId);
  history.replaceState(null, '', `${location.pathname}?room=${roomId}`);
  ui.live?.close();
  ui.live = api.subscribe(roomId, () => refresh());
  if (ui.pingOnOpen) { ui.pingOnOpen = false; setTimeout(() => ui.live?.ping(), 800); }
  $('gate').hidden = true;
  $('room-view').hidden = false;
  render();
  return true;
}

// Refetch; celebrate if the selected day's winner just became visible.
async function refresh() {
  if (!ui.room) return false;
  const puzzle = puzzleNo(ui.selected);
  const before = !isGroup() && winnerOf(dayFor(puzzle));
  try {
    const data = await api.loadRoom(ui.room.id, puzzleNo(localDateStr()) - HISTORY_DAYS);
    if (!data.room) {
      toast('You are no longer in that group');
      ui.space = await groupChanged({ id: ui.me }, null);
      return false;
    }
    apply(data);
  } catch (e) {
    fail(e, 'refresh');
    return false;
  }
  ui.celebrate = !isGroup() && !before && !!winnerOf(dayFor(puzzle));
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

// "Wordle Duo ♥" for the couple, "Wordle Leaderboard" for a group: page heading, crumb and tab title.
function setTitle(kind) {
  const title = kind === 'couple' ? 'Wordle Duo' : 'Wordle Leaderboard';
  $('wd-title').innerHTML = kind === 'couple' ? `${title} <span class="heart beat" aria-hidden="true">♥</span>` : title;
  const crumb = document.querySelector('.crumb');
  if (crumb) crumb.lastChild.textContent = title;
  document.title = `${title} · made by aryan`;
}

function renderHeader() {
  setTitle(ui.room.kind);
  $('room-view').dataset.kind = isGroup() ? 'board' : 'duo';
  $('head-invite').hidden = !isGroup();
  if (isGroup()) {
    $('vs').innerHTML = `<span class="faces-row">${ui.members.map((m) => `<span title="${esc(m.display_name)}">${esc(emojiOf(m))}</span>`).join('')}
      <span class="count">${ui.members.length}/${ui.room.max_members}</span></span>`;
    $('room-name').textContent = `${ui.room.icon} ${ui.room.name}`;
    return;
  }
  const between = isCouple() ? '<span class="heart beat">♥</span>' : '<span class="vs-x">vs</span>';
  $('vs').innerHTML = `<span class="a">${pavatar('p1')}${pname('p1')}</span>${between}<span class="b">${pname('p2')}${pavatar('p2')}</span>`;
  $('room-name').textContent = ui.room.name;
}

const renderToday = () => (isGroup() ? renderBoard() : renderDay());

/* ---------- group leaderboard ---------- */
// Tile picture without letters, for a leaderboard row.
const strip = (grid, ghost = false) => miniGrid(grid?.length ? grid : ['BBBBB', 'BBBBB', 'BBBBB'], `strip${ghost ? ' ghost' : ''}`);

function renderBoard() {
  const t = localDateStr();
  const puzzle = puzzleNo(ui.selected);
  $('dayLabel').textContent = ui.selected === t ? 'Today' : ui.selected === addDays(t, -1) ? 'Yesterday' : fmtDate(ui.selected, { weekday: 'short', month: 'short', day: 'numeric' });
  $('puzzleLabel').textContent = `Wordle #${puzzle.toLocaleString()} · ${fmtDate(ui.selected, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  $('nextBtn').disabled = ui.selected >= t;

  const rows = rankDay(ui.members, ui.results.get(puzzle) || {}, ui.submitted.get(puzzle) || new Set());
  const me = ui.members.find((m) => m.user_id === ui.me);
  $('me-card').innerHTML = `<div class="card player" style="--pc:${colourOf(me)}">
    <div class="phead">${avatarHtml(me)}<span class="pname">Your board</span></div>${myBody(puzzle)}</div>`;
  $('board-head').textContent = dayHeadline(rows, ui.me, ui.selected === t);
  const crowns = rows.filter((r) => r.result).length > 1;
  const spare = ui.room.max_members - ui.members.length;
  // Your own empty row would just repeat the card above it.
  $('board').innerHTML = rows.filter((r) => r.result || r.member.user_id !== ui.me).map((r) => boardRow(r, crowns, ui.selected < t)).join('') + (spare > 0 ? `
    <div class="lb invite-row"><button class="lb-row" data-action="copy-invite"><span class="rank">＋</span>
      <span class="who"><b>Invite people</b><small>Room for ${spare} more · code ${esc(ui.room.invite_code)}</small></span><span class="state">Share 💌</span></button></div>` : '');
  renderStandings();
}

function boardRow({ member: m, result: r, played, rank }, crowns, isPast) {
  const isMe = m.user_id === ui.me;
  const style = `style="--pc:${colourOf(m)}"`;
  const who = `<span class="who"><b>${esc(m.display_name)}${isMe ? ' <span class="you">you</span>' : ''}</b>`;
  if (r) {
    const open = ui.openRows.has(m.user_id);
    const badge = rank === 1 && crowns ? '👑' : rank;
    const detail = open ? `<div class="lb-detail">${r.grid?.length ? miniGrid(r.grid, r.words ? 'md lettered' : 'md', r.words) : ''}
      <div class="hmeta">${scoreLabel(r)}/6 · ${sourceLabel(r)}${r.words ? '' : '<br>No words saved for this board'}</div></div>` : '';
    return `<div class="lb${isMe ? ' me' : ''}" ${style}>
      <button class="lb-row" data-action="lb-toggle" data-uid="${m.user_id}" aria-expanded="${open}">
        <span class="rank ${rank === 1 ? 'r1' : ''}">${badge}</span>${avatarHtml(m)}${who}<small>${r.solved ? 'tap to see guesses' : 'stumped'}</small></span>
        <span class="pts">${scoreLabel(r)}<small>/6</small></span>${strip(r.grid)}</button>${detail}</div>`;
  }
  if (played) {
    return `<div class="lb sealed-row" ${style}><div class="lb-row"><span class="rank">🔒</span>${avatarHtml(m)}${who}<small>played · add yours to see</small></span>
      <span class="pts">?</span>${strip(null, true)}</div></div>`;
  }
  return `<div class="lb idle" ${style}><div class="lb-row"><span class="rank">·</span>${avatarHtml(m)}${who}<small>${isPast ? "didn't play" : 'hasn’t played yet'}</small></span>
    <span class="state">💤</span><span></span></div></div>`;
}

function renderStandings() {
  const t = localDateStr();
  const today = puzzleNo(t);
  const since = puzzleNo(localDateStr(new Date(ui.room.created_at)));
  const from = ui.boardTab === 'week' ? puzzleNo(addDays(t, -mondayIndex(t))) : since;
  const rows = standings(ui.members, (n) => ui.results.get(n), from, today, today - HISTORY_DAYS);
  document.querySelectorAll('[data-action="board-tab"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === ui.boardTab)));
  const sealed = !myResult(today) && [...(ui.submitted.get(today) || [])].some((id) => id !== ui.me);
  $('standings').innerHTML = `<table class="stand">
    <thead><tr><th></th><th>Player</th><th>Pts</th><th>Played</th><th>Avg</th><th>Streak</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="${r.member.user_id === ui.me ? 'me' : ''}" style="--pc:${colourOf(r.member)}">
      <td class="r">${r.points && r.rank === 1 ? '👑' : r.rank}</td>
      <td class="n"><span>${esc(emojiOf(r.member))} ${esc(r.member.display_name)}</span></td>
      <td class="p">${r.points}</td><td>${r.played}</td><td>${r.avg ? r.avg.toFixed(1) : '–'}</td><td>${r.streak}${r.streak >= 3 ? '🔥' : ''}</td></tr>`).join('')}</tbody>
  </table>
  <p class="stand-note">Solved in 1 = 6 pts, 2 = 5 … 6 = 1, X = 0.${ui.boardTab === 'all' ? ` Since ${esc(fmtDate(dateForPuzzle(since), { month: 'short', day: 'numeric' }))}, when the group started.` : ''}${sealed ? " Today's scores join in once you've played." : ''}</p>`;
}

// Your result for the day, or everything you need to add it (screenshot, quick pick, share text).
function myBody(puzzle) {
  const r = myResult(puzzle);
  if (r) {
    return `<div class="result">${r.grid?.length ? miniGrid(r.grid, r.words ? 'lettered' : '', r.words) : ''}
      <div><div class="score">${scoreLabel(r)}<small>/6</small></div>
      <div class="meta-row"><span>${sourceLabel(r)}</span><button class="link-btn" data-action="redo">redo</button></div></div></div>`;
  }
  return uploadBody();
}

function uploadBody() {
  const pend = ui.pending;
  if (pend?.kind === 'confirm') return confirmPanel(pend);
  const retry = pend?.otherDay ? ` <button class="link-btn" data-action="use-other-day">Save it for ${esc(fmtDate(pend.otherDay, { month: 'short', day: 'numeric' }))} instead</button>` : '';
  return `<label class="drop" data-drop>
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
    body = uploadBody();
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
  if (isGroup()) { renderBoard(); return; }
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
    await api.submitResult(ui.me, puzzle, result);
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
    renderToday();
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
    const fitsYesterday = Boolean(prev) && verifyBoard(shot.grid, scores, prev).verdict === 'match' && !myResult(puzzleNo(yesterday));
    track('wordle_screenshot_rejected', { ratio: check.ratio, evidence: check.evidence, fits_yesterday: fitsYesterday });
    ui.pending = {
      ok: false,
      note: fitsYesterday
        ? `That's the board for ${fmtDate(yesterday, { weekday: 'long' })}, not this day 🤔`
        : `That doesn't look like Wordle #${puzzle.toLocaleString()}. Upload the screenshot for this day 🤔`,
      otherDay: fitsYesterday ? yesterday : null,
      file: fitsYesterday ? file : null,
    };
    renderToday();
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
  renderToday();
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
  const creator = ui.room.created_by === ui.me;
  $('set-title').textContent = isGroup() ? 'Group settings' : 'Room settings';
  $('set-name').value = me?.display_name ?? '';
  $('set-emoji').innerHTML = emojiPicker('emoji', emojiOf(me));
  $('set-room-label').textContent = isGroup() ? 'Group name' : 'Room name';
  $('set-room').value = ui.room.name;
  $('set-room').disabled = !creator;
  $('set-icon-wrap').hidden = !isGroup() || !creator;
  $('set-icon').innerHTML = isGroup() ? emojiPicker('icon', ui.room.icon, GROUP_ICONS) : '';
  $('set-invite').textContent = inviteLink();
  $('set-couple').hidden = !isCouple();
  $('set-since').value = ui.room.since ?? '';
  // People: anyone sees the list; the creator can remove others.
  $('set-members-wrap').hidden = !isGroup();
  $('set-members-label').textContent = `People · ${ui.members.length}/${ui.room.max_members}`;
  $('set-members').innerHTML = isGroup() ? ui.members.map((m) => `<li>${esc(emojiOf(m))} ${esc(m.display_name)}
    ${m.user_id === ui.room.created_by ? '<small>started it</small>' : ''}${m.user_id === ui.me ? '<small>you</small>' : ''}
    ${creator && m.user_id !== ui.me ? `<button class="link-btn" data-action="remove-member" data-id="${m.user_id}">remove</button>` : ''}</li>`).join('') : '';
  // A group of just the two of you can become your couple room, if you're both single.
  $('make-couple').hidden = !isGroup() || Boolean(ui.space?.couple) || ui.members.length > 2;
  $('leave-room-btn').hidden = inCoupleMode();
  $('leave-room-btn').textContent = isGroup() ? 'Leave group' : 'Leave';
  $('settings').showModal();
}

async function saveSettings() {
  const me = ui.members.find((m) => m.user_id === ui.me);
  const name = $('set-name').value.trim();
  const emoji = $('set-emoji').querySelector('input[name="emoji"]').value;
  const roomName = $('set-room').value.trim();
  const icon = $('set-icon').querySelector('input[name="icon"]')?.value;
  const since = $('set-since').value || null;
  try {
    const patch = {};
    if (me && name && name !== me.display_name) patch.display_name = name;
    if (me && emoji && emoji !== me.emoji) patch.emoji = emoji;
    if (Object.keys(patch).length) await api.updateMe(ui.room.id, ui.me, patch);
    if (ui.room.created_by === ui.me) {
      const room = {};
      if (roomName && roomName !== ui.room.name) room.name = roomName;
      if (isGroup() && icon && icon !== ui.room.icon) room.icon = icon;
      if (Object.keys(room).length) await api.updateRoom(ui.room.id, room);
    }
    if (isCouple() && since !== (ui.room.since ?? null)) await api.setCouple(ui.room.id, true, since);
  } catch (e) {
    fail(e, 'save-settings');
    return;
  }
  $('settings').close();
  ui.live?.ping();
  ui.space = await groupChanged({ id: ui.me }, isGroup() ? ui.room.id : null);
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
  a.download = `wordle-${localDateStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyInvite() {
  const link = inviteLink();
  const text = isGroup() ? `Join "${ui.room.name}" on my Wordle leaderboard ${ui.room.icon}` : `Join my Wordle Duo room "${ui.room.name}" 💌`;
  if (navigator.share) {
    try {
      await navigator.share({ title: isGroup() ? 'Wordle Leaderboard' : 'Wordle Duo', text, url: link });
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
      try { await api.deleteResult(ui.me, puzzleNo(ui.selected)); } catch (err) { fail(err, 'redo'); break; }
      ui.live?.ping();
      await refresh();
      break;
    case 'manual': await handleManual(g); break;
    case 'confirm-save':
      el.disabled = true;
      await saveConfirmed();
      if (ui.pending?.kind === 'confirm') renderToday(); // save failed; re-enable
      break;
    case 'confirm-cancel': ui.pending = null; renderToday(); break;
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
      if (!confirm(`Make “${ui.room.name}” your couple room? 💞 It moves out of Groups and becomes your home screen together.`)) break;
      try { await api.setCouple(ui.room.id, true, null); } catch (err) { fail(err, 'make-couple'); break; }
      track('couple_set', { since: false });
      ui.live?.ping();
      forgetSpace();
      setMode('couple');
      location.href = BASE;
      break;
    case 'board-tab': ui.boardTab = el.dataset.tab; renderStandings(); break;
    case 'lb-toggle': {
      const uid = el.dataset.uid;
      if (ui.openRows.has(uid)) ui.openRows.delete(uid); else ui.openRows.add(uid);
      if (ui.openRows.has(uid)) track('wordle_board_opened', { own: uid === ui.me });
      renderBoard();
      break;
    }
    case 'remove-member': {
      const who = ui.members.find((m) => m.user_id === id);
      if (!who || !confirm(`Remove ${who.display_name} from “${ui.room.name}”? They can come back if someone sends them the invite again.`)) break;
      try { await api.removeMember(ui.room.id, id); } catch (err) { fail(err, 'remove-member'); break; }
      track('group_member_removed');
      ui.live?.ping();
      $('settings').close();
      ui.space = await groupChanged({ id: ui.me }, ui.room.id);
      await refresh();
      toast(`${who.display_name} was removed`);
      break;
    }
    case 'google':
      el.disabled = true;
      try { await signInWithGoogle(); } catch (err) { fail(err, 'signin'); el.disabled = false; }
      break;
    case 'leave-room':
      if (!confirm(`Leave “${ui.room.name}”? Your results stay yours; they just won't show here anymore.`)) break;
      try { await api.leaveRoom(ui.room.id, ui.me); } catch (err) { fail(err, 'leave-room'); break; }
      track('wordle_room_left', { kind: ui.room.kind });
      ui.live?.ping();
      $('settings').close();
      ui.room = null;
      ui.space = await groupChanged({ id: ui.me }, null); // opens your next group, or the start screen
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
      const kind = f.get('couple') ? 'couple' : 'group';
      const room = await api.createRoom(f.get('room').trim(), f.get('name').trim(), f.get('emoji'), kind, f.get('icon'));
      track('wordle_room_created', { kind });
      if (kind === 'couple') {
        forgetSpace();
        setMode('couple');
        ui.space = await loadSpace({ id: ui.me });
        await openRoom(room.id);
      } else {
        ui.space = await groupChanged({ id: ui.me }, room.id); // the group listener opens it
      }
    } else if (form.dataset.form === 'code') {
      history.replaceState(null, '', `${location.pathname}?join=${encodeURIComponent(f.get('code').trim())}`);
      await showJoin(f.get('code').trim());
    } else if (form.dataset.form === 'join') {
      const roomId = await api.joinRoom(form.dataset.code, f.get('name').trim(), f.get('emoji'));
      const couple = form.dataset.kind === 'couple';
      track('wordle_room_joined', { kind: form.dataset.kind });
      ui.pingOnOpen = true; // let everyone already in see you arrive
      setMode(couple ? 'couple' : 'general');
      if (couple) {
        forgetSpace();
        ui.space = await loadSpace({ id: ui.me });
        await openRoom(roomId);
      } else {
        ui.space = await groupChanged({ id: ui.me }, roomId);
      }
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
  if (myResult(puzzleNo(ui.selected))) { toast('Your board is already in for this day'); return; }
  handleFile(item.getAsFile());
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ui.room) refresh();
});

/* ---------- boot ---------- */
document.documentElement.dataset.groups = 'live'; // the header's switcher redraws us in place
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
  // Partner mode: Wordle simply is your couple room. Groups never opens it: a ?room= link, else the switcher's group.
  const coupleRoom = ui.space?.couple?.room.id ?? null;
  const linked = params.get('room');
  const roomId = ui.space?.mode === 'couple'
    ? coupleRoom
    : (linked && linked !== coupleRoom ? linked : ui.space?.group?.id);
  if (roomId && await openRoom(roomId)) return;
  await showHome();
}

// The header's group switcher (or a create/join/leave here) picked another group: swap in place.
window.addEventListener(GROUP_EVENT, async (e) => {
  if (!ui.me || ui.space?.mode === 'couple') return;
  ui.space = await loadSpace({ id: ui.me });
  const id = e.detail?.id;
  if (id && id === ui.room?.id) return; // already showing it (openRoom itself told the header)
  if (id && await openRoom(id)) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  await showHome();
});

boot();
