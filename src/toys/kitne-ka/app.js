// Kitne Ka? page: one card at a time, a rupee guess (typed or slid), the reveal with a closeness meter, then the
// day's scorecard against your partner and this month's tally.
import { isConfigured, currentUser } from '../../shared/supabase.js';
import { loadSpace, emojiOf } from '../../shared/space.js';
import { track, reportError } from '../../shared/telemetry.js';
import * as api from './api.js';
import { inr, inWords, parseGuess, verdict, meterPos, standings, MAX_GUESS } from './price.js';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const SLIDER_STEPS = 1000;
const SLIDER_MAX_LOG = Math.log10(MAX_GUESS / 10); // slider tops out at ₹1,000 crore; type for more
const CATEGORY = {
  groceries: 'Groceries', snacks: 'Snacks', 'street-food': 'Street food', 'eating-out': 'Eating out', gadgets: 'Gadgets',
  fashion: 'Fashion', beauty: 'Beauty', home: 'Home', vehicles: 'Vehicles', travel: 'Travel', subscriptions: 'Subscriptions',
  experiences: 'Experiences', luxury: 'Luxury', weird: 'Wildcard',
};
const CARD_HUES = [38, 330, 200, 150, 270];

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = { me: null, partner: null, members: [], roomId: null, state: null, view: null, busy: false, live: null, revealed: null };

const memberOf = (id) => ui.members.find((m) => m.user_id === id);
const partnerName = () => esc(ui.partner?.display_name ?? 'your person');
const items = () => ui.state?.items ?? [];
const nextSlot = () => items().find((i) => i.guess == null)?.slot ?? null;
const total = (key) => items().reduce((s, i) => s + (i[key] ?? 0), 0);

function toast(text) {
  const el = $('kk-toast');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 3000);
}

/* ---------- progress ---------- */
function renderDots() {
  $('kk-dots').innerHTML = items().map((i) => {
    const cls = i.guess != null ? (i.points >= 85 ? 'hot' : i.points >= 40 ? 'warm' : 'cold') : '';
    const on = ui.view === i.slot ? 'on' : '';
    return `<button class="dot ${cls} ${on}" data-slot="${i.slot}" ${i.guess == null && i.slot !== nextSlot() ? 'disabled' : ''}
      aria-label="Item ${i.slot + 1}">${i.guess != null ? i.points : i.slot + 1}</button>`;
  }).join('') + `<button class="dot total ${ui.view === 'summary' ? 'on' : ''}" data-slot="summary" ${nextSlot() != null ? 'disabled' : ''} aria-label="Scorecard">🏁</button>`;
}

/* ---------- the card ---------- */
function cardFace(i) {
  return `<div class="face" style="--hue:${CARD_HUES[i.slot]}">
      <span class="cat">${esc(CATEGORY[i.category] ?? i.category)}</span>
      <span class="big-emoji" aria-hidden="true">${esc(i.emoji)}</span>
      <span class="sticker" aria-hidden="true">₹ ?</span>
    </div>
    <div class="what"><h2>${esc(i.name)}</h2>${i.detail ? `<p class="muted">${esc(i.detail)}</p>` : ''}</div>`;
}

function renderGuess(i) {
  const partner = i.partner_played ? `<p class="partner-note">${esc(emojiOf(ui.partner))} ${partnerName()} has locked in a guess</p>` : '';
  $('kk-stage').innerHTML = `<article class="card item-card enter">
    ${cardFace(i)}
    <form class="guess" id="guess-form" autocomplete="off">
      <label class="rupee-field"><span aria-hidden="true">₹</span>
        <input id="guess-input" inputmode="decimal" enterkeyhint="done" placeholder="e.g. 499, 12k, 1.5L, 2cr" aria-label="Your guess in rupees" /></label>
      <p class="hint" id="guess-hint">Type a price, or slide</p>
      <input type="range" id="guess-slider" min="0" max="${SLIDER_STEPS}" value="${SLIDER_STEPS * 0.35}" aria-label="Slide to guess" />
      <div class="slider-scale" aria-hidden="true"><span>₹1</span><span>₹1K</span><span>₹1L</span><span>₹1Cr</span><span>₹1000Cr</span></div>
      <button class="btn lock" type="submit" disabled style="--pc:var(--gold)">Lock it in 🔒</button>
    </form>
    ${partner}
  </article>`;
  const input = $('guess-input');
  if (matchMedia('(pointer: fine)').matches) input.focus();
}

const sliderToRupees = (v) => {
  const n = 10 ** ((v / SLIDER_STEPS) * SLIDER_MAX_LOG);
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);   // two significant figures
  return Math.max(1, Math.round(n / mag) * mag);
};
const rupeesToSlider = (n) => Math.round((Math.log10(Math.max(1, n)) / SLIDER_MAX_LOG) * SLIDER_STEPS);

