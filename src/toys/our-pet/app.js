// Our Little Pet page: the pet on its little stage (idle life, boops, strokes, tickles, fetch, treats), its meters,
// the things that cheer it up, a diary, hatching an egg, and saying goodbye.
import { isConfigured, currentUser } from '../../shared/supabase.js';
import { loadSpace, emojiOf } from '../../shared/space.js';
import { track, reportError } from '../../shared/telemetry.js';
import * as api from './api.js';
import {
  COLOURS, NAMES, LIMITS, TREATS, TOYS, moodOf, meterWord, speech, ageLabel, eventText, diary, isNight, istDay,
} from './pet.js';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const REFRESH_MS = 60000;          // meters drain live; re-read now and then
const NAP_AFTER_MS = 75000;        // no interaction for this long → a daytime nap
const STROKE_PX = 90;              // pointer travel over the pet that counts as a stroke
const TICKLE_TAPS = 5;
const TICKLE_WINDOW_MS = 1600;
const PET_PING_MS = 9000;          // at most one cuddle sent to the server this often
const EDGE = 95;                   // keep the pet this far from the stage edges (px)

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? Math.min(ms, 50) : ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ui = {
  me: null, partner: null, members: [], roomId: null, state: null, live: null,
  x: 0, busy: false, asleep: false, napping: false, lastTouch: Date.now(), idleTimer: null, talkTimer: null,
  taps: [], stroke: null, lastPetPing: 0, colour: 'pink', hatchColour: 'pink', hatchName: '',
};

const memberOf = (id) => ui.members.find((m) => m.user_id === id);
const partnerName = () => ui.partner?.display_name ?? 'your person';
const whoOf = (id) => (id == null ? 'You two' : id === ui.me ? 'You' : esc(memberOf(id)?.display_name ?? 'Someone'));
const pet = () => ui.state?.pet ?? null;
const mood = () => moodOf(pet(), Date.now());
const left = (kind) => Math.max(0, LIMITS[kind] - (ui.state?.today?.[kind] ?? 0));

/* ---------- the pet drawing ---------- */
// One blob with ears, a tail, little arms and feet. Faces and poses are switched with data attributes and classes.
function petSVG(colour) {
  const c = COLOURS[colour] ?? COLOURS.pink;
  return `<svg class="pet-svg" viewBox="0 0 240 220" style="--body:${c.body};--belly:${c.belly};--inner:${c.inner}" data-eyes="open" data-mouth="smile" aria-hidden="true">
    <ellipse class="shadow" cx="120" cy="204" rx="50" ry="8" />
    <g class="hopper"><g class="breather">
      <g class="halo"><ellipse cx="120" cy="52" rx="30" ry="8" /></g>
      <g class="tail"><path class="tail-line" d="M162 172 C 188 170 200 150 194 128 C 191 118 182 116 178 124" /><path class="tail-fill" d="M162 172 C 188 170 200 150 194 128 C 191 118 182 116 178 124" /></g>
      <g class="ear ear-l"><path class="outline" d="M84 100 L72 58 Q73 50 81 54 L110 84 Z" /><path class="inner" d="M86 92 L79 64 L102 85 Z" /></g>
      <g class="ear ear-r"><path class="outline" d="M156 100 L168 58 Q167 50 159 54 L130 84 Z" /><path class="inner" d="M154 92 L161 64 L138 85 Z" /></g>
      <path class="body outline" d="M120 76 C 164 76 184 108 184 146 C 184 184 158 202 120 202 C 82 202 56 184 56 146 C 56 108 76 76 120 76 Z" />
      <ellipse class="belly" cx="120" cy="166" rx="38" ry="28" />
      <g class="arm arm-l"><ellipse class="outline" cx="62" cy="156" rx="11" ry="15" /></g>
      <g class="arm arm-r"><ellipse class="outline" cx="178" cy="156" rx="11" ry="15" /></g>
      <ellipse class="foot outline" cx="96" cy="201" rx="15" ry="8" /><ellipse class="foot outline" cx="144" cy="201" rx="15" ry="8" />
      <g class="bandage"><rect x="134" y="86" width="30" height="11" rx="4" transform="rotate(24 149 91)" /><circle cx="146" cy="90" r="1.4" /><circle cx="152" cy="93" r="1.4" /></g>
      <g class="face">
        <g class="brows"><path d="M88 108 l16 -5" /><path d="M152 108 l-16 -5" /></g>
        <g class="eyes-open"><g class="eye"><ellipse cx="102" cy="132" rx="10" ry="12" /><circle class="shine" cx="105.5" cy="127" r="3.8" /><circle class="shine" cx="98.5" cy="137" r="1.8" /></g>
          <g class="eye"><ellipse cx="138" cy="132" rx="10" ry="12" /><circle class="shine" cx="141.5" cy="127" r="3.8" /><circle class="shine" cx="134.5" cy="137" r="1.8" /></g></g>
        <g class="eyes-happy line"><path d="M92 135 q10 -12 20 0" /><path d="M128 135 q10 -12 20 0" /></g>
        <g class="eyes-closed line"><path d="M92 131 q10 8 20 0" /><path d="M128 131 q10 8 20 0" /></g>
        <g class="eyes-dizzy line"><path d="M95 126 l14 12 M109 126 l-14 12" /><path d="M131 126 l14 12 M145 126 l-14 12" /></g>
        <ellipse class="cheek" cx="86" cy="150" rx="10" ry="6" /><ellipse class="cheek" cx="154" cy="150" rx="10" ry="6" />
        <path class="mouth m-smile line" d="M110 148 q5 6 10 0 q5 6 10 0" />
        <path class="mouth m-open" d="M111 146 q9 16 18 0 z" />
        <path class="mouth m-sad line" d="M111 155 q9 -8 18 0" />
        <ellipse class="mouth m-o" cx="120" cy="152" rx="5" ry="6" />
        <circle class="held-ball" cx="120" cy="154" r="9" />
        <path class="tear" d="M98 144 q-5 10 0 13 q5 -3 0 -13 z" />
      </g>
    </g></g>
  </svg>`;
}

