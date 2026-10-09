// Drinks UI: two pitchers, a quick logger, the night view with hangover notes, calendar/year, stats.
import { isConfigured, currentUser } from '../../shared/supabase.js';
import { loadSpace, emojiOf } from '../../shared/space.js';
import { track, reportError } from '../../shared/telemetry.js';
import * as api from './api.js';
import {
  KINDS, HANGOVERS, shotsOf, round1, bottlesOf, currentNight, dateStr, addDays, mondayOf, monthStart, monthEnd,
  addMonths, personStats, dryStreak, weeksOf, monthsOf, hangoverInsight, jugOf, shotsByDay,
} from './stats.js';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const HISTORY_DAYS = 400;   // always loaded, so dry streaks and "this week" work in any view
const HEAT_FULL = 8;        // shots in a night that paints a calendar cell fully
const MAX_QTY = 20;
const JUG_TOP = 22;
const JUG_BOTTOM = 142;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s, opts) => new Date(`${s}T00:00:00`).toLocaleDateString(undefined, opts);
const shotsLabel = (n) => `${round1(n)} shot${round1(n) === 1 ? '' : 's'}`;

const ui = {
  me: null,
  members: [],          // couple room members, slot order: [p1, p2]
  roomId: null,
  view: 'month',        // 'month' | 'year'
  anchor: monthStart(dateStr(new Date())),
  night: currentNight(),
  drinks: [],
  notes: [],
  goals: [],
  compose: { kind: 'beer', ml: KINDS.beer.size, abv: KINDS.beer.abv, qty: 1 },
  live: null,
  filled: false,        // pitchers animate up from empty on first paint
};

const today = () => dateStr(new Date());
const slotVar = (m) => (m.slot === 1 ? 'var(--p1)' : 'var(--p2)');
const nameOf = (m) => (m.user_id === ui.me ? 'You' : esc(m.display_name));
const memberOf = (userId) => ui.members.find((m) => m.user_id === userId);

function period() {
  if (ui.view === 'year') {
    const y = ui.anchor.slice(0, 4);
    return { from: `${y}-01-01`, to: `${y}-12-31`, label: y };
  }
  return { from: ui.anchor, to: monthEnd(ui.anchor), label: fmt(ui.anchor, { month: 'long', year: 'numeric' }) };
}

/* ---------- data ---------- */
async function load() {
  const { from, to } = period();
  const recent = addDays(today(), -HISTORY_DAYS);
  const data = await api.loadRange(from < recent ? from : recent, to > today() ? to : addDays(today(), 1));
  Object.assign(ui, data);
}

async function refresh() {
  try { await load(); } catch (e) { fail(e, 'load'); return; }
  render();
}

function changed() {
  ui.live?.ping();
  return refresh();
}

