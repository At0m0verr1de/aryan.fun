// Date Jar page: the jar and its draw, writing slips, the up-next ticket, the piggy bank, and the clothesline of dates done.
import { isConfigured, currentUser } from '../../shared/supabase.js';
import { loadSpace, emojiOf } from '../../shared/space.js';
import { track, reportError } from '../../shared/telemetry.js';
import * as api from './api.js';
import {
  money, fairness, vetoesLeft, matches, rupees, costBand, shareOf, seeded, pictureOf,
  PLACES, LENGTHS, COST_PRESETS, STARTERS, CHEAP, MAX_IN_JAR,
} from './jar.js';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const SVG_NS = 'http://www.w3.org/2000/svg';
const MOUTH = { x: 150, y: 62 };   // jar mouth in SVG units
const PER_ROW = 7;
const ROW_GAP = 11;
const DAY_MS = 86400000;
const BULBS_PER_WIRE = 9;
const BULB_COLOURS = ['#ffd36e', '#ff9ec7', '#9ee7ff', '#c7a7ff', '#8ff0c4'];
const CONFETTI_COLOURS = ['#ff8fc4', '#ffd36e', '#7cc4ff', '#c7a7ff', '#8ff0c4'];
const SHAKE_FORCE = 22;            // m/s², including gravity
const SHAKE_PEAKS = 3;
const SHAKE_WINDOW_MS = 900;
const PLACEHOLDERS = ['Rooftop dinner somewhere fancy…', 'Learn a dance from YouTube together…', 'Cook breakfast in bed…',
  'Go-karting, loser does dishes for a week…', 'Picnic with only yellow food…', 'Sunrise at the beach…'];
const PEEK_LINES = ['No peeking 🙈', 'Shake the jar to find out 👀', "It's a secret 🤫", 'Patience, detective 🕵️'];

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const motionOK = typeof DeviceMotionEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  me: null, members: [], partner: null, roomId: null,
  slips: [], vetoes: [],
  mood: {},
  draft: { idea: '', place: 'out', length: 'evening', cost: 1500, payer: 'split' },
  busy: false, painted: false, live: null, shakeOn: false,
  fresh: new Set(),      // dates just marked done: their polaroid develops
  editing: null, rating: 0, closeReveal: null,
};

const memberOf = (id) => ui.members.find((m) => m.user_id === id);
const nameOf = (id) => (id === ui.me ? 'You' : esc(memberOf(id)?.display_name ?? 'Someone'));
const partnerName = () => esc(ui.partner?.display_name ?? 'your person');
const hueOf = (id) => (memberOf(id)?.slot === 2 ? 335 : 205);
const paperOf = (s) => `hsl(${hueOf(s.added_by)} 90% ${79 + Math.round(seeded(s.id, 9) * 7)}%)`;
const inJar = () => ui.slips.filter((s) => s.status === 'jar');
const drawnSlip = () => ui.slips.find((s) => s.status === 'drawn');
const payerId = (p) => (p === 'me' ? ui.me : p === 'partner' ? ui.partner?.user_id ?? null : null);
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const filtered = () => Boolean(ui.mood.place || ui.mood.length || ui.mood.max != null);

function ago(iso) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(Date.parse(iso))) / DAY_MS);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
function until(ts) {
  const days = Math.ceil((ts - Date.now()) / DAY_MS);
  return days <= 1 ? 'tomorrow' : `in ${days} days`;
}
function payerLabel(s) {
  if (s.payer == null) return '⚖️ split';
  return s.payer === ui.me ? 'you treat' : `${esc(memberOf(s.payer)?.display_name ?? 'they')} treats`;
}

/* ---------- data ---------- */
async function load() {
  const state = await api.loadJar();
  ui.slips = state.slips;
  ui.vetoes = state.vetoes;
}

// After a change by either of you. Plays your partner's draw before redrawing, so you see it happen too.
async function refresh() {
  const before = new Map(ui.slips.map((s) => [s.id, s.status]));
  try { await load(); } catch (e) { fail(e, 'load'); return; }
  const drawn = drawnSlip();
  if (drawn && before.get(drawn.id) === 'jar' && drawn.drawn_by !== ui.me && !ui.busy) {
    ui.busy = true;
    await openAndShake();
    await flyOut(drawn.id);
    await reveal(drawn, drawn.drawn_by);
    ui.busy = false;
  }
  for (const s of ui.slips) if (s.status === 'done' && before.has(s.id) && before.get(s.id) !== 'done') ui.fresh.add(s.id);
  render();
}

function changed() {
  ui.live?.ping();
  return refresh();
}