function syncHint(n) {
  $('guess-hint').textContent = n ? `${inr(n)}${n >= 100000 ? ` · ${inWords(n)}` : ''}` : 'Type a price, or slide';
  $('guess-hint').classList.toggle('set', Boolean(n));
  document.querySelector('.lock').disabled = !n || ui.busy;
}

function marker(cls, face, guess, price, label) {
  return `<span class="pin ${cls}" style="--x:${(meterPos(guess, price) * 100).toFixed(1)}%">
    <span class="pin-face">${esc(face)}</span><span class="pin-label">${label}</span></span>`;
}

function renderReveal(i, animate) {
  const v = verdict(i.guess, i.price);
  const theirs = i.partner_guess != null;
  const closer = theirs && i.points !== i.partner_points ? (i.points > i.partner_points ? 'me' : 'them') : null;
  const isLast = nextSlot() == null;
  $('kk-stage').innerHTML = `<article class="card item-card revealed ${animate ? 'enter' : ''}">
    ${cardFace(i)}
    <div class="reveal">
      <p class="price-label">It costs</p>
      <p class="price" data-price="${i.price}">${animate && !reduce ? '₹0' : inr(i.price)}</p>
      ${i.price >= 100000 ? `<p class="price-words muted">${inWords(i.price)}</p>` : ''}
      <div class="meter" aria-hidden="true">
        <span class="zone"></span><span class="bull"></span>
        <span class="tick l">⅓×</span><span class="tick r">3×</span>
        ${marker('me', emojiOf(memberOf(ui.me)), i.guess, i.price, inr(i.guess))}
        ${theirs ? marker('them', emojiOf(ui.partner), i.partner_guess, i.price, inr(i.partner_guess)) : ''}
      </div>
      <div class="verdict"><span class="v-emoji">${v.emoji}</span><div><b>${v.title}</b><span class="muted">${v.sub}</span></div>
        <span class="pts">+${i.points}</span></div>
      ${theirs ? `<p class="versus ${closer ?? ''}">${closer === 'me' ? 'You were closer 🏆' : closer === 'them' ? `${partnerName()} was closer` : 'Dead heat!'}
        <span class="muted">${partnerName()} guessed ${inr(i.partner_guess)} · +${i.partner_points}</span></p>`
        : `<p class="versus muted">${i.partner_played ? '' : `${partnerName()} hasn't guessed this one yet`}</p>`}
      ${i.source ? `<a class="source" href="${esc(i.source)}" target="_blank" rel="noopener">Price as of ${esc(i.as_of ?? '')} · source ↗</a>` : ''}
      <button class="btn next" data-action="next" style="--pc:var(--gold)">${isLast ? 'See the scorecard 🏁' : 'Next →'}</button>
    </div>
  </article>`;
  if (animate && !reduce) countUp($('kk-stage').querySelector('.price'), i.price);
}