/* ---------- pitchers ---------- */
function pitcherSvg(level, colour, cap, over) {
  const height = JUG_BOTTOM - JUG_TOP;
  const drop = Math.round((1 - level) * height);
  const body = `M22 ${JUG_TOP} H92 L87 132 Q86 ${JUG_BOTTOM} 77 ${JUG_BOTTOM} H37 Q28 ${JUG_BOTTOM} 27 132 Z`;
  // Marks at a third, two thirds and the brim: 5 / 10 / 15 shots for a month.
  const ticks = [1 / 3, 2 / 3, 1].map((t) => {
    const y = JUG_BOTTOM - t * height;
    return `<line x1="30" x2="40" y1="${y}" y2="${y}" class="tick"/><text x="44" y="${y + 3.5}" class="tick-label">${Math.round(cap * t)}</text>`;
  }).join('');
  // Over the brim: it spills down the side.
  const spill = over ? `<g class="spill" style="color:${colour}">
      <path d="M14 ${JUG_TOP - 10} q -6 10 -2 26 q 3 12 -1 30" />
      <circle cx="11" cy="${JUG_TOP + 52}" r="3.2" class="drip"/><circle cx="16" cy="${JUG_TOP + 20}" r="2.4" class="drip d2"/>
      <ellipse cx="18" cy="147" rx="16" ry="2.6" class="puddle"/>
    </g>` : '';
  return `<svg class="pitcher${over ? ' over' : ''}" viewBox="0 0 130 150" aria-hidden="true">
    <defs><clipPath id="jug-${colour.replace(/\W/g, '')}"><path d="${body}"/></clipPath></defs>
    <g clip-path="url(#jug-${colour.replace(/\W/g, '')})">
      <g class="liquid" style="--drop:${drop}px; color:${colour}">
        <rect x="0" y="${JUG_TOP + 4}" width="130" height="${height + 10}" fill="currentColor" opacity=".78"/>
        <path class="wave" d="M-60 ${JUG_TOP + 6} q 15 -7 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 v 12 h -240 z" fill="currentColor"/>
        <circle class="bubble" cx="50" cy="130" r="2.5"/><circle class="bubble b2" cx="68" cy="134" r="1.8"/><circle class="bubble b3" cx="58" cy="128" r="2"/>
      </g>
    </g>
    ${ticks}
    <path d="${body}" class="glass"/>
    <path d="M90 42 C118 44 118 104 86 108" class="handle"/>
    <path d="M22 ${JUG_TOP} L12 ${JUG_TOP - 9}" class="glass"/>
    ${spill}
  </svg>`;
}

function renderPitchers() {
  const { from, to, label } = period();
  $('periodLabel').textContent = label;
  $('nextBtn').disabled = ui.view === 'year' ? to.slice(0, 4) >= today().slice(0, 4) : addMonths(ui.anchor, 1) > today();
  document.querySelectorAll('[data-view-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.viewBtn === ui.view)));
  const stats = ui.members.map((m) => personStats(ui.drinks, m.user_id, from, to, today()));
  const months = ui.view === 'year' ? 12 : 1;
  const jugs = stats.map((s) => jugOf(s.total, months));
  const levels = jugs.map((j) => j.level);
  const span = ui.view === 'year' ? 'year' : 'month';
  const live = from <= today() && today() <= to;
  $('pitchers').innerHTML = ui.members.map((m, i) => {
    const s = stats[i];
    const jug = jugs[i];
    const mine = m.user_id === ui.me;
    const bottles = bottlesOf(s.total);
    let verdict = '';
    if (jug.over) {
      verdict = live
        ? `<div class="cutoff">${mine ? 'Fuck you, alcoholic.' : `${esc(m.display_name)}, you alcoholic.`}<br>Cut off for the rest of the ${span} 🚫</div>`
        : `<div class="cutoff past">Got cut off this ${span} 🚫</div>`;
    } else if (live) {
      verdict = `<div class="jug-left${jug.left <= 3 ? ' close' : ''}">${jug.left <= 3 ? '😬 ' : ''}${jug.left} shot${jug.left === 1 ? '' : 's'} left this ${span}</div>`;
    }
    return `<div class="jug${jug.over ? ' is-over' : ''}" style="--pc:${slotVar(m)}">
      <div class="jug-who"><span class="jug-emoji">${esc(emojiOf(m))}</span>${esc(m.display_name)}</div>
      <div class="jug-art">${pitcherSvg(ui.filled ? levels[i] : 0, slotVar(m), jug.cap, jug.over)}${jug.over ? '<span class="stamp">CUT OFF</span>' : ''}</div>
      <div class="jug-num">${round1(s.total)}<small> / ${jug.cap} shots</small></div>
      <div class="jug-sub">${bottles >= 0.1 ? `≈ ${round1(bottles)} bottle${round1(bottles) === 1 ? '' : 's'} of vodka · ` : ''}${s.dry} dry day${s.dry === 1 ? '' : 's'} 🌱</div>
      ${verdict}
    </div>`;
  }).join('');
  if (!ui.filled) {
    ui.filled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelectorAll('.jug .liquid').forEach((g, i) => {
        g.style.setProperty('--drop', `${Math.round((1 - levels[i]) * (JUG_BOTTOM - JUG_TOP))}px`);
      });
    }));
  }
}