/* ---------- the jar ---------- */
// Where slip i sits in the pile: rows of 7, alternate rows offset like bricks, narrower near the shoulders.
function spot(i, id) {
  const row = Math.floor(i / PER_ROW);
  let x = 64 + (i % PER_ROW) * 28 + (row % 2 ? 12 : 0) + (seeded(id, 1) - 0.5) * 10;
  if (row >= 13) x = 150 + (x - 150) * 0.7;
  const y = 334 - row * ROW_GAP + (seeded(id, 2) - 0.5) * 6;
  return { x: Math.min(240, Math.max(60, x)), y, r: (seeded(id, 3) - 0.5) * 56 };
}
const transformAt = (p) => `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${p.r.toFixed(1)}deg)`;

function slipNode(s) {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'slip');
  g.dataset.id = s.id;
  g.innerHTML = `<g class="slip-in" style="--d:${(seeded(s.id, 4) * 0.2).toFixed(2)}s;--j:${(-5 - seeded(s.id, 5) * 9).toFixed(1)}px">
    <rect x="-15" y="-7" width="30" height="14" rx="2.5" fill="${paperOf(s)}"/>
    <path d="M8 -7 L15 -7 L15 0 Z" fill="rgba(0,0,0,.13)"/><path d="M-10 0 H5" stroke="rgba(0,0,0,.14)" stroke-width="1.2"/></g>`;
  return g;
}

// Keyed by slip id: existing slips glide to their new spot (the pile settles), new ones drop in through the mouth.
function renderPile() {
  const layer = $('slips');
  const slips = inJar();
  const keep = new Set(slips.map((s) => s.id));
  layer.querySelectorAll('.slip').forEach((g) => { if (!keep.has(g.dataset.id)) g.remove(); });
  slips.forEach((s, i) => {
    const to = transformAt(spot(i, s.id));
    let g = layer.querySelector(`[data-id="${s.id}"]`);
    if (g) { g.style.transform = to; return; }
    g = slipNode(s);
    g.style.transform = to;
    layer.appendChild(g);
    if (ui.painted && !reduce) {
      g.animate([
        { transform: `translate(${MOUTH.x}px, ${MOUTH.y - 70}px) rotate(40deg)`, opacity: 0 },
        { transform: `translate(${MOUTH.x}px, ${MOUTH.y}px) rotate(10deg)`, opacity: 1, offset: 0.25 },
        { transform: to },
      ], { duration: 1050, easing: 'cubic-bezier(.25,.9,.35,1.15)' });
    }
  });
  $('tag-count').textContent = slips.length;
  $('tag-label').textContent = slips.length === 1 ? 'date' : 'dates';
  $('jar-svg').classList.toggle('empty', !slips.length);
  ui.painted = true;
}

function hangLights() {
  document.querySelectorAll('#lights .wire').forEach((wire, w) => {
    const len = wire.getTotalLength();
    for (let i = 0; i < BULBS_PER_WIRE; i++) {
      const p = wire.getPointAtLength((len * (i + 0.5)) / BULBS_PER_WIRE);
      wire.parentNode.insertAdjacentHTML('beforeend', `<circle class="bulb" cx="${p.x.toFixed(1)}" cy="${(p.y + 3).toFixed(1)}" r="3.6"
        fill="${BULB_COLOURS[(i + w * 2) % BULB_COLOURS.length]}" style="animation-delay:${(-(i * 0.37 + w * 0.9)).toFixed(2)}s"/>`);
    }
  });
}

function restart(el, cls) {
  el.classList.remove(cls);
  void el.getBoundingClientRect();
  el.classList.add(cls);
}

async function openAndShake() {
  $('stage').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  $('jar-svg').classList.add('open');
  await wait(320);
  navigator.vibrate?.([40, 30, 40, 30, 60]);
  restart($('jar-body'), 'shaking');
  await wait(870);
}

const closeLid = () => $('jar-svg').classList.remove('open');