const svg = () => document.querySelector('#stage .pet-svg');
const wrap = () => $('pet-wrap');

function face(eyes, mouth) {
  const s = svg();
  if (!s) return;
  if (eyes) s.dataset.eyes = eyes;
  if (mouth) s.dataset.mouth = mouth;
}

// The resting face for the current mood.
function restFace() {
  const m = mood();
  if (ui.asleep || ui.napping || m === 'dead') return face('closed', 'smile');
  if (m === 'sick') return face('closed', 'sad');
  if (m === 'sad' || m === 'hungry') return face('open', 'sad');
  return face('open', 'smile');
}

function pose(cls, ms) {
  const s = svg();
  if (!s) return Promise.resolve();
  s.classList.remove(cls);
  void s.getBoundingClientRect();
  s.classList.add(cls);
  return wait(ms).then(() => s.classList.remove(cls));
}

/* ---------- speech + particles ---------- */
function say(text, ms = 4200) {
  const b = $('bubble');
  if (!text) return;
  b.textContent = text;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
  clearTimeout(say.timer);
  say.timer = setTimeout(() => b.classList.remove('show'), ms);
}

function burst(emoji, n = 5, spread = 70) {
  const layer = $('fx');
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'particle';
    p.textContent = Array.isArray(emoji) ? pickOne(emoji) : emoji;
    p.style.setProperty('--x', `${ui.x + rand(-spread / 2, spread / 2)}px`);
    p.style.setProperty('--dx', `${rand(-30, 30)}px`);
    p.style.setProperty('--d', `${rand(0, 300)}ms`);
    p.style.setProperty('--s', rand(0.8, 1.4).toFixed(2));
    layer.append(p);
    setTimeout(() => p.remove(), 2200);
  }
}

/* ---------- moving about ---------- */
const bounds = () => Math.max(0, $('stage').clientWidth / 2 - EDGE);

function moveTo(x, speed = 160) {
  const target = Math.max(-bounds(), Math.min(bounds(), x));
  const dist = Math.abs(target - ui.x);
  if (dist < 4) return Promise.resolve();
  const ms = reduce ? 0 : (dist / speed) * 1000;
  const w = wrap();
  w.classList.toggle('facing-left', target < ui.x);
  w.classList.add('walking');
  w.style.transitionDuration = `${ms}ms`;
  ui.x = target;
  w.style.setProperty('--px', `${target}px`);
  $('bubble').style.setProperty('--px', `${target}px`);
  return wait(ms).then(() => w.classList.remove('walking'));
}