/* ---------- logging ---------- */
// Past this month's 15 shots already? The add button gets judgemental.
function cutOff() {
  const start = monthStart(today());
  return jugOf(personStats(ui.drinks, ui.me, start, monthEnd(start), today()).total).over;
}

function renderComposer() {
  const c = ui.compose;
  const kind = KINDS[c.kind];
  const tonight = currentNight();
  const nightChips = [
    [tonight, 'Tonight'],
    [addDays(tonight, -1), 'Last night'],
  ];
  const custom = !nightChips.some(([d]) => d === ui.night);
  const adding = shotsOf(c);
  $('composer').innerHTML = `
    <div class="row">
      ${nightChips.map(([d, l]) => `<button class="chip ${ui.night === d ? 'on' : ''}" data-action="night" data-d="${d}">${l}</button>`).join('')}
      <label class="chip date ${custom ? 'on' : ''}">📅 <input type="date" data-night-pick value="${ui.night}" max="${addDays(today(), 1)}"></label>
    </div>
    <div class="kinds">${Object.entries(KINDS).map(([k, v]) =>
      `<button class="kind ${c.kind === k ? 'on' : ''}" data-action="kind" data-k="${k}"><span>${v.emoji}</span>${v.label}</button>`).join('')}</div>
    <div class="row">
      ${kind.sizes.map((ml) => `<button class="chip ${c.ml === ml ? 'on' : ''}" data-action="size" data-ml="${ml}">${ml} ml</button>`).join('')}
      <label class="num-field"><input type="number" min="1" max="3000" step="1" value="${c.ml}" data-compose="ml"> ml</label>
      <label class="num-field"><input type="number" min="0.5" max="96" step="0.5" value="${c.abv}" data-compose="abv"> %</label>
    </div>
    <div class="row add-row">
      <div class="qty"><button data-action="qty" data-n="-1" aria-label="One less">−</button><b>${c.qty}</b><button data-action="qty" data-n="1" aria-label="One more">+</button></div>
      <button class="btn add" data-action="add">${cutOff() ? 'Add anyway 🙄' : 'Add'} ${kind.emoji} · ${shotsLabel(adding)}</button>
    </div>`;
}

async function addDrink(button) {
  const c = ui.compose;
  if (!(c.ml > 0 && c.ml <= 3000 && c.abv > 0 && c.abv <= 96)) { toast('That size or strength looks off 🤔'); return; }
  button.disabled = true;
  try {
    await api.addDrink({ day: ui.night, ...c });
  } catch (e) {
    fail(e, 'add-drink');
    button.disabled = false;
    return;
  }
  track('drink_logged', { kind: c.kind, qty: c.qty, days_back: Math.max(0, Math.round((Date.parse(today()) - Date.parse(ui.night)) / 86400000)) });
  toast(`${KINDS[c.kind].emoji} Added ${shotsLabel(shotsOf(c))} 💧`);
  ui.compose.qty = 1;
  await changed();
}

/* ---------- the night ---------- */
function renderNight() {
  const night = ui.night;
  const label = night === currentNight() ? 'Tonight' : night === addDays(currentNight(), -1) ? 'Last night' : fmt(night, { weekday: 'long', month: 'short', day: 'numeric' });
  $('nightLabel').textContent = label;
  const sides = ui.members.map((m) => {
    const list = ui.drinks.filter((d) => d.day === night && d.user_id === m.user_id);
    const total = list.reduce((a, d) => a + shotsOf(d), 0);
    const note = ui.notes.find((n) => n.day === night && n.user_id === m.user_id);
    const mine = m.user_id === ui.me;
    const items = list.length
      ? list.map((d) => `<li><span>${KINDS[d.kind].emoji} ${d.qty > 1 ? `${d.qty} × ` : ''}${Number(d.ml)} ml · ${Number(d.abv)}%</span>
          <span class="muted">${round1(shotsOf(d))}</span>${mine ? `<button class="x" data-action="del" data-id="${d.id}" aria-label="Remove">×</button>` : ''}</li>`).join('')
      : `<li class="muted empty">${mine ? 'Nothing logged. A dry one? 🌱' : 'Nothing logged 🌱'}</li>`;
    const morning = mine ? morningForm(note) : note
      ? `<div class="morning-read">${note.hangover != null ? `${HANGOVERS[note.hangover].emoji} ${HANGOVERS[note.hangover].label}` : ''}${note.note ? `<p>“${esc(note.note)}”</p>` : ''}</div>`
      : '';
    return `<div class="night-side" style="--pc:${slotVar(m)}">
      <div class="night-head"><span>${esc(emojiOf(m))} ${nameOf(m)}</span><b>${shotsLabel(total)}</b></div>
      <ul class="drink-list">${items}</ul>
      ${morning}
    </div>`;
  }).join('');
  $('night').innerHTML = sides;
}