// The chosen slip leaves the pile, rises out of the mouth and grows away.
async function flyOut(id) {
  const g = $('slips').querySelector(`[data-id="${id}"]`);
  if (!g) return;
  const from = g.style.transform;
  $('flying').appendChild(g);
  if (!reduce) {
    await g.animate([
      { transform: from },
      { transform: `translate(${MOUTH.x}px, ${MOUTH.y + 12}px) rotate(0deg) scale(1.2)`, offset: 0.55 },
      { transform: `translate(${MOUTH.x}px, ${MOUTH.y - 70}px) rotate(-15deg) scale(2.6)`, opacity: 0 },
    ], { duration: 760, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' }).finished;
  }
  g.remove();
}

function nudge(text) {
  restart($('jar-body'), 'nudge');
  toast(text);
}

async function drawNow(how) {
  if (ui.busy) return;
  if (drawnSlip()) { nudge('Do the date up next first, or veto it 👇'); return; }
  if (!inJar().length) { nudge('The jar is empty. Write a slip ✍️'); return; }
  if (!inJar().some((s) => matches(s, ui.mood))) { nudge('Nothing in the jar fits that mood'); return; }
  ui.busy = true;
  renderMood();
  try {
    const picked = api.draw(ui.mood);
    await openAndShake();
    const slip = await picked;
    track('jar_drawn', { how, filtered: filtered(), in_jar: inJar().length });
    ui.live?.ping();
    await flyOut(slip.id);
    await reveal(slip, ui.me);
    await load();
    render({ arrived: true });
  } catch (e) {
    closeLid();
    fail(e, 'draw');
  } finally {
    ui.busy = false;
    renderMood();
  }
}

/* ---------- tickets and the reveal ---------- */
function splitHTML(s) {
  const parts = ui.members.map((m) => ({ m, share: shareOf(s, m.user_id) })).filter((p) => p.share > 0);
  if (!parts.length) return '<div class="split free"><span>Free! 🎉</span></div>';
  return `<div class="split">${parts.map(({ m, share }) => `<span style="--share:${Math.max(1, Math.round(share))};--hue:${hueOf(m.user_id)}">
    ${emojiOf(m)} ${m.user_id === ui.me ? 'you' : esc(m.display_name)} ${rupees(share)}</span>`).join('')}</div>`;
}

function ticketHTML(s, { stamp = '', creased = false } = {}) {
  const no = String(ui.slips.filter((x) => x.status === 'done').length + 1).padStart(3, '0');
  const writer = memberOf(s.added_by);
  return `<div class="ticket-wrap"><article class="ticket ${creased ? 'creased' : ''}" style="--slip:${paperOf(s)}">
    <div class="stub"><span class="stub-pic">${pictureOf(s.idea, s.place)}</span><span>admit</span><b>two</b><small>No. ${no}</small></div>
    <div class="t-main">
      <p class="t-from">${writer ? emojiOf(writer) : '💌'} written by ${nameOf(s.added_by)}</p>
      <h3 class="t-idea">${esc(s.idea)}</h3>
      <div class="t-tags"><span>${PLACES[s.place].emoji} ${PLACES[s.place].label}</span><span>${LENGTHS[s.length].emoji} ${LENGTHS[s.length].label}</span>
        <span>${s.cost ? rupees(s.cost) : 'Free'}</span></div>
      ${splitHTML(s)}
    </div>
    ${stamp ? `<span class="t-stamp">${stamp}</span>` : ''}
  </article></div>`;
}

function vetoButton(s, action) {
  const v = vetoesLeft(ui.vetoes, ui.me);
  return `<button class="btn ghost" data-action="${action}" data-id="${s.id}" ${v.left ? '' : 'disabled'}>Veto 🙅
    <small>${v.left ? `${v.left} left this week` : `back ${until(v.backAt)}`}</small></button>`;
}

// Resolves when the ticket is closed, so callers can wait for it.
function reveal(slip, by) {
  return new Promise((resolve) => {
    const box = $('reveal');
    $('reveal-eyebrow').textContent = by === ui.me ? 'The jar says…' : `${memberOf(by)?.display_name ?? 'Your person'} drew…`;
    $('reveal-ticket').innerHTML = ticketHTML(slip, { creased: true });
    $('reveal-actions').innerHTML = `<button class="btn" data-action="reveal-keep" style="--pc:var(--heart);color:#fff">It's a date 💌</button>${vetoButton(slip, 'reveal-veto')}`;
    box.hidden = false;
    restart(box, 'show');
    confetti();
    setTimeout(closeLid, reduce ? 0 : 900);
    ui.closeReveal = () => {
      ui.closeReveal = null;
      box.classList.remove('show');
      setTimeout(() => { box.hidden = true; resolve(); }, reduce ? 0 : 320);
    };
  });
}

function confetti(n = 30) {
  if (reduce) return;
  const box = $('confetti');
  for (let i = 0; i < n; i++) {
    const bit = document.createElement('span');
    const heart = i % 4 === 0;
    bit.className = heart ? 'bit heart' : 'bit';
    if (heart) bit.textContent = '♥';
    bit.style.cssText = `--x:${(Math.random() * 100).toFixed(1)}vw;--dx:${Math.round((Math.random() - 0.5) * 140)}px;--r:${Math.round(Math.random() * 720 - 360)}deg;`
      + `--t:${(1.6 + Math.random() * 1.4).toFixed(2)}s;--c:${CONFETTI_COLOURS[i % CONFETTI_COLOURS.length]};animation-delay:${(Math.random() * 0.3).toFixed(2)}s`;
    bit.addEventListener('animationend', () => bit.remove());
    box.appendChild(bit);
  }
}

/* ---------- render ---------- */
function renderHead() {
  const n = inJar().length;
  const secret = inJar().filter((s) => s.added_by !== ui.me).length;
  $('dj-sub').textContent = n
    ? `${n} date${n === 1 ? '' : 's'} folded inside${secret ? ` · ${secret} of them ${ui.partner?.display_name ?? 'your person'}'s secret${secret === 1 ? '' : 's'} 🤫` : ''}`
    : 'An empty jar, waiting for ideas.';
  $('stage-hint').textContent = drawnSlip() ? 'Do the date up next first, or veto it 👇'
    : n ? 'Tap the jar to shake out a date' : 'Write a slip below to fill it ✍️';
}

function renderMood() {
  const m = ui.mood;
  const n = inJar().filter((s) => matches(s, m)).length;
  const chip = (key, value, text) => `<button class="mood-chip ${m[key] === value ? 'on' : ''}" data-action="mood" data-k="${key}" data-v="${value}">${text}</button>`;
  const why = drawnSlip() ? 'finish the date up next first' : n ? `${n} slip${n === 1 ? '' : 's'} could fall out`
    : inJar().length ? 'nothing fits that mood' : 'the jar is empty';
  $('mood').innerHTML = `<div class="mood-chips" ${drawnSlip() ? 'hidden' : ''}>
      <button class="mood-chip ${filtered() ? '' : 'on'}" data-action="mood-any">✨ Anything</button>
      ${chip('place', 'in', '🛋️ Stay in')}${chip('place', 'out', '🌆 Go out')}
      ${chip('length', 'quick', '⏱️ Quick')}${chip('length', 'evening', '🌙 Evening')}${chip('length', 'day', '☀️ Whole day')}
      <button class="mood-chip ${m.max === CHEAP ? 'on' : ''}" data-action="mood-cheap">💸 Under ${rupees(CHEAP)}</button>
    </div>
    <div class="shake-row">
      <button class="shake-btn" data-action="shake" ${ui.busy || drawnSlip() || !n ? 'disabled' : ''}><span><span class="shake-ico">🫨</span> Shake the jar</span><small>${why}</small></button>
      ${motionOK ? `<button class="phone-shake ${ui.shakeOn ? 'on' : ''}" data-action="phone-shake">📳 ${ui.shakeOn ? 'Shake your phone!' : 'Use phone shake'}</button>` : ''}
    </div>`;
}

function renderUpNext(arrived) {
  const s = drawnSlip();
  const box = $('upnext');
  box.hidden = !s;
  box.classList.remove('arrived');
  if (!s) return;
  box.innerHTML = `<div class="upnext-head"><h2>Up next 💌</h2><span class="muted">drawn by ${nameOf(s.drawn_by).toLowerCase() === 'you' ? 'you' : nameOf(s.drawn_by)} ${ago(s.drawn_at)}</span></div>
    ${ticketHTML(s, { stamp: 'Up next' })}
    <div class="upnext-actions">
      <button class="btn" data-action="did-it" data-id="${s.id}" style="--pc:var(--mint)">We did it ✓</button>
      ${vetoButton(s, 'veto')}
    </div>`;
  if (arrived) restart(box, 'arrived');
}

function renderWriter() {
  const me = memberOf(ui.me);
  const p = ui.partner;
  const chips = (key, entries) => entries.map(([value, text]) => `<button type="button" class="chip" data-action="draft" data-k="${key}" data-v="${value}">${text}</button>`).join('');
  $('writer').innerHTML = `<h2>Write a slip ✍️</h2>
    <form id="slip-form" autocomplete="off">
      <div class="paper" id="paper"><textarea name="idea" maxlength="120" rows="3" required aria-label="Date idea"
        placeholder="${esc(PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)])}"></textarea><span class="paper-count" id="paper-count">0/120</span></div>
      <div class="opts">
        <div class="opt"><span class="opt-label">Where</span><div class="chips">${chips('place', Object.entries(PLACES).map(([k, v]) => [k, `${v.emoji} ${v.label}`]))}</div></div>
        <div class="opt"><span class="opt-label">How long</span><div class="chips">${chips('length', Object.entries(LENGTHS).map(([k, v]) => [k, `${v.emoji} ${v.label}`]))}</div></div>
        <div class="opt"><span class="opt-label">Roughly costs, all in</span><div class="chips">${chips('cost', COST_PRESETS.map((c) => [c, c ? rupees(c) : 'Free']))}
          <label class="cost-field">₹<input type="number" name="cost" min="0" max="1000000" step="50" inputmode="numeric" aria-label="Cost in rupees"></label></div></div>
        <div class="opt"><span class="opt-label">Who pays</span><div class="chips">${chips('payer', [['split', '⚖️ Split it'], ['me', `${me ? emojiOf(me) : ''} I'll treat`],
          ...(p ? [['partner', `${emojiOf(p)} ${esc(p.display_name)} treats`]] : [])])}</div></div>
      </div>
      <p class="share-preview" id="share-preview"></p>
      <button class="btn fold-btn" type="submit">Fold it &amp; drop it in 💌</button>
    </form>
    <div class="starters" id="starters"></div>`;
  updateWriter();
}

// Updates the writer in place, so typing never loses focus.
function updateWriter() {
  const d = ui.draft;
  document.querySelectorAll('#slip-form [data-action="draft"]').forEach((b) => b.classList.toggle('on', String(d[b.dataset.k]) === b.dataset.v));
  const input = document.querySelector('#slip-form [name="cost"]');
  if (document.activeElement !== input) input.value = d.cost;
  const fake = { status: 'jar', cost: d.cost, payer: payerId(d.payer) };
  $('share-preview').innerHTML = d.cost
    ? `If it falls out: ${ui.members.map((m) => `${emojiOf(m)} ${m.user_id === ui.me ? 'you' : esc(m.display_name)} <b>${rupees(shareOf(fake, m.user_id))}</b>`).join(' · ')}`
    : 'A free date 🎉';
  $('paper-count').textContent = `${d.idea.length}/120`;
  renderStarters();
}

function renderStarters() {
  const mine = new Set(ui.slips.filter((s) => s.added_by === ui.me).map((s) => s.idea));
  const offer = STARTERS.filter((s) => !mine.has(s.idea)).slice(0, inJar().length ? 4 : 8);
  $('starters').innerHTML = offer.length
    ? `<p>${inJar().length ? 'Stuck? Borrow one:' : 'Need ideas? Tap one to start:'}</p>${offer.map((s) => `<button class="starter" data-action="starter" data-idea="${esc(s.idea)}">＋ ${esc(s.idea)}</button>`).join('')}`
    : '';
}

function coinStack(value, max) {
  const n = value > 0 ? Math.max(1, Math.round((value / max) * 12)) : 0;
  let coins = '';
  for (let i = 0; i < n; i++) {
    const y = 104 - i * 7;
    const x = 43 + (seeded(`coin${i}`, Math.round(value)) - 0.5) * 6;
    coins += `<g class="coin" style="animation-delay:${i * 45}ms"><rect x="${(x - 24).toFixed(1)}" y="${y}" width="48" height="6" rx="2" fill="#c8902f"/>
      <ellipse cx="${x.toFixed(1)}" cy="${y}" rx="24" ry="6.5" fill="#ffd36e" stroke="#e2a63c" stroke-width="1.2"/>
      ${i === n - 1 ? `<text class="coin-mark" x="${x.toFixed(1)}" y="${y + 3}" text-anchor="middle">₹</text>` : ''}</g>`;
  }
  return `<svg class="coins" viewBox="0 0 86 118" aria-hidden="true"><ellipse cx="43" cy="112" rx="30" ry="5" fill="rgba(0,0,0,.28)"/>
    ${coins || '<text x="43" y="100" text-anchor="middle" font-size="24">🪹</text>'}</svg>`;
}

function renderBank() {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const rows = money(ui.slips, ui.members, monthStart.toISOString());
  const max = Math.max(1, ...rows.map((r) => r.jar));
  const who = (r) => memberOf(r.userId);
  const line = (label, key, show = true) => (show ? `<div class="bank-row"><dt>${label}</dt>${rows.map((r) => `<dd>${rupees(r[key])}</dd>`).join('')}</div>` : '');
  $('bank').innerHTML = `<h2>The piggy bank 🐷</h2>
    <p class="muted bank-sub">What the jar would cost each of you, by who pays for each slip.</p>
    <div class="bank-people">${rows.map((r) => `<div class="bank-col">
      <div class="bank-who">${emojiOf(who(r))} ${r.userId === ui.me ? 'You' : esc(who(r).display_name)}</div>
      ${coinStack(r.jar, max)}
      <div class="bank-big">${rupees(r.jar)}</div><div class="bank-small">if you did every slip</div></div>`).join('')}</div>
    <dl class="bank-rows">
      <div class="bank-row head"><dt></dt>${rows.map((r) => `<dd>${emojiOf(who(r))}</dd>`).join('')}</div>
      ${line('Next shake, on average', 'nextDraw')}
      ${line('The date up next', 'upNext', Boolean(drawnSlip()))}
      ${line('Dates this month', 'month')}
      ${line('Every date so far', 'ever')}
    </dl>
    <p class="fair">${fairness(rows, (id) => (id === ui.me ? 'You' : memberOf(id)?.display_name ?? 'Someone')) || 'Nothing to split yet 🪙'}</p>`;
}

function renderInside() {
  const mine = inJar().filter((s) => s.added_by === ui.me);
  const theirs = inJar().filter((s) => s.added_by !== ui.me);
  const tilt = (s) => ((seeded(s.id, 6) - 0.5) * 3).toFixed(1);
  $('inside').innerHTML = `<h2>What's inside 🫙</h2><div class="inside-cols">
    <div><h3>Your slips <span class="count">${mine.length}</span></h3>
      ${mine.length ? `<ul class="my-slips">${mine.map((s) => `<li class="mini-slip" style="--slip:${paperOf(s)};--r:${tilt(s)}deg">
        <span class="ms-idea">${esc(s.idea)}</span>
        <span class="ms-meta">${PLACES[s.place].emoji} ${LENGTHS[s.length].emoji} · ${s.cost ? rupees(s.cost) : 'Free'} · ${payerLabel(s)}</span>
        <button class="ms-x" data-action="remove" data-id="${s.id}" aria-label="Take it out of the jar">×</button></li>`).join('')}</ul>`
        : '<p class="muted">Nothing from you yet. Write one ✍️</p>'}</div>
    <div><h3>${partnerName()}'s secrets <span class="count">${theirs.length}</span></h3>
      ${theirs.length ? `<div class="secrets">${theirs.map((s) => `<button class="secret" style="--slip:${paperOf(s)};--r:${((seeded(s.id, 3) - 0.5) * 14).toFixed(1)}deg"
        data-action="peek" aria-label="A folded slip"><span>?</span><small>${PLACES[s.place].emoji} ${costBand(s.cost)}</small></button>`).join('')}</div>
        <p class="muted small">Folded until the jar picks one. You can see roughly what it costs, nothing else.</p>`
        : `<p class="muted">${ui.partner ? `${partnerName()} hasn't hidden anything yet 👀` : "Your person hasn't joined yet."}</p>`}</div>
  </div>`;
}

function polaroid(s, i) {
  const hearts = s.rating ? '❤️'.repeat(s.rating) + '🤍'.repeat(5 - s.rating) : '';
  return `<button class="polaroid ${ui.fresh.has(s.id) ? 'develop' : ''}" style="--hue:${hueOf(s.added_by)};--r:${i % 2 ? 3 : -3}deg;--d:${-(i % 3) * 1.3}s"
      data-action="memory" data-id="${s.id}" aria-label="Memory: ${esc(s.idea)}">
    <span class="pin"></span>
    <span class="photo"><span class="photo-pic">${pictureOf(s.idea, s.place)}</span><span class="photo-hearts">${hearts}</span></span>
    <span class="caption">${esc(s.idea)}</span>
    <span class="pol-meta">${fmtDate(s.done_at)} · ${rupees(s.spent ?? s.cost)}</span>
    ${s.memory ? `<span class="pol-memory">“${esc(s.memory)}”</span>` : '<span class="pol-memory add">+ add a memory</span>'}
  </button>`;
}

function renderMemories() {
  const done = ui.slips.filter((s) => s.status === 'done').sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));
  const total = done.reduce((n, s) => n + (s.spent ?? s.cost), 0);
  $('memories').innerHTML = `<div class="mem-head"><h2>Our dates 📸</h2>
      <span class="muted">${done.length ? `${done.length} done · ${rupees(total)} spent together` : ''}</span></div>
    <div class="clothesline"><div class="line-track">${done.length ? done.map(polaroid).join('')
      : '<p class="muted line-empty">Your first polaroid will hang here 🧷</p>'}</div></div>`;
}

function render({ arrived = false } = {}) {
  renderHead();
  renderPile();
  renderMood();
  renderUpNext(arrived);
  renderBank();
  renderInside();
  renderMemories();
  renderStarters();
}

/* ---------- writing ---------- */
function mouthOnScreen() {
  const svg = $('jar-svg');
  const pt = svg.createSVGPoint();
  pt.x = MOUTH.x;
  pt.y = MOUTH.y;
  return pt.matrixTransform(svg.getScreenCTM());
}

// The paper folds into a strip and flies into the jar's mouth.
async function foldAway() {
  if (reduce) return;
  const paper = $('paper');
  const r = paper.getBoundingClientRect();
  const clone = paper.cloneNode(true);
  clone.removeAttribute('id');
  clone.classList.add('paper-fly');
  clone.querySelector('textarea').value = paper.querySelector('textarea').value;
  Object.assign(clone.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', zIndex: '30' });
  document.body.appendChild(clone);
  $('stage').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('jar-svg').classList.add('open');
  await wait(480);
  const m = mouthOnScreen();
  const dx = m.x - (r.left + r.width / 2);
  const dy = m.y - (r.top + r.height / 2);
  await clone.animate([
    { transform: 'translate(0px, 0px) scale(1, 1) rotate(-1deg)' },
    { transform: 'translate(0px, 0px) scale(1, .14) rotate(0deg)', offset: 0.3 },
    { transform: `translate(${dx * 0.3}px, ${dy * 0.3}px) scale(.35, .1) rotate(-8deg)`, offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(.08, .04) rotate(-30deg)`, opacity: 0.4 },
  ], { duration: 1000, easing: 'cubic-bezier(.5,0,.3,1)' }).finished;
  clone.remove();
}