/* ---------- idle life ---------- */
const IDLE = {
  happy: [['look', 4], ['hop', 3], ['wander', 3], ['wiggle', 2], ['wave', 2], ['twirl', 1], ['butterfly', 1], ['sneeze', 1], ['ears', 2]],
  okay: [['look', 4], ['wander', 3], ['hop', 1], ['ears', 2], ['wave', 1], ['yawn', 1], ['butterfly', 1]],
  hungry: [['growl', 3], ['look', 2], ['sigh', 2], ['wander', 1]],
  sad: [['sigh', 3], ['tear', 2], ['look', 2], ['wander', 1]],
  sick: [['sigh', 2], ['wobble', 2], ['tear', 1]],
};

function pickIdle() {
  const list = IDLE[mood()] ?? IDLE.okay;
  let r = Math.random() * list.reduce((s, [, w]) => s + w, 0);
  for (const [name, w] of list) { r -= w; if (r <= 0) return name; }
  return 'look';
}

async function idleAction(name) {
  switch (name) {
    case 'look': {
      const s = svg();
      s.style.setProperty('--lx', `${rand(-5, 5)}px`);
      s.style.setProperty('--ly', `${rand(-3, 3)}px`);
      await wait(1400);
      s.style.setProperty('--lx', '0px');
      s.style.setProperty('--ly', '0px');
      break;
    }
    case 'hop': face('happy', 'open'); await pose('hop', 600); await pose('hop', 600); restFace(); break;
    case 'wander': await moveTo(rand(-bounds(), bounds()), mood() === 'happy' ? 150 : 80); break;
    case 'wiggle': face('happy', 'smile'); await pose('wiggle', 900); restFace(); break;
    case 'wave': face('happy', 'open'); await pose('wave', 1300); restFace(); break;
    case 'twirl': face('happy', 'open'); await pose('twirl', 900); burst('✨', 3); restFace(); break;
    case 'ears': await pose(Math.random() < 0.5 ? 'twitch-l' : 'twitch-r', 500); break;
    case 'yawn': face('closed', 'o'); say('*yaaawn*', 1800); await wait(1600); restFace(); break;
    case 'sneeze': face('closed', 'o'); await wait(500); say('ACHOO!', 1400); await pose('sneeze', 400); burst('💨', 2, 20); restFace(); break;
    case 'butterfly': await butterfly(); break;
    case 'growl': say(pickOne(['*grrrumble*', '*tummy noises*', '🍙?']), 2200); await pose('wobble', 700); break;
    case 'sigh': say(pickOne(['haah…', '*sigh*', '…']), 2000); await pose('slump', 1600); break;
    case 'tear': face('open', 'sad'); svg().classList.add('crying'); await wait(2600); svg().classList.remove('crying'); break;
    case 'wobble': await pose('wobble', 900); break;
    default: break;
  }
}

async function butterfly() {
  const b = document.createElement('span');
  b.className = 'butterfly';
  b.textContent = '🦋';
  $('fx').append(b);
  const s = svg();
  const follow = setInterval(() => {
    const br = b.getBoundingClientRect();
    const pr = s.getBoundingClientRect();
    s.style.setProperty('--lx', `${Math.max(-6, Math.min(6, (br.x - pr.x - pr.width / 2) / 30))}px`);
    s.style.setProperty('--ly', `${Math.max(-4, Math.min(4, (br.y - pr.y - pr.height / 3) / 40))}px`);
  }, 80);
  face('open', 'o');
  await wait(1500);
  face('happy', 'open');
  await pose('hop', 600);
  await pose('hop', 600);
  await wait(1400);
  clearInterval(follow);
  b.remove();
  s.style.setProperty('--lx', '0px');
  s.style.setProperty('--ly', '0px');
  restFace();
}

function scheduleIdle() {
  clearTimeout(ui.idleTimer);
  ui.idleTimer = setTimeout(async () => {
    if (!ui.busy && pet() && mood() !== 'dead' && !document.hidden) {
      if (!ui.asleep && !ui.napping && Date.now() - ui.lastTouch > NAP_AFTER_MS) startNap();
      if (ui.asleep || ui.napping) {
        burst('💤', 1, 10);
        if (Math.random() < 0.25) await pose('turn', 900);
      } else {
        ui.busy = true;
        try { await idleAction(pickIdle()); } finally { ui.busy = false; }
      }
    }
    scheduleIdle();
  }, reduce ? 8000 : rand(2600, 6000));
}