function morningForm(note) {
  const h = note?.hangover;
  return `<div class="morning">
    <div class="morning-title">The morning after</div>
    <div class="hang">${HANGOVERS.map((x, i) => `<button class="${h === i ? 'on' : ''}" data-action="hangover" data-h="${i}" title="${x.label}">${x.emoji}<small>${x.label}</small></button>`).join('')}</div>
    <textarea data-note maxlength="280" placeholder="Notes for future you: what you drank, what you ate, how bad it was…">${esc(note?.note ?? '')}</textarea>
    <button class="btn ghost small" data-action="save-note">Save note</button>
  </div>`;
}

async function saveNote(hangover) {
  const current = ui.notes.find((n) => n.day === ui.night && n.user_id === ui.me);
  const level = hangover === undefined ? current?.hangover ?? null : (current?.hangover === hangover ? null : hangover);
  const note = document.querySelector('[data-note]')?.value.trim() ?? '';
  try {
    await api.saveNote(ui.night, level, note);
  } catch (e) {
    fail(e, 'save-note');
    return;
  }
  track('drink_note_saved', { hangover: level, has_note: Boolean(note) });
  if (hangover === undefined) toast('Noted 📝');
  await changed();
}

/* ---------- calendar & year ---------- */
function renderCalendar() {
  if (ui.view === 'year') { renderYear(); return; }
  const { from, to } = period();
  const byDay = shotsByDay(ui.drinks);
  const start = mondayOf(from);
  const cells = [];
  for (let d = start; d <= to || cells.length % 7; d = addDays(d, 1)) {
    if (d < from || d > to) { cells.push('<span class="cell pad"></span>'); continue; }
    const day = byDay.get(d) || {};
    const halves = ui.members.map((m) => {
      const s = day[m.user_id] || 0;
      const a = Math.min(1, s / HEAT_FULL);
      return `<i style="--pc:${slotVar(m)}; --a:${s ? Math.max(0.18, a) : 0}"></i>`;
    }).join('');
    const rough = ui.notes.some((n) => n.day === d && n.hangover >= 2);
    const future = d > today();
    cells.push(`<button class="cell ${d === ui.night ? 'sel' : ''} ${future ? 'future' : ''}" data-action="pick-night" data-d="${d}" ${future ? 'disabled' : ''}
      title="${fmt(d, { month: 'short', day: 'numeric' })}">${halves}<span class="dn">${Number(d.slice(8))}</span>${rough ? '<span class="rough">🤢</span>' : ''}</button>`);
  }
  $('calendar').innerHTML = `<div class="cal-head">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal">${cells.join('')}</div>
    <div class="weeks">${weeksOf(ui.drinks, from, to).map((w) => `<div class="week">
      <span class="wl">${fmt(w.start, { month: 'short', day: 'numeric' })}</span>
      ${ui.members.map((m) => {
        const s = w.totals[m.user_id] || 0;
        return `<span class="wbar" style="--pc:${slotVar(m)}; --w:${Math.min(100, (s / weekScale(from, to)) * 100)}%"><b>${s ? round1(s) : ''}</b></span>`;
      }).join('')}
    </div>`).join('')}</div>`;
}