async function addSlip(form) {
  const d = ui.draft;
  const idea = d.idea.trim();
  if (!idea || ui.busy) return;
  if (inJar().length >= MAX_IN_JAR) { toast('The jar is full! Do some dates first 😅'); return; }
  ui.busy = true;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await Promise.all([api.addSlip({ idea, cost: d.cost, payer: payerId(d.payer), place: d.place, length: d.length }), foldAway()]);
    track('jar_idea_added', { place: d.place, length: d.length, cost_band: costBand(d.cost), payer: d.payer });
    d.idea = '';
    form.reset();
    updateWriter();
    ui.live?.ping();
    await load();
    render();
    await wait(800);
    toast('Folded and dropped in 💌');
  } catch (e) {
    fail(e, 'add');
  } finally {
    closeLid();
    button.disabled = false;
    ui.busy = false;
    renderMood();
  }
}

/* ---------- memories ---------- */
function paintHearts() {
  document.querySelectorAll('#memory-dialog [data-action="rate"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) <= ui.rating));
}

function memorySplit() {
  const s = ui.editing;
  const spent = Number(document.querySelector('#memory-form [name="spent"]').value) || 0;
  const fake = { ...s, status: 'done', spent };
  document.querySelector('[data-mem-split]').innerHTML = spent
    ? ui.members.map((m) => `${emojiOf(m)} ${m.user_id === ui.me ? 'you' : esc(m.display_name)} <b>${rupees(shareOf(fake, m.user_id))}</b>`).join(' · ')
    : 'Free 🎉';
}

function openMemory(id) {
  const s = ui.slips.find((x) => x.id === id);
  if (!s) return;
  ui.editing = s;
  ui.rating = s.rating ?? 0;
  const dialog = $('memory-dialog');
  dialog.querySelector('[data-mem-title]').textContent = s.status === 'done' ? 'Edit the memory 💭' : 'How was it? 💭';
  dialog.querySelector('[data-mem-idea]').textContent = s.idea;
  dialog.querySelector('[name="spent"]').value = s.spent ?? s.cost;
  dialog.querySelector('[name="memory"]').value = s.memory ?? '';
  paintHearts();
  memorySplit();
  dialog.showModal();
}

async function saveMemory() {
  const s = ui.editing;
  const form = $('memory-form');
  const spent = Math.max(0, Math.round(Number(form.spent.value) || 0));
  const memory = form.memory.value.trim();
  const first = s.status !== 'done';
  try {
    await api.done(s.id, spent, ui.rating || null, memory);
  } catch (e) { fail(e, 'memory'); return; }
  $('memory-dialog').close();
  if (first) {
    ui.fresh.add(s.id);
    track('jar_date_done', { rating: ui.rating || 0, has_memory: Boolean(memory) });
    confetti(40);
  }
  await changed();
  if (first) $('memories').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
}

/* ---------- phone shake ---------- */
let peaks = [];
function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  if (Math.hypot(a.x || 0, a.y || 0, a.z || 0) < SHAKE_FORCE) return;
  const now = Date.now();
  peaks = peaks.filter((t) => now - t < SHAKE_WINDOW_MS);
  if (peaks.length && now - peaks[peaks.length - 1] < 120) return;
  peaks.push(now);
  if (peaks.length >= SHAKE_PEAKS) {
    peaks = [];
    drawNow('phone');
  }
}