function blinkLoop() {
  setTimeout(() => {
    const s = svg();
    if (s && s.dataset.eyes === 'open') {
      s.classList.add('blink');
      setTimeout(() => s.classList.remove('blink'), 150);
      if (Math.random() < 0.2) setTimeout(() => { s.classList.add('blink'); setTimeout(() => s.classList.remove('blink'), 140); }, 280);
    }
    blinkLoop();
  }, rand(2200, 5200));
}

function talkLoop() {
  clearTimeout(ui.talkTimer);
  ui.talkTimer = setTimeout(() => {
    if (pet() && !ui.busy && !document.hidden && mood() !== 'dead' && !ui.napping) say(speech(ui.state, Date.now(), partnerName(), (n) => Math.floor(Math.random() * n)));
    talkLoop();
  }, rand(16000, 28000));
}

function startNap() {
  ui.napping = true;
  restFace();
  svg()?.classList.add('sleeping');
}

// Any touch wakes it. At night it nods back off after a bit.
function wake(line) {
  ui.lastTouch = Date.now();
  const wasAsleep = ui.asleep || ui.napping;
  ui.napping = false;
  if (ui.asleep) {
    ui.asleep = false;
    clearTimeout(wake.timer);
    wake.timer = setTimeout(() => { if (isNight(Date.now())) { ui.asleep = true; svg()?.classList.add('sleeping'); restFace(); } }, 25000);
  }
  svg()?.classList.remove('sleeping');
  restFace();
  if (wasAsleep && line) say(pickOne(['huh? oh, hi…', 'five more minutes…', '*rubs eyes*', 'I wasn\'t sleeping. I was resting my eyes.']));
  return wasAsleep;
}

/* ---------- touching ---------- */
function onPointerDown(e) {
  if (!pet() || mood() === 'dead') return;
  ui.stroke = { x: e.clientX, y: e.clientY, dist: 0, purred: false, at: Date.now() };
  e.currentTarget.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e) {
  // eyes follow you around
  const s = svg();
  if (s && pet() && !ui.busy && mood() !== 'dead' && s.dataset.eyes === 'open') {
    const r = s.getBoundingClientRect();
    const dx = e.clientX - (r.x + r.width / 2);
    const dy = e.clientY - (r.y + r.height * 0.55);
    s.style.setProperty('--lx', `${Math.max(-6, Math.min(6, dx / 40))}px`);
    s.style.setProperty('--ly', `${Math.max(-4, Math.min(4, dy / 50))}px`);
  }
  if (!ui.stroke) return;
  ui.stroke.dist += Math.hypot(e.clientX - ui.stroke.x, e.clientY - ui.stroke.y);
  ui.stroke.x = e.clientX;
  ui.stroke.y = e.clientY;
  if (!ui.stroke.purred && ui.stroke.dist > STROKE_PX) {
    ui.stroke.purred = true;
    wake(false);
    face('happy', 'smile');
    say(pickOne(['prrrr~', 'mmmm yes, right there', '*melts*', 'prrrrrrrr 💕']), 2600);
    burst(['💕', '💗', '✨'], 4);
    svg().classList.add('purr');
    cuddle(false);
  }
}

function onPointerUp() {
  const st = ui.stroke;
  ui.stroke = null;
  svg()?.classList.remove('purr');
  if (!st) return;
  if (st.purred) { setTimeout(restFace, 900); return; }
  if (st.dist < 12) boop();
}