const weekScale = (from, to) => Math.max(6, ...weeksOf(ui.drinks, from, to).flatMap((w) => Object.values(w.totals)));

function renderYear() {
  const year = ui.anchor.slice(0, 4);
  const months = monthsOf(ui.drinks, year);
  const top = Math.max(10, ...months.flatMap((m) => Object.values(m.totals)));
  $('calendar').innerHTML = `<div class="year">${months.map((m) => `
    <button class="month" data-action="open-month" data-m="${m.month}-01" ${`${m.month}-01` > today() ? 'disabled' : ''}>
      <span class="bars">${ui.members.map((x) => {
        const s = m.totals[x.user_id] || 0;
        return `<span style="--pc:${slotVar(x)}; --h:${(s / top) * 100}%" title="${round1(s)} shots"></span>`;
      }).join('')}</span>
      <span class="ml">${fmt(`${m.month}-01`, { month: 'short' })}</span>
    </button>`).join('')}</div>`;
}

/* ---------- stats ---------- */
function renderStats() {
  const { from, to } = period();
  const weekStart = mondayOf(today());
  $('stats').innerHTML = ui.members.map((m) => {
    const s = personStats(ui.drinks, m.user_id, from, to, today());
    const streak = dryStreak(ui.drinks, m.user_id, today());
    const week = personStats(ui.drinks, m.user_id, weekStart, addDays(weekStart, 6), today()).total;
    const goal = ui.goals.find((g) => g.user_id === m.user_id)?.weekly_shots;
    const insight = hangoverInsight(ui.drinks, ui.notes, m.user_id);
    const mine = m.user_id === ui.me;
    const pct = goal ? Math.min(100, (week / goal) * 100) : 0;
    const goalHtml = goal
      ? `<div class="goal ${week > goal ? 'over' : week > goal * 0.8 ? 'close' : ''}">
          <div class="goal-top"><span>This week</span><span>${round1(week)} / ${round1(Number(goal))} shots</span></div>
          <div class="goal-bar"><span style="width:${pct}%"></span></div>
          ${mine ? '<button class="link-btn" data-action="goal">change limit</button>' : ''}</div>`
      : mine ? '<button class="link-btn goal-set" data-action="goal">Set a weekly limit 🎯</button>' : '';
    return `<div class="card stat" style="--pc:${slotVar(m)}">
      <div class="stat-head">${esc(emojiOf(m))} ${esc(m.display_name)}</div>
      <div class="kpis">
        <div class="kpi"><div class="v">${s.nights}</div><div class="l">nights out</div></div>
        <div class="kpi"><div class="v">${s.dry}</div><div class="l">dry days</div></div>
        <div class="kpi"><div class="v">${round1(s.perNight)}</div><div class="l">shots / night</div></div>
        <div class="kpi"><div class="v">${streak}${streak >= 7 ? '🔥' : ''}</div><div class="l">dry streak</div></div>
      </div>
      <ul class="facts">
        ${s.biggest ? `<li>Biggest night: <b>${round1(s.biggest.shots)} shots</b> on ${fmt(s.biggest.day, { month: 'short', day: 'numeric' })}</li>` : ''}
        ${s.favourite ? `<li>Usual: ${KINDS[s.favourite].emoji} ${KINDS[s.favourite].label.toLowerCase()}</li>` : ''}
        ${insight ? `<li>Rough mornings start around <b>${round1(insight.threshold)} shots</b> (fine nights average ${round1(insight.easy)}) 🤕</li>` : ''}
      </ul>
      ${goalHtml}
    </div>`;
  }).join('');
}

async function setGoal() {
  const current = ui.goals.find((g) => g.user_id === ui.me)?.weekly_shots;
  const answer = prompt('Weekly limit, in shots (30 ml at 40%). Leave empty to remove it.', current ?? '');
  if (answer === null) return;
  const value = answer.trim() === '' ? null : Number(answer);
  if (value !== null && !(value > 0 && value <= 200)) { toast('Pick a number between 1 and 200'); return; }
  try { await api.saveGoal(value); } catch (e) { fail(e, 'save-goal'); return; }
  track('drink_goal_set', { has_goal: value !== null });
  toast(value ? `Limit set: ${value} shots a week 🎯` : 'Limit removed');
  await changed();
}