async function togglePhoneShake() {
  if (ui.shakeOn) {
    ui.shakeOn = false;
    window.removeEventListener('devicemotion', onMotion);
    renderMood();
    return;
  }
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function' && (await DeviceMotionEvent.requestPermission()) !== 'granted') throw new Error('denied');
  } catch {
    toast('Motion access was blocked');
    return;
  }
  ui.shakeOn = true;
  window.addEventListener('devicemotion', onMotion);
  track('jar_phone_shake_on');
  renderMood();
  toast('Now shake your phone 📳');
}

/* ---------- small bits ---------- */
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function fail(e, where) {
  reportError(e, `jar-${where}`);
  toast(e?.message || 'Something went wrong');
}

/* ---------- events ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const d = ui.draft;
  switch (el.dataset.action) {
    case 'shake': await drawNow('button'); break;
    case 'mood': {
      const { k, v } = el.dataset;
      ui.mood[k] = ui.mood[k] === v ? null : v;
      renderMood();
      break;
    }
    case 'mood-any': ui.mood = {}; renderMood(); break;
    case 'mood-cheap': ui.mood.max = ui.mood.max === CHEAP ? null : CHEAP; renderMood(); break;
    case 'phone-shake': await togglePhoneShake(); break;
    case 'draft':
      d[el.dataset.k] = el.dataset.k === 'cost' ? Number(el.dataset.v) : el.dataset.v;
      updateWriter();
      break;
    case 'starter': {
      const s = STARTERS.find((x) => x.idea === el.dataset.idea);
      Object.assign(d, { idea: s.idea, cost: s.cost, place: s.place, length: s.length });
      const area = document.querySelector('#slip-form textarea');
      area.value = s.idea;
      updateWriter();
      area.focus();
      break;
    }
    case 'remove': {
      const s = ui.slips.find((x) => x.id === el.dataset.id);
      if (!s || !confirm(`Take “${s.idea}” out of the jar?`)) break;
      try { await api.removeSlip(s.id); } catch (err) { fail(err, 'remove'); break; }
      track('jar_idea_removed');
      await changed();
      break;
    }
    case 'peek':
      restart(el, 'wiggle');
      toast(PEEK_LINES[Math.floor(Math.random() * PEEK_LINES.length)]);
      break;
    case 'reveal-keep': ui.closeReveal?.(); break;
    case 'reveal-veto': case 'veto': {
      try { await api.veto(el.dataset.id); } catch (err) { fail(err, 'veto'); break; }
      track('jar_vetoed', { where: el.dataset.action });
      if (el.dataset.action === 'reveal-veto') ui.closeReveal?.();
      toast('Back in the jar it goes 🫙');
      await changed();
      break;
    }
    case 'did-it': openMemory(el.dataset.id); break;
    case 'memory': openMemory(el.dataset.id); break;
    case 'rate': {
      const n = Number(el.dataset.n);
      ui.rating = ui.rating === n ? 0 : n;
      paintHearts();
      break;
    }
    case 'mem-cancel': $('memory-dialog').close(); break;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.matches('#slip-form textarea')) {
    ui.draft.idea = e.target.value;
    $('paper-count').textContent = `${e.target.value.length}/120`;
  }
  if (e.target.matches('#slip-form [name="cost"]')) {
    ui.draft.cost = Math.max(0, Math.round(Number(e.target.value) || 0));
    updateWriter();
  }
  if (e.target.matches('#memory-form [name="spent"]')) memorySplit();
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'slip-form') { e.preventDefault(); addSlip(e.target); }
  if (e.target.id === 'memory-form') { e.preventDefault(); saveMemory(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ui.closeReveal) ui.closeReveal();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'jar-svg') { e.preventDefault(); drawNow('tap'); }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden && ui.me && !ui.busy) refresh(); });

/* ---------- boot ---------- */
function showGate(html) {
  $('gate').innerHTML = html;
  $('gate').hidden = false;
  $('jar-view').hidden = true;
}