async function boop() {
  if (wake(true)) return;
  const now = Date.now();
  ui.taps = [...ui.taps.filter((t) => now - t < TICKLE_WINDOW_MS), now];
  if (ui.taps.length >= TICKLE_TAPS) {
    ui.taps = [];
    ui.busy = true;
    face('happy', 'open');
    say(pickOne(['hehehe STOP IT', 'hahaha not the tummy!', 'hee hee hee 🤭']), 2400);
    await pose('roll', 900);
    burst(['😆', '✨'], 4);
    restFace();
    ui.busy = false;
    cuddle(false);
    return;
  }
  const m = mood();
  if (m === 'sick') { say(pickOne(['ow… gentle…', '*weak boop back*']), 1800); await pose('squish', 400); return; }
  if (m === 'sad' || m === 'hungry') { face('open', 'o'); await pose('squish', 400); say(pickOne(['oh! you\'re here!', 'hi…', 'boop?']), 1800); restFace(); return; }
  const r = pickOne(['giggle', 'surprised', 'hop']);
  if (r === 'giggle') { face('happy', 'open'); say(pickOne(['hehe', 'boop!', 'again!']), 1400); await pose('squish', 400); }
  if (r === 'surprised') { face('open', 'o'); say('!', 900); await pose('squish', 400); }
  if (r === 'hop') { face('happy', 'open'); await pose('hop', 600); }
  burst('💗', 2, 30);
  setTimeout(restFace, 600);
}

/* ---------- actions that count ---------- */
async function send(kind) {
  const before = ui.state?.today?.[kind] ?? 0;
  try {
    ui.state = await api.act(kind);
    const applied = (ui.state.today?.[kind] ?? 0) > before;
    if (applied) { ui.live?.ping(); track('pet_action', { kind }); }
    renderPanel();
    return applied;
  } catch (e) {
    reportError(e, `pet-${kind}`);
    return false;
  }
}

function cuddle(fromButton) {
  if (Date.now() - ui.lastPetPing < PET_PING_MS && !fromButton) return;
  ui.lastPetPing = Date.now();
  send('pet');
}

async function doCuddle() {
  if (ui.busy) return;
  ui.busy = true;
  wake(false);
  await moveTo(0, 200);
  face('happy', 'smile');
  svg().classList.add('purr');
  burst(['💕', '💗', '💞', '🥰'], 8, 110);
  say(pickOne(['best hug ever', 'squeeeeze 🥹', 'I love you two', 'prrrrr']), 2600);
  await send('pet');
  await wait(1800);
  svg().classList.remove('purr');
  restFace();
  ui.busy = false;
}

async function doFeed() {
  if (ui.busy) return;
  ui.busy = true;
  wake(false);
  const treat = pickOne(TREATS);
  const bowlX = -bounds();
  const t = document.createElement('span');
  t.className = 'treat drop';
  t.textContent = treat;
  t.style.setProperty('--x', `${bowlX}px`);
  $('fx').append(t);
  const applied = send('feed');
  face('open', 'o');
  await moveTo(bowlX + 70, 170);
  wrap().classList.add('facing-left');
  if (await applied) {
    for (let i = 0; i < 6; i++) { face('closed', i % 2 ? 'smile' : 'open'); burst('·', 1, 20); await wait(220); }
    t.classList.add('eaten');
    face('happy', 'open');
    say(pickOne([`nom nom nom ${treat}`, 'yummmm', 'my favourite!!', 'more? MORE?']), 2400);
    burst(['💛', '✨'], 4);
    await pose('hop', 600);
  } else {
    face('open', 'sad');
    say(pickOne(['I\'m stuffed… maybe later 🥴', 'one more bite and I\'ll pop', 'save it for tomorrow?']), 2600);
    await pose('shake', 700);
    t.classList.add('eaten');
  }
  await wait(600);
  t.remove();
  restFace();
  ui.busy = false;
}

async function doFetch(targetX) {
  if (ui.busy) return;
  ui.busy = true;
  wake(false);
  const toX = targetX ?? (ui.x > 0 ? rand(-bounds(), -40) : rand(40, bounds()));
  const x = Math.max(-bounds(), Math.min(bounds(), toX));
  const ball = $('ball');
  ball.hidden = false;
  face('open', 'o');
  const fly = reduce ? null : ball.animate([
    { transform: `translate(${ui.x}px, -60px) scale(.8)` },
    { transform: `translate(${(ui.x + x) / 2}px, -190px) scale(1)`, offset: 0.45 },
    { transform: `translate(${x}px, 0) scale(1)`, offset: 0.8 },
    { transform: `translate(${x}px, -24px) scale(1)`, offset: 0.9 },
    { transform: `translate(${x}px, 0) scale(1)` },
  ], { duration: 900, easing: 'ease-out', fill: 'forwards' });
  if (!fly) ball.style.transform = `translate(${x}px, 0)`;
  await wait(300);
  face('happy', 'open');
  await moveTo(x, 260);
  await (fly?.finished ?? Promise.resolve());
  ball.hidden = true;
  svg().classList.add('holding');
  face('happy', 'smile');
  await pose('hop', 500);
  await moveTo(0, 220);
  svg().classList.remove('holding');
  ball.getAnimations().forEach((a) => a.cancel());
  ball.style.transform = `translate(${ui.x + 30}px, 0)`;
  ball.hidden = false;
  const applied = await send('play');
  say(applied ? pickOne(['again! again!', 'I\'m SO fast', 'did you see that?!', 'throw it further!']) : pickOne(['*pant pant* one sec…', 'I\'m pooped 😮‍💨', 'tomorrow, champ']), 2200);
  burst(applied ? ['⭐', '✨'] : '💦', 3);
  restFace();
  ui.busy = false;
}