/* ---------- render ---------- */
function render() {
  renderPitchers();
  renderComposer();
  renderNight();
  renderCalendar();
  renderStats();
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function fail(e, where) {
  reportError(e, `drinks-${where}`);
  toast(e?.message || 'Something went wrong');
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const c = ui.compose;
  switch (el.dataset.action) {
    case 'night': case 'pick-night':
      ui.night = el.dataset.d;
      renderComposer();
      renderNight();
      renderCalendar();
      if (el.dataset.action === 'pick-night') $('night-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      break;
    case 'kind':
      Object.assign(c, { kind: el.dataset.k, ml: KINDS[el.dataset.k].size, abv: KINDS[el.dataset.k].abv });
      renderComposer();
      break;
    case 'size': c.ml = Number(el.dataset.ml); renderComposer(); break;
    case 'qty': c.qty = Math.min(MAX_QTY, Math.max(1, c.qty + Number(el.dataset.n))); renderComposer(); break;
    case 'add': await addDrink(el); break;
    case 'del':
      try { await api.deleteDrink(el.dataset.id); } catch (err) { fail(err, 'delete'); break; }
      track('drink_deleted');
      await changed();
      break;
    case 'hangover': await saveNote(Number(el.dataset.h)); break;
    case 'save-note': await saveNote(undefined); break;
    case 'goal': await setGoal(); break;
    case 'prev': case 'next': {
      const step = el.dataset.action === 'next' ? 1 : -1;
      ui.anchor = ui.view === 'year' ? `${Number(ui.anchor.slice(0, 4)) + step}-01-01` : addMonths(ui.anchor, step);
      await refresh();
      break;
    }
    case 'view': {
      ui.view = el.dataset.viewBtn;
      const year = ui.anchor.slice(0, 4);
      // Year view starts in January; back to month view lands on this month if it's this year.
      if (ui.view === 'year') ui.anchor = `${year}-01-01`;
      else ui.anchor = year === today().slice(0, 4) ? monthStart(today()) : `${year}-01-01`;
      await refresh();
      break;
    }
    case 'open-month': ui.view = 'month'; ui.anchor = el.dataset.m; await refresh(); break;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.matches('[data-night-pick]') && e.target.value) {
    ui.night = e.target.value > addDays(today(), 1) ? today() : e.target.value;
    renderComposer();
    renderNight();
    renderCalendar();
  }
  if (e.target.matches('[data-compose]')) {
    ui.compose[e.target.dataset.compose] = Number(e.target.value);
    renderComposer();
  }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.me) refresh(); });

/* ---------- boot ---------- */
function showGate(html) {
  $('gate').innerHTML = html;
  $('gate').hidden = false;
  $('drinks-view').hidden = true;
}

async function boot() {
  if (!isConfigured) { showGate('<div class="card center">Not configured.</div>'); return; }
  let user;
  try { user = await currentUser(); } catch (e) { reportError(e, 'drinks-session'); }
  if (!user) { location.replace(BASE); return; }
  ui.me = user.id;
  let space;
  try { space = await loadSpace(user); } catch (e) { fail(e, 'space'); return; }
  if (!space.couple) {
    showGate(`<div class="card center narrow"><h2>Drinks is for couples</h2>
      <p class="muted">Pair up with your partner in Wordle Duo first (room settings → “Make us a couple 💞”), then come back.</p>
      <a class="btn" href="${BASE}wordle-duo/">Go to Wordle Duo</a></div>`);
    return;
  }
  ui.members = space.couple.members;
  ui.roomId = space.couple.room.id;
  try { await load(); } catch (e) { fail(e, 'load'); return; }
  $('gate').hidden = true;
  $('drinks-view').hidden = false;
  render();
  ui.live = api.subscribe(ui.roomId, () => refresh());
}

boot();