function countUp(el, to) {
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / 900);
    el.textContent = inr(Math.round(to * (1 - (1 - p) ** 4)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- scorecard ---------- */
function renderSummary() {
  const mine = total('points');
  const partnerDone = items().every((i) => i.partner_played);
  const theirs = total('partner_points');
  const month = new Date().toISOString().slice(0, 7);
  const t = standings(ui.state.history, ui.me, ui.partner?.user_id, month);
  const headline = !partnerDone ? `You scored <b>${mine}</b>/500`
    : mine === theirs ? `Tied at <b>${mine}</b>!` : mine > theirs ? `You win today, <b>${mine}–${theirs}</b> 🏆` : `${partnerName()} wins today, <b>${theirs}–${mine}</b>`;
  $('kk-stage').innerHTML = `<article class="card summary enter">
    <span class="trophy" aria-hidden="true">${partnerDone ? (mine >= theirs ? '🏆' : '🥈') : '🧾'}</span>
    <h2>${headline}</h2>
    ${partnerDone ? '' : `<p class="muted">${partnerName()} hasn't finished yet. Their score shows here once they do.</p>`}
    <div class="rows">
      <div class="row head"><span></span><span></span><span class="r-me">${esc(emojiOf(memberOf(ui.me)))}</span><span class="r-them">${esc(emojiOf(ui.partner))}</span></div>
      ${items().map((i) => `<div class="row">
        <span class="r-emoji">${esc(i.emoji)}</span>
        <span class="r-name"><b>${esc(i.name)}</b><small>${inr(i.price)}</small></span>
        <span class="r-me ${i.partner_points != null && i.points > i.partner_points ? 'won' : ''}">${i.points}</span>
        <span class="r-them ${i.partner_points != null && i.partner_points > i.points ? 'won' : ''}">${i.partner_points ?? '–'}</span>
      </div>`).join('')}
    </div>
    <div class="month">
      <span class="eyebrow">${new Date().toLocaleDateString(undefined, { month: 'long' })}</span>
      <span class="m-score"><span class="me">${esc(emojiOf(memberOf(ui.me)))} ${t.me}</span><i>–</i><span class="them">${t.partner} ${esc(emojiOf(ui.partner))}</span></span>
      <span class="muted small">${t.ties ? `${t.ties} tie${t.ties === 1 ? '' : 's'} · ` : ''}days you both finished</span>
    </div>
    <p class="muted small" id="kk-countdown"></p>
  </article>`;
  tickCountdown();
}

// Next round at midnight India time.
function tickCountdown() {
  const el = $('kk-countdown');
  if (!el) return;
  const ist = new Date(Date.now() + 5.5 * 3600000);
  const left = 86400 - (ist.getUTCHours() * 3600 + ist.getUTCMinutes() * 60 + ist.getUTCSeconds());
  el.textContent = `New prices in ${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m`;
  clearTimeout(tickCountdown.timer);
  tickCountdown.timer = setTimeout(tickCountdown, 30000);
}

function render(animate = false) {
  if (ui.view == null) ui.view = nextSlot() ?? 'summary';
  renderDots();
  if (ui.view === 'summary') { renderSummary(); return; }
  const i = items()[ui.view];
  if (i.guess == null) renderGuess(i);
  else renderReveal(i, animate);
}

/* ---------- actions ---------- */
async function submitGuess() {
  const n = parseGuess($('guess-input').value);
  if (!n || ui.busy) return;
  ui.busy = true;
  const slot = ui.view;
  document.querySelector('.lock').disabled = true;
  document.querySelector('.lock').textContent = 'Locking…';
  try {
    ui.state = await api.guess(slot, n);
    ui.live?.ping();
    const i = items()[slot];
    track('kitne_guessed', { slot, points: i.points });
    if (nextSlot() == null) track('kitne_round_done', { total: total('points') });
    render(true);
  } catch (e) {
    reportError(e, 'kitne-guess');
    toast(e.message?.includes('already') ? 'You already guessed that one' : 'Couldn’t save that. Try again?');
    ui.state = await api.loadToday().catch(() => ui.state);
    render();
  } finally {
    ui.busy = false;
  }
}

document.addEventListener('input', (e) => {
  if (e.target.id === 'guess-input') {
    const n = parseGuess(e.target.value);
    if (n) $('guess-slider').value = rupeesToSlider(n);
    syncHint(n);
  }
  if (e.target.id === 'guess-slider') {
    const n = sliderToRupees(Number(e.target.value));
    $('guess-input').value = n.toLocaleString('en-IN');
    syncHint(n);
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'guess-form') { e.preventDefault(); submitGuess(); }
});

document.addEventListener('click', (e) => {
  const dot = e.target.closest('[data-slot]');
  if (dot && !dot.disabled) {
    ui.view = dot.dataset.slot === 'summary' ? 'summary' : Number(dot.dataset.slot);
    render();
    return;
  }
  if (e.target.closest('[data-action="next"]')) {
    ui.view = nextSlot() ?? 'summary';
    render();
  }
});

/* ---------- boot ---------- */
function showGate(html) {
  $('gate').innerHTML = html;
  $('gate').hidden = false;
  $('kk-view').hidden = true;
}

async function boot() {
  if (!isConfigured) { showGate('<div class="card center">Not configured.</div>'); return; }
  let user;
  try { user = await currentUser(); } catch (e) { reportError(e, 'kitne-session'); }
  if (!user) { location.replace(BASE); return; }
  ui.me = user.id;
  let space;
  try { space = await loadSpace(user); } catch (e) { reportError(e, 'kitne-space'); showGate('<div class="card center narrow"><h2>Something went wrong</h2><p class="muted">Try reloading the page.</p></div>'); return; }
  if (!space.couple) {
    showGate(`<div class="card center narrow"><span class="gate-icon" aria-hidden="true">🛒</span><h2>Kitne Ka? is for couples</h2>
      <p class="muted">Pair up with your partner in Wordle first (room settings → “Make us a couple 💞”), then come back.</p>
      <a class="btn" href="${BASE}wordle-duo/">Go to Wordle</a></div>`);
    return;
  }
  ui.members = space.couple.members;
  ui.partner = space.couple.partner;
  ui.roomId = space.couple.room.id;
  try { ui.state = await api.loadToday(); } catch (e) { reportError(e, 'kitne-load'); showGate('<div class="card center narrow"><h2>Something went wrong</h2><p class="muted">Try reloading the page.</p></div>'); return; }
  $('gate').hidden = true;
  $('kk-view').hidden = false;
  render(false);
  ui.live = api.subscribe(ui.roomId, async () => {
    if (ui.busy) return;
    ui.state = await api.loadToday();
    if (ui.view === 'summary' || items()[ui.view]?.guess != null) render();
    else renderDots();
  });
}

boot();