/* ---------- rendering ---------- */
function renderStageExtras() {
  const night = isNight(Date.now());
  $('stage').classList.toggle('night', night);
  const p = pet();
  const m = mood();
  const s = svg();
  if (!s) return;
  s.dataset.mood = m;
  if (m === 'sleepy' && !ui.asleep && Date.now() - ui.lastTouch > 4000) { ui.asleep = true; }
  s.classList.toggle('sleeping', ui.asleep || ui.napping);
  $('stage').classList.toggle('is-dead', m === 'dead');
  $('grave').hidden = m !== 'dead';
  if (m === 'dead') {
    // the ghost floats beside its stone
    ui.x = -Math.min(70, bounds());
    wrap().style.setProperty('--px', `${ui.x}px`);
    $('bubble').style.setProperty('--px', `${ui.x}px`);
  }
  if (m === 'dead' && p) {
    const born = new Date(p.born_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    const died = new Date(p.died_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    $('grave').innerHTML = `<span class="rip">RIP</span><b>${esc(p.name)}</b><small>${born} – ${died}</small>`;
  }
  restFace();
}

function meter(key, label, icon, v) {
  const low = v < 25 ? 'low' : v < 50 ? 'mid' : '';
  return `<div class="meter ${low}">
    <span class="m-icon" aria-hidden="true">${icon}</span>
    <span class="m-label">${label}<small>${meterWord(key, v)}</small></span>
    <span class="m-bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v)}"><span style="width:${v}%"></span></span>
  </div>`;
}

function renderPanel() {
  const p = pet();
  if (!p) return;
  const dead = Boolean(p.died_at);
  const now = Date.now();
  $('pet-name').textContent = p.name;
  $('pet-age').textContent = dead ? `${ageLabel(p.born_at, Date.parse(p.died_at)).replace(' old', '')} with you` : ageLabel(p.born_at, now);
  $('meters').innerHTML = dead ? '' : meter('health', 'Health', '❤️', p.health) + meter('hunger', 'Tummy', '🍙', p.hunger) + meter('happiness', 'Happiness', '😊', p.happiness);
  $('actions').innerHTML = dead
    ? `<p class="goodbye">${esc(p.name)} waited for you… 🕊️<br /><span class="muted">Pets need a visit, a snack or a game at least once a week.</span></p>
       <button class="btn" data-action="new-egg" style="--pc:var(--mint)">Hatch a new egg 🥚</button>`
    : `<button class="btn act" data-action="feed" style="--pc:var(--gold)">🍙 Feed<small>${left('feed')} left today</small></button>
       <button class="btn act" data-action="play" style="--pc:var(--blue)">🎾 Fetch<small>${left('play')} left today</small></button>
       <button class="btn act" data-action="cuddle" style="--pc:var(--pink)">🤗 Cuddle<small>${left('pet') ? 'always welcome' : 'so loved today'}</small></button>`;
  $('tips').hidden = dead;
  const today = istDay(now);
  const last = ui.state.last ?? {};
  $('toys').innerHTML = TOYS.map((t) => {
    const done = last[t.kind] && istDay(Date.parse(last[t.kind])) === today;
    return `<a class="toy-chip ${done ? 'done' : ''}" href="${BASE}${t.slug}/">${t.icon} ${t.label}<span>${done ? '✓' : '→'}</span></a>`;
  }).join('');
  $('tips-name').textContent = p.name;
  const rows = diary(ui.state.events ?? []);
  $('diary').innerHTML = rows.length ? rows.map((e) => `<li><span>${eventText(e, whoOf, esc(p.name))}${e.n > 1 ? ` <b>×${e.n}</b>` : ''}</span>
    <time>${agoShort(e.at)}</time></li>`).join('') : '<li class="muted">Nothing yet.</li>';
  const graves = ui.state.graves ?? [];
  $('memorial').hidden = !graves.length;
  $('memorial-list').innerHTML = graves.map((g) => `<li>🪦 <b>${esc(g.name)}</b> <span class="muted">${new Date(g.born_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(g.died_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></li>`).join('');
}

function agoShort(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function renderPet() {
  const p = pet();
  $('egg-view').hidden = true;
  $('pet-view').hidden = false;
  if (ui.colour !== p.colour || !svg()) {
    ui.colour = p.colour;
    wrap().innerHTML = petSVG(p.colour);
  }
  renderStageExtras();
  renderPanel();
}

/* ---------- the egg ---------- */
function eggSVG(colour) {
  const c = COLOURS[colour];
  return `<svg class="egg-svg" viewBox="0 0 160 190" aria-hidden="true">
    <ellipse cx="80" cy="180" rx="44" ry="7" class="shadow" />
    <g class="egg-whole">
      <path class="egg-shell" d="M80 12 C 120 12 146 84 146 120 C 146 158 116 178 80 178 C 44 178 14 158 14 120 C 14 84 40 12 80 12 Z" style="fill:${c.belly}" />
      <circle cx="56" cy="78" r="9" style="fill:${c.body}" /><circle cx="104" cy="104" r="12" style="fill:${c.body}" /><circle cx="66" cy="132" r="7" style="fill:${c.body}" />
      <circle cx="108" cy="58" r="6" style="fill:${c.body}" /><circle cx="44" cy="112" r="5" style="fill:${c.inner}" />
      <path class="crack" d="M30 104 l18 -10 l12 12 l16 -14 l14 12 l16 -10 l18 10 l12 -8" />
    </g>
  </svg>`;
}

function renderEgg() {
  $('pet-view').hidden = true;
  $('egg-view').hidden = false;
  const graves = ui.state.graves ?? [];
  $('egg-art').innerHTML = eggSVG(ui.hatchColour);
  $('egg-intro').textContent = graves.length ? `A new egg. ${graves[0].name} would want you to try again 🕊️` : 'An egg appeared on your doorstep. It\'s warm, and it wobbles when you talk to it.';
  $('swatches').innerHTML = Object.entries(COLOURS).map(([k, c]) => `<button type="button" class="swatch ${k === ui.hatchColour ? 'on' : ''}" data-colour="${k}"
    style="--c:${c.body}" aria-label="${k}" aria-pressed="${k === ui.hatchColour}"></button>`).join('');
  $('name-ideas').innerHTML = NAMES.slice(0, 6).map((n) => `<button type="button" class="chip" data-name="${n}">${n}</button>`).join('');
  $('hatch-name').value = ui.hatchName;
  $('hatch-error').textContent = '';
}

async function hatch() {
  const name = $('hatch-name').value.trim();
  if (!name) { $('hatch-error').textContent = 'Give it a name first'; $('hatch-name').focus(); return; }
  const btn = $('hatch-btn');
  btn.disabled = true;
  btn.textContent = 'Hatching…';
  try {
    const state = await api.adopt(name, ui.hatchColour);
    const egg = document.querySelector('.egg-svg');
    egg.classList.add('cracking');
    await wait(1400);
    egg.classList.add('hatched');
    await wait(500);
    ui.state = state;
    ui.live?.ping();
    track('pet_hatched', { colour: ui.hatchColour, again: (state.graves ?? []).length > 0 });
    renderPet();
    face('happy', 'open');
    burst(['🎉', '✨', '💖', '🐣'], 10, 160);
    await pose('hop', 600);
    say(`Hi!! I'm ${name}! You're my people now 💖`, 5000);
  } catch (e) {
    reportError(e, 'pet-adopt');
    $('hatch-error').textContent = e.message?.includes('partner') ? 'Your partner needs to join first' : e.message || 'Couldn’t hatch. Try again?';
    btn.disabled = false;
    btn.textContent = 'Hatch 🐣';
  }
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const sw = e.target.closest('[data-colour]');
  if (sw) { ui.hatchColour = sw.dataset.colour; ui.hatchName = $('hatch-name').value; renderEgg(); return; }
  const nm = e.target.closest('[data-name]');
  if (nm) { $('hatch-name').value = nm.dataset.name; ui.hatchName = nm.dataset.name; return; }
  const a = e.target.closest('[data-action]')?.dataset.action;
  if (a === 'feed') doFeed();
  if (a === 'play') doFetch();
  if (a === 'cuddle') doCuddle();
  if (a === 'new-egg') { ui.hatchName = ''; renderEgg(); }
});

document.addEventListener('submit', (e) => {
  if (e.target.id === 'hatch-form') { e.preventDefault(); hatch(); }
});

function bindStage() {
  const stage = $('stage');
  wrap().addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  // Tap the floor to throw the ball there.
  stage.addEventListener('click', (e) => {
    if (e.target.closest('#pet-wrap') || !pet() || mood() === 'dead') return;
    const r = stage.getBoundingClientRect();
    if (e.clientY < r.top + r.height * 0.45) return;
    doFetch(e.clientX - (r.left + r.width / 2));
  });
}

// Your partner did something: show it happening.
async function refresh(fromPartner) {
  const before = new Set((ui.state?.events ?? []).map((e) => `${e.kind}${e.at}`));
  try { ui.state = await api.loadPet(); } catch (e) { reportError(e, 'pet-load'); return; }
  if (!pet()) { renderEgg(); return; }
  if (!svg() || $('pet-view').hidden) { renderPet(); return; }
  renderStageExtras();
  renderPanel();
  if (!fromPartner) return;
  const fresh = (ui.state.events ?? []).find((e) => !before.has(`${e.kind}${e.at}`) && e.user_id && e.user_id !== ui.me);
  if (fresh && !ui.busy) {
    const name = partnerName();
    const line = { feed: `${name} just fed me! 🍙`, play: `${name} is playing fetch with me!`, pet: `${name} gave me a cuddle 🥰`, adopt: `${name} hatched me!` }[fresh.kind];
    if (line) { wake(false); say(line); burst('💖', 4); pose('hop', 600); }
  }
}

/* ---------- boot ---------- */
function showGate(html) {
  $('gate').innerHTML = html;
  $('gate').hidden = false;
  $('pet-page').hidden = true;
}

async function boot() {
  if (!isConfigured) { showGate('<div class="card center">Not configured.</div>'); return; }
  let user;
  try { user = await currentUser(); } catch (e) { reportError(e, 'pet-session'); }
  if (!user) { location.replace(BASE); return; }
  ui.me = user.id;
  let space;
  try { space = await loadSpace(user); } catch (e) { reportError(e, 'pet-space'); showGate('<div class="card center narrow"><h2>Something went wrong</h2><p class="muted">Try reloading the page.</p></div>'); return; }
  if (!space.couple?.partner) {
    showGate(`<div class="card center narrow"><span class="gate-icon" aria-hidden="true">🥚</span><h2>A pet needs two people</h2>
      <p class="muted">Pair up with your partner in Wordle first (room settings → “Make us a couple 💞”), then come back.</p>
      <a class="btn" href="${BASE}wordle-duo/">Go to Wordle</a></div>`);
    return;
  }
  ui.members = space.couple.members;
  ui.partner = space.couple.partner;
  ui.roomId = space.couple.room.id;
  try { ui.state = await api.loadPet(); } catch (e) { reportError(e, 'pet-load'); showGate('<div class="card center narrow"><h2>Something went wrong</h2><p class="muted">Try reloading the page.</p></div>'); return; }
  $('gate').hidden = true;
  $('pet-page').hidden = false;
  $('pet-home').textContent = `${emojiOf(memberOf(ui.me))} ${space.couple.me.display_name} & ${partnerName()} ${emojiOf(ui.partner)}`;
  bindStage();
  if (!pet()) renderEgg();
  else {
    ui.asleep = mood() === 'sleepy';
    renderPet();
    setTimeout(() => say(speech(ui.state, Date.now(), partnerName(), (n) => Math.floor(Math.random() * n)), 5000), 700);
  }
  ui.live = api.subscribe(ui.roomId, () => refresh(true));
  scheduleIdle();
  blinkLoop();
  talkLoop();
  setInterval(() => { if (!document.hidden) refresh(false); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
}

boot();