async function boot() {
  if (!isConfigured) { showGate('<div class="card center">Not configured.</div>'); return; }
  let user;
  try { user = await currentUser(); } catch (e) { reportError(e, 'jar-session'); }
  if (!user) { location.replace(BASE); return; }
  ui.me = user.id;
  let space;
  try { space = await loadSpace(user); } catch (e) { fail(e, 'space'); return; }
  if (!space.couple) {
    showGate(`<div class="card center narrow"><span class="gate-jar" aria-hidden="true">🫙</span><h2>The Date Jar is for couples</h2>
      <p class="muted">Pair up with your partner in Wordle first (room settings → “Make us a couple 💞”), then come back.</p>
      <a class="btn" href="${BASE}wordle-duo/">Go to Wordle</a></div>`);
    return;
  }
  ui.members = space.couple.members;
  ui.partner = space.couple.partner;
  ui.roomId = space.couple.room.id;
  try { await load(); } catch (e) { fail(e, 'load'); return; }
  $('gate').hidden = true;
  $('jar-view').hidden = false;
  hangLights();
  renderWriter();
  render();
  $('jar-svg').addEventListener('click', () => drawNow('tap'));
  ui.live = api.subscribe(ui.roomId, () => { if (!ui.busy) refresh(); });
}

boot();
