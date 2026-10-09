// Our Little Pet: a cat that hatches from an egg and lives in an illustrated room. It wanders, grooms, naps in its bed
// or the sunbeam, watches birds from the windowsill and loafs on the sofa. You stroke it to hear it purr, pick up the
// yarn and throw it, set food down for it, and tease it with a feather. Meters, a journal, and a goodbye if it's left
// alone for a week.
import { isConfigured, currentUser } from '../../shared/supabase.js';
import { loadSpace } from '../../shared/space.js';
import { track, reportError } from '../../shared/telemetry.js';
import * as api from './api.js';
import { Cat } from './cat.js';
import { roomSVG, paintTime, FLOOR, SPOTS, scaleAt, ROOM_W, ROOM_H } from './room.js';
import {
  COATS, coatOf, NAMES, LIMITS, FOODS, TOYS, moodOf, meterWord, speech, ageLabel, eventText, diary, isNight, istDay,
} from './pet.js';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const REFRESH_MS = 60000;       // meters drain live; re-read now and then
const PET_PING_MS = 9000;       // at most one cuddle sent to the server this often
const STROKE_PX = 60;           // pointer travel over the cat that counts as a stroke
const TAPS_FOR_FLOP = 4;
const TAP_WINDOW_MS = 1600;
const GRAVITY = 2200;           // room units / s²
const BALL_R = 15;
const FEATHER_LEN = 120;
const NIGHT_PUPIL = 0.85;
const DAY_PUPIL = 0.25;

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NS = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search);

const ui = {
  me: null, partner: null, members: [], roomId: null, state: null, live: null,
  view: null, svg: null, scene: null, cat: null, tod: 'day', camX: null, viewBox: '',
  run: 0, activity: null, lastTouch: Date.now(), lastPetPing: 0, taps: [],
  pointer: null, pointerWorld: null, stroke: null, drag: null,
  ball: null, foods: [], feather: { on: false, active: false, ax: 0, ay: 0, px: 0, py: 0, vx: 0, vy: 0, pinned: 0 },
  eggCoat: 'black', eggName: '', egg: null, captionUntil: 0, zzzAt: 0, heartAt: 0,
};

const memberOf = (id) => ui.members.find((m) => m.user_id === id);
const partnerName = () => ui.partner?.display_name ?? 'your person';
const whoOf = (id) => (id == null ? 'You two' : id === ui.me ? 'You' : esc(memberOf(id)?.display_name ?? 'Someone'));
const pet = () => ui.state?.pet ?? null;
const mood = () => moodOf(pet(), Date.now());
const left = (kind) => Math.max(0, LIMITS[kind] - (ui.state?.today?.[kind] ?? 0));
const alive = (token) => token === ui.run;
const awakeLine = () => pickOne(['mm? oh. it\'s you.', '*stretches* I was resting my eyes.', 'five more minutes…']);

/* ---------- room coordinates ---------- */
function toWorld(clientX, clientY) {
  const m = ui.svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
function toScene(x, y) {
  const m = ui.svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(x, y).matrixTransform(m);
  const r = ui.scene.getBoundingClientRect();
  return { x: p.x - r.left, y: p.y - r.top };
}
const floorPoint = (x, y) => ({ x: clamp(x, FLOOR.x0, FLOOR.x1), y: clamp(y, FLOOR.y0, FLOOR.y1) });

// The view follows the cat on narrow screens and leaves room under the dock.
function camera(dt) {
  const w = ui.svg.clientWidth;
  const h = ui.svg.clientHeight;
  if (!w || !h) return;
  const narrow = w < 640;
  const panel = { live: 'dock-wrap', adopt: 'adopt', dead: 'goodbye' }[ui.view];
  let dock = panel ? ($(panel)?.offsetHeight ?? 0) + 24 : 0;
  if (ui.view !== 'live' && !narrow) dock = h * 0.14;
  const H = narrow ? ROOM_H : Math.min(ROOM_H / (1 - Math.min(0.3, dock / h)), (2300 * h) / w);
  // a tall panel on a phone: slide the view down so the cat (or egg) sits above it
  const frac = Math.max(0.25, (h - dock) / h - 0.06);
  const fy = ui.view === 'adopt' ? SPOTS.door.y + 30 : (ui.cat?.y ?? 800) + 10;
  const y0 = (fy / H > frac) ? Math.min(fy - frac * H, 1500 - H) : 0;
  const visW = (H * w) / h;
  let x0;
  if (visW >= ROOM_W) x0 = (ROOM_W - visW) / 2;
  else {
    const held = ['ball', 'feather', 'stroke'].includes(ui.pointer?.mode);
    const focus = ui.view === 'adopt' ? SPOTS.door.x : ui.cat?.x ?? 800;
    const want = clamp(focus, visW / 2, ROOM_W - visW / 2);
    if (ui.camX == null) ui.camX = want;
    else if (!held) ui.camX = lerp(ui.camX, want, 1 - Math.exp(-dt * 1.8));
    ui.camX = clamp(ui.camX, visW / 2, ROOM_W - visW / 2);
    x0 = ui.camX - visW / 2;
  }
  const vb = `${x0.toFixed(1)} ${y0.toFixed(1)} ${visW.toFixed(1)} ${H.toFixed(1)}`;
  if (vb !== ui.viewBox) { ui.viewBox = vb; ui.svg.setAttribute('viewBox', vb); }
}

/* ---------- captions and little effects ---------- */
function say(text, ms = 4600) {
  if (!text) return;
  const c = $('caption');
  c.textContent = text;
  c.classList.add('show');
  ui.captionUntil = performance.now() + ms;
}

function fx(text, x, y, cls = '') {
  const p = toScene(x, y);
  const el = document.createElement('span');
  el.className = `fx-p ${cls}`;
  if (cls === 'heart') el.innerHTML = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21 C5 15 1 11 1 6.5 A5.5 5.5 0 0 1 12 4 A5.5 5.5 0 0 1 23 6.5 C23 11 19 15 12 21 Z" /></svg>';
  else el.textContent = text;
  el.style.left = `${p.x + rand(-14, 14)}px`;
  el.style.top = `${p.y}px`;
  el.style.setProperty('--dx', `${rand(-26, 26)}px`);
  $('fx').append(el);
  setTimeout(() => el.remove(), 2400);
}
function hearts(n = 3) {
  const h = ui.cat.headPoint();
  for (let i = 0; i < n; i++) setTimeout(() => fx('♥', h.x, h.y + 20, 'heart'), i * 160);
}

/* ---------- activities ---------- */
// One thing at a time. Starting something new makes whatever was running stop at its next step.
function startActivity(name, fn) {
  const token = ++ui.run;
  ui.cat?.stop();
  ui.activity = name;
  resetFx();
  return Promise.resolve(fn(token)).catch((e) => reportError(e, `pet-${name}`)).finally(() => { if (ui.run === token) ui.activity = null; });
}
function resetFx() {
  const c = ui.cat;
  if (!c) return;
  Object.assign(c.fx, { knead: false, lick: false, chatter: false, wiggle: false, eat: false });
  if (!ui.stroke) c.fx.purr = false;
}
const defaultPupil = () => (ui.tod === 'night' || ui.tod === 'evening' ? NIGHT_PUPIL : DAY_PUPIL);

function restFace() {
  const c = ui.cat;
  const m = mood();
  c.face({ eyes: m === 'sick' ? 'half' : 'open', mouth: 'w', pupil: defaultPupil() });
  c.tail = m === 'sad' || m === 'sick' ? 'low' : m === 'happy' ? 'happy' : 'calm';
}

async function goFloor(token) {
  const c = ui.cat;
  if (c.pose === 'sleep' || c.pose === 'loaf' || c.pose === 'lie' || c.pose === 'flop') { c.setPose('stand'); c.face({ eyes: 'open' }); await wait(450); }
  if (c.spot === 'bed') { c.spot = 'floor'; bedFront(false); }
  if (c.spot === 'floor' || !alive(token)) return;
  const sp = SPOTS[c.spot];
  const x = clamp(c.x + c.dir * 70, FLOOR.x0, FLOOR.x1);
  await c.jumpTo(x, sp.below + rand(0, 16), { spot: 'floor', height: 30 });
}

async function walk(token, x, y, opts) {
  await goFloor(token);
  if (!alive(token)) return false;
  const p = floorPoint(x, y);
  const ok = await ui.cat.walkTo(p.x, p.y, opts);
  return ok && alive(token);
}

async function goPerch(token, name) {
  const sp = SPOTS[name];
  const x = rand(sp.x0, sp.x1);
  if (ui.cat.spot === name) return true;
  if (!(await walk(token, x, sp.below))) return false;
  ui.cat.setPose('crouch');
  await wait(260);
  if (!alive(token)) return false;
  await ui.cat.jumpTo(x, sp.y, { s: sp.s, spot: name, height: 50 });
  return alive(token);
}

async function goBed(token, opts) {
  const b = SPOTS.bed;
  if (ui.cat.spot !== 'bed') {
    if (!(await walk(token, b.x + rand(-6, 6), b.y, opts))) return false;
    ui.cat.spot = 'bed';
    bedFront(true);
    for (let i = 0; i < 2 && alive(token); i++) { ui.cat.dir *= -1; await wait(420); }
  }
  return alive(token);
}
const bedFront = (on) => $('bed-front')?.setAttribute('opacity', on ? '1' : '0');

async function lookAround(token, ms) {
  const end = Date.now() + ms;
  while (alive(token) && Date.now() < end) {
    ui.cat.look = [rand(-1, 1), rand(-0.7, 0.5)];
    if (Math.random() < 0.25) ui.cat.earTwitch();
    await wait(rand(700, 1600));
  }
  ui.cat.look = [0, 0];
}

// A slow blink is a cat saying "I like you". You can blink back.
async function offerSlowBlink(token) {
  if (!alive(token) || mood() === 'sad' || mood() === 'sick') return;
  ui.cat.slowBlink();
  await wait(900);
  if (!alive(token)) return;
  const b = $('blink-back');
  b.hidden = false;
  clearTimeout(offerSlowBlink.timer);
  offerSlowBlink.timer = setTimeout(() => { b.hidden = true; }, 5200);
}

/* ---------- life ---------- */
const LIFE = {
  async wander(t) {
    if (!(await walk(t, rand(FLOOR.x0 + 40, FLOOR.x1 - 40), rand(FLOOR.y0, FLOOR.y1)))) return;
    ui.cat.setPose(Math.random() < 0.6 ? 'sit' : 'stand');
    await lookAround(t, rand(2000, 4500));
  },
  async sitAround(t) {
    ui.cat.setPose(ui.cat.spot === 'sofa' ? 'loaf' : 'sit');
    await lookAround(t, rand(2500, 5000));
    if (Math.random() < 0.5) await offerSlowBlink(t);
    await wait(rand(1500, 3000));
  },
  async groom(t) {
    if (ui.cat.spot === 'bed') await goFloor(t);
    ui.cat.setPose('sit');
    await wait(700);
    if (!alive(t)) return;
    ui.cat.face({ eyes: 'half' });
    ui.cat.fx.lick = true;
    await wait(rand(2600, 4400));
    ui.cat.fx.lick = false;
    restFace();
  },
  async stretch(t) {
    await goFloor(t);
    if (!alive(t)) return;
    ui.cat.setPose('stretch', 4);
    await wait(500);
    ui.cat.face({ eyes: 'closed', mouth: 'yawn' });
    await wait(1300);
    restFace();
    ui.cat.setPose('stand');
    await wait(500);
  },
  async sill(t) {
    if (!(await goPerch(t, 'sill'))) return;
    ui.cat.setPose('sit');
    ui.cat.look = [-0.4, -0.7];
    const end = Date.now() + rand(9000, 15000);
    while (alive(t) && Date.now() < end) {
      await wait(rand(1800, 3500));
      if (!alive(t)) return;
      if (Math.random() < 0.45) await birdWatch(t);
      else ui.cat.look = [rand(-1, 1), rand(-0.8, -0.2)];
    }
  },
  async sofa(t) {
    if (!(await goPerch(t, 'sofa'))) return;
    ui.cat.setPose('loaf');
    ui.cat.face({ eyes: 'half' });
    await wait(rand(5000, 9000));
    if (!alive(t)) return;
    if (Math.random() < 0.5) { await offerSlowBlink(t); await wait(3000); return; }
    ui.cat.setPose('sleep', 3);
    ui.cat.face({ eyes: 'closed' });
    await wait(rand(9000, 16000));
    restFace();
  },
  async sunbeam(t) {
    const b = SPOTS.beam;
    if (!(await walk(t, b.x + rand(-60, 60), b.y + rand(-20, 20)))) return;
    ui.cat.dir *= -1;
    await wait(500);
    ui.cat.setPose('loaf', 4);
    ui.cat.face({ eyes: 'half' });
    await wait(rand(4000, 7000));
    if (!alive(t)) return;
    if (Math.random() < 0.4) {
      ui.cat.setPose('flop', 3);
      ui.cat.face({ eyes: 'closed' });
      await wait(rand(5000, 8000));
      if (!alive(t)) return;
      ui.cat.setPose('loaf', 4);
    }
    await offerSlowBlink(t);
    await wait(rand(3000, 6000));
    restFace();
  },
  async nap(t) {
    if (!(await goBed(t))) return;
    ui.cat.setPose('loaf', 3);
    ui.cat.face({ eyes: 'half' });
    await wait(1800);
    if (!alive(t)) return;
    ui.cat.setPose('sleep', 2.5);
    ui.cat.face({ eyes: 'closed' });
    ui.cat.tail = 'sleep';
    await wait(rand(14000, 26000));
    if (alive(t)) restFace();
  },
  async pounce(t) {
    await goFloor(t);
    if (!alive(t)) return;
    const c = ui.cat;
    c.setPose('crouch', 9);
    c.fx.wiggle = true;
    c.tail = 'flick';
    c.face({ pupil: 1 });
    await wait(rand(900, 1600));
    c.fx.wiggle = false;
    if (!alive(t)) return;
    const tx = clamp(c.x + c.dir * rand(110, 170), FLOOR.x0, FLOOR.x1);
    await c.jumpTo(tx, c.y, { height: 55 });
    c.swat();
    c.setPose('sit');
    if (Math.random() < 0.3) say('…I meant to do that.', 2800);
    await wait(1200);
    restFace();
  },
  async zoomies(t) {
    const c = ui.cat;
    c.face({ pupil: 1, eyes: 'wide' });
    c.tail = 'happy';
    const a = c.x < 800 ? FLOOR.x1 - 80 : FLOOR.x0 + 80;
    if (!(await walk(t, a, rand(FLOOR.y0, FLOOR.y1), { run: true }))) return;
    if (!(await walk(t, 1600 - a, rand(FLOOR.y0, FLOOR.y1), { run: true }))) return;
    c.setPose('sit');
    restFace();
    await wait(800);
  },
  async playSolo(t) {
    const b = ui.ball;
    if (!b || b.held) return;
    await chaseBall(t, { solo: true });
  },
  async askFood(t) {
    const b = SPOTS.bowl;
    const s = scaleAt(b.y);
    if (!(await walk(t, b.x + 92 * s, b.y))) return;
    ui.cat.dir = -1;
    await wait(400);
    ui.cat.setPose('sit');
    ui.cat.look = [0.6, -0.2];
    for (let i = 0; i < 2 && alive(t); i++) {
      await wait(rand(1800, 3000));
      if (!alive(t)) return;
      ui.cat.face({ mouth: 'open' });
      if (i === 0) say(speech(ui.state, Date.now(), partnerName(), (n) => Math.floor(Math.random() * n)));
      await wait(500);
      ui.cat.face({ mouth: 'w' });
    }
    await wait(rand(3000, 5000));
  },
  async mope(t) {
    if (!(await walk(t, rand(FLOOR.x0 + 60, FLOOR.x1 - 60), rand(FLOOR.y0, FLOOR.y0 + 50), { speed: 60 }))) return;
    ui.cat.dir = ui.cat.x < (ui.camX ?? 800) ? -1 : 1;
    await wait(500);
    ui.cat.setPose('lie', 3);
    ui.cat.tail = 'low';
    ui.cat.face({ eyes: 'half' });
    await wait(rand(9000, 15000));
  },
  async sickRest(t) {
    if (!(await goBed(t, { speed: 50 }))) return;
    ui.cat.setPose('lie', 2);
    ui.cat.face({ eyes: 'half' });
    ui.cat.tail = 'low';
    await wait(rand(15000, 25000));
  },
  async sleepNight(t) {
    if (!(await goBed(t, { speed: 80 }))) return;
    ui.cat.setPose('sleep', 2);
    ui.cat.face({ eyes: 'closed', pupil: NIGHT_PUPIL });
    ui.cat.tail = 'sleep';
    await wait(rand(16000, 30000));
    if (alive(t) && Math.random() < 0.3) ui.cat.earTwitch();
  },
};

function pickLife() {
  const m = mood();
  if (m === 'sleepy') return LIFE.sleepNight;
  if (m === 'sick') return LIFE.sickRest;
  const weighted = (list) => {
    let r = Math.random() * list.reduce((s, [, w]) => s + w, 0);
    for (const [fn, w] of list) { r -= w; if (r <= 0) return fn; }
    return list[0][0];
  };
  if (m === 'hungry') return weighted([[LIFE.askFood, 4], [LIFE.wander, 1], [LIFE.sitAround, 1]]);
  if (m === 'sad') return weighted([[LIFE.mope, 4], [LIFE.wander, 1], [LIFE.sitAround, 1]]);
  const bored = Date.now() - ui.lastTouch > 90000;
  const list = [[LIFE.wander, 3], [LIFE.sitAround, 3], [LIFE.groom, 2], [LIFE.stretch, 1], [LIFE.sill, 2], [LIFE.sofa, 2],
    [LIFE.pounce, 1], [LIFE.nap, bored ? 3 : 1]];
  if (ui.tod !== 'night') list.push([LIFE.sunbeam, ui.tod === 'evening' ? 1 : 2]);
  if (m === 'happy' && !reduce) list.push([LIFE.zoomies, 1], [LIFE.playSolo, 1]);
  return weighted(list);
}

async function lifeLoop() {
  for (;;) {
    await wait(rand(600, 1600));
    if (ui.view !== 'live' || !ui.cat || ui.activity || document.hidden) continue;
    const fn = pickLife();
    startActivity('life', fn);
  }
}

function talkLoop() {
  setTimeout(() => {
    const c = ui.cat;
    const sleeping = c && (c.pose === 'sleep' || c.eyes === 'closed');
    if (ui.view === 'live' && c && !sleeping && !document.hidden && ['life', null].includes(ui.activity)) {
      say(speech(ui.state, Date.now(), partnerName(), (n) => Math.floor(Math.random() * n)));
    }
    talkLoop();
  }, rand(18000, 30000));
}

/* ---------- birds outside ---------- */
async function birdWatch(token) {
  const g = document.createElementNS(NS, 'path');
  g.setAttribute('d', 'M-8 0 Q-4 -5 0 0 Q4 -5 8 0');
  g.setAttribute('class', 'bird');
  g.style.setProperty('--y', `${rand(160, 300)}px`);
  $('birds').append(g);
  setTimeout(() => g.remove(), 4200);
  ui.cat.face({ pupil: 1, eyes: 'wide' });
  ui.cat.look = [-1, -0.6];
  await wait(700);
  ui.cat.fx.chatter = true;
  ui.cat.tail = 'flick';
  ui.cat.look = [1, -0.6];
  await wait(1600);
  ui.cat.fx.chatter = false;
  if (alive(token)) { restFace(); if (Math.random() < 0.3) say('One of them looked at me. Rude.', 2800); }
}

/* ---------- touching ---------- */
function onDown(e) {
  if (ui.view !== 'live' || e.target.closest?.('.hud, .dock-wrap, .panel, .blink-back, .journal')) return;
  const w = toWorld(e.clientX, e.clientY);
  ui.lastTouch = Date.now();
  if (ui.feather.on) {
    ui.pointer = { mode: 'feather', id: e.pointerId };
    ui.feather.active = true;
    setFeatherAnchor(w);
    return;
  }
  const b = ui.ball;
  if (b && !b.carried && Math.hypot(w.x - b.x, w.y - (b.gy - b.h - BALL_R * scaleAt(b.gy))) < BALL_R * scaleAt(b.gy) + 26) {
    ui.pointer = { mode: 'ball', samples: [{ t: performance.now(), x: w.x, y: w.y }] };
    Object.assign(b, { held: true, vx: 0, vh: 0, vgy: 0 });
    b.el.classList.add('held');
    ui.scene.classList.add('grabbing');
    return;
  }
  if (ui.cat?.hit(w.x, w.y)) {
    ui.pointer = { mode: 'stroke' };
    ui.stroke = { last: { x: e.clientX, y: e.clientY }, dist: 0, purring: false, lastMove: performance.now(), since: 0 };
    return;
  }
  ui.pointer = { mode: 'tap', x: e.clientX, y: e.clientY, w };
}

function onMove(e) {
  if (ui.view !== 'live') return;
  const w = toWorld(e.clientX, e.clientY);
  ui.pointerWorld = w;
  if (ui.feather.on && (e.pointerType === 'mouse' || ui.pointer?.mode === 'feather')) {
    if (e.pointerType === 'mouse') ui.feather.active = !e.target.closest?.('.hud, .dock-wrap, .panel, .journal');
    setFeatherAnchor(w);
  }
  const p = ui.pointer;
  if (!p) return;
  if (p.mode === 'ball') {
    const b = ui.ball;
    b.x = clamp(w.x, 20, ROOM_W - 20);
    const r = BALL_R * scaleAt(b.gy);
    if (w.y + r > b.gy) b.gy = clamp(w.y + r, FLOOR.y0 - 10, FLOOR.y1 + 30);
    b.h = Math.max(0, b.gy - w.y - r);
    p.samples.push({ t: performance.now(), x: w.x, y: w.y });
    if (p.samples.length > 8) p.samples.shift();
  }
  if (p.mode === 'stroke' && ui.stroke) {
    const s = ui.stroke;
    s.dist += Math.hypot(e.clientX - s.last.x, e.clientY - s.last.y);
    s.last = { x: e.clientX, y: e.clientY };
    if (ui.cat.hit(w.x, w.y)) s.lastMove = performance.now();
    if (!s.purring && s.dist > STROKE_PX) startPurr();
  }
}

function onUp(e) {
  const p = ui.pointer;
  ui.pointer = null;
  ui.scene.classList.remove('grabbing');
  if (!p) return;
  if (p.mode === 'feather') { if (e.pointerType !== 'mouse') ui.feather.active = false; return; }
  if (p.mode === 'ball') { throwBall(p.samples); return; }
  if (p.mode === 'stroke') {
    const s = ui.stroke;
    ui.stroke = null;
    if (s?.purring) endPurr();
    else if (s && s.dist < 14) boop();
    return;
  }
  if (p.mode === 'tap' && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 12) callTo(p.w);
}

function startPurr() {
  ui.stroke.purring = true;
  startActivity('pet', async () => {
    const c = ui.cat;
    const wasAsleep = c.pose === 'sleep';
    if (c.pose === 'stand' || c.pose === 'walk' || c.pose === 'crouch') c.setPose('sit');
    if (wasAsleep) { c.setPose('loaf', 3); say(awakeLine(), 2600); }
    c.fx.purr = true;
    c.face({ eyes: 'happy', mouth: 'w' });
    c.tail = 'quiver';
    if (!wasAsleep) say(pickOne(['prrrrrr…', 'mm. yes. there.', 'I\'ll allow it.', 'prrrrrrrrr', 'a little to the left.']), 2600);
    cuddle(false);
  });
}

function endPurr() {
  const c = ui.cat;
  setTimeout(() => {
    if (ui.stroke) return;
    c.fx.purr = false;
    c.fx.knead = false;
    if (c.pose === 'knead') c.setPose('sit');
    restFace();
    if (ui.activity === 'pet') ui.activity = null;
  }, 1100);
}

async function boop() {
  const c = ui.cat;
  if (!c) return;
  ui.lastTouch = Date.now();
  if (c.pose === 'sleep') {
    startActivity('wake', async (t) => {
      c.face({ eyes: 'half' });
      say(awakeLine(), 2600);
      await wait(1200);
      if (!alive(t)) return;
      await LIFE.stretch(t);
    });
    return;
  }
  const now = Date.now();
  ui.taps = [...ui.taps.filter((t) => now - t < TAP_WINDOW_MS), now];
  if (ui.taps.length >= TAPS_FOR_FLOP) {
    ui.taps = [];
    startActivity('flop', async (t) => {
      if (mood() === 'happy' || mood() === 'okay' ? Math.random() < 0.6 : false) {
        c.setPose('flop', 6);
        c.face({ eyes: 'happy', mouth: 'open' });
        say(pickOne(['fine. belly. but only for a second.', 'this is a trap and you know it.', 'mrrrp!']), 2600);
        hearts(4);
        cuddle(true);
        await wait(2400);
        if (!alive(t)) return;
        c.setPose('sit');
      } else {
        c.setPose('sit');
        c.setPose('crouch', 12);
        c.tail = 'flick';
        c.face({ eyes: 'half' });
        await wait(250);
        c.swat();
        say(pickOne(['Enough.', 'I will remember this.', 'Hands. To yourself.']), 2400);
        await wait(1200);
      }
      restFace();
    });
    return;
  }
  c.look = [0, 0];
  const r = Math.random();
  if (r < 0.35) { c.earTwitch(); c.face({ mouth: 'open' }); say(pickOne(['mrrp?', 'mew.', 'prrt?']), 1600); setTimeout(() => c.face({ mouth: 'w' }), 450); }
  else if (r < 0.65) { c.slowBlink(); }
  else { c.earTwitch(); c.p.kt += 14; }
}

function cuddle(force) {
  if (!force && Date.now() - ui.lastPetPing < PET_PING_MS) return;
  ui.lastPetPing = Date.now();
  send('pet');
}

// Tap the floor: "come here". Cats come most of the time.
function callTo(w) {
  const c = ui.cat;
  if (!c || w.y < FLOOR.y0 - 80) return;
  startActivity('call', async (t) => {
    if (c.pose === 'sleep') { c.face({ eyes: 'half' }); say(awakeLine(), 2400); await wait(1400); if (!alive(t)) return; }
    if (Math.random() < 0.18 && mood() === 'okay') {
      c.look = [0, 0];
      c.slowBlink();
      say(pickOne(['Later.', 'I heard you. I\'m choosing not to.', 'Maybe.']), 2400);
      await wait(2400);
      return;
    }
    c.face({ eyes: 'open', pupil: 0.6 });
    if (!(await walk(t, w.x, w.y, { speed: mood() === 'happy' ? 170 : 120 }))) return;
    c.setPose('sit');
    c.look = [0, 0];
    if (Math.random() < 0.4) say(pickOne(['You called?', 'Here. What is it.', 'mrrp.']), 2200);
    await wait(2500);
    restFace();
  });
}

/* ---------- the ball ---------- */
function makeBall() {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'yarn-ball');
  g.innerHTML = `<g class="yarn-body"><circle r="${BALL_R}" class="yarn" />
    <path class="yarn-lines" d="M-14 -4 Q0 -14 14 -4 M-13 4 Q0 -6 13 6 M-10 10 Q0 2 9 12 M-6 -14 Q4 -2 -2 14 M5 -14 Q12 0 6 14" />
    <path class="yarn-tail" d="M12 8 Q22 16 30 12 Q38 8 44 14" /></g>`;
  const shadow = document.createElementNS(NS, 'ellipse');
  shadow.setAttribute('class', 'prop-shadow');
  $('props-back').prepend(shadow);
  ui.ball = { x: 1010, gy: 812, h: 0, vx: 0, vgy: 0, vh: 0, spin: 0, held: false, carried: false, el: g, shadow, thrownAt: 0 };
  $('props-back').append(g);
}

function throwBall(samples) {
  const b = ui.ball;
  b.held = false;
  b.el.classList.remove('held');
  const now = performance.now();
  const recent = samples.filter((s) => now - s.t < 120);
  if (recent.length >= 2) {
    const a = recent[0];
    const z = recent[recent.length - 1];
    const dt = Math.max(0.016, (z.t - a.t) / 1000);
    b.vx = clamp((z.x - a.x) / dt, -1700, 1700);
    b.vh = clamp(-(z.y - a.y) / dt, -600, 1500);
    b.vgy = rand(-50, 50);
  }
  const speed = Math.hypot(b.vx, b.vh);
  if (speed > 140 || b.h > 30) {
    b.thrownAt = Date.now();
    if (ui.cat && mood() !== 'sick') startActivity('chase', (t) => chaseBall(t, {}));
  }
}

function stepBall(dt) {
  const b = ui.ball;
  if (!b) return;
  if (b.carried && ui.cat) {
    const m = ui.cat.mouthPoint();
    b.x = m.x; b.gy = ui.cat.y + 3; b.h = Math.max(0, b.gy - m.y - BALL_R * scaleAt(b.gy) * 0.7);
  } else if (!b.held) {
    if (b.h > 0 || b.vh > 0) {
      b.vh -= GRAVITY * dt;
      b.h += b.vh * dt;
      if (b.h <= 0) {
        b.h = 0;
        if (b.vh < -170) { b.vh *= -0.42; b.vx *= 0.82; } else b.vh = 0;
      }
    }
    b.x += b.vx * dt;
    b.gy += b.vgy * dt;
    const ground = b.h <= 0.01;
    b.vx *= Math.exp(-dt * (ground ? 1.5 : 0.15));
    b.vgy *= Math.exp(-dt * (ground ? 2.6 : 0.3));
    if (b.x < 20) { b.x = 20; b.vx = Math.abs(b.vx) * 0.55; }
    if (b.x > ROOM_W - 20) { b.x = ROOM_W - 20; b.vx = -Math.abs(b.vx) * 0.55; }
    if (b.gy < FLOOR.y0 - 10) { b.gy = FLOOR.y0 - 10; b.vgy = Math.abs(b.vgy) * 0.4; }
    if (b.gy > FLOOR.y1 + 30) { b.gy = FLOOR.y1 + 30; b.vgy = -Math.abs(b.vgy) * 0.4; }
  }
  const s = scaleAt(b.gy);
  b.spin += (b.vx * dt) / (BALL_R * s) * 57.3;
  b.el.setAttribute('transform', `translate(${b.x.toFixed(1)} ${(b.gy - b.h - BALL_R * s).toFixed(1)}) scale(${s.toFixed(3)})`);
  b.el.firstElementChild.setAttribute('transform', `rotate(${(b.spin % 360).toFixed(1)})`);
  b.shadow.setAttribute('cx', b.x.toFixed(1));
  b.shadow.setAttribute('cy', b.gy.toFixed(1));
  b.shadow.setAttribute('rx', (BALL_R * s * (1.1 - Math.min(0.6, b.h / 400))).toFixed(1));
  b.shadow.setAttribute('ry', (4 * s).toFixed(1));
  b.shadow.style.opacity = String(1 - Math.min(0.75, b.h / 300));
  sortProp(b.el, b.held || b.carried ? Infinity : b.gy);
}

const ballMoving = (b) => b.h > 1 || Math.abs(b.vx) > 8 || Math.abs(b.vgy) > 8;

async function chaseBall(token, { solo = false }) {
  const c = ui.cat;
  const b = ui.ball;
  const sleepy = mood() === 'sleepy';
  if (c.pose === 'sleep' && !solo) { c.face({ eyes: 'half' }); await wait(700); if (!alive(token)) return; }
  if (sleepy && !solo && Math.random() < 0.5) { c.look = [b.x > c.x ? 1 : -1, 0]; say('It\'s the middle of the night.', 2600); return; }
  await goFloor(token);
  c.face({ eyes: 'wide', pupil: 1 });
  c.tail = 'flick';
  const tired = left('play') === 0 && !solo;
  let counted = solo;
  let bats = 0;
  const start = Date.now();
  while (alive(token) && Date.now() - start < 16000) {
    if (b.held) { c.stop(); c.setPose('crouch'); c.look = [b.x > c.x ? 1 : -1, -0.5]; await wait(150); continue; }
    const s = scaleAt(b.gy);
    const side = c.x < b.x ? -1 : 1;
    const tx = clamp(b.x + side * 70 * s + b.vx * 0.25, FLOOR.x0, FLOOR.x1);
    const ty = clamp(b.gy, FLOOR.y0, FLOOR.y1);
    const near = Math.abs(c.x - (b.x + side * 70 * s)) < 34 * s && Math.abs(c.y - ty) < 30;
    if (!near) {
      if (!c.move) c.walkTo(tx, ty, { run: !sleepy && !tired, speed: tired ? 90 : undefined });
      else { c.move.x = tx; c.move.y = ty; }
      await wait(120);
      continue;
    }
    if (b.h > 40) { c.stop(); c.setPose('crouch'); await wait(120); continue; }
    c.stop();
    c.dir = -side;
    if (!counted) {
      counted = true;
      const applied = await send('play');
      if (!applied && !solo) {
        c.setPose('lie', 3);
        c.tail = 'calm';
        c.face({ eyes: 'half', pupil: defaultPupil() });
        say(pickOne(['I\'m all played out for today.', 'You throw it. I\'ll watch.', 'tomorrow. I promise.']), 3000);
        return;
      }
    }
    if (bats < (solo ? 2 : 1 + Math.floor(Math.random() * 2))) {
      c.setPose('crouch', 14);
      c.fx.wiggle = true;
      await wait(rand(250, 600));
      c.fx.wiggle = false;
      if (!alive(token) || b.held) continue;
      c.swat();
      await wait(110);
      Object.assign(b, { vx: c.dir * rand(260, 560), vh: rand(120, 300), vgy: rand(-70, 70) });
      bats++;
      continue;
    }
    if (solo) break;
    // fetch: carry it back towards you and drop it
    b.carried = true;
    c.face({ eyes: 'open' });
    c.tail = 'happy';
    const back = floorPoint((ui.camX ?? 800) + rand(-80, 80), FLOOR.y1 - 6);
    await c.walkTo(back.x, back.y, { speed: 150 });
    b.carried = false;
    Object.assign(b, { vx: c.dir * 40, vh: 60, vgy: 30 });
    if (!alive(token)) return;
    c.setPose('sit');
    c.look = [0, 0];
    say(pickOne(['Again.', 'I brought it back. Your move.', 'mrrp! again?', 'I am very fast.']), 2600);
    hearts(2);
    await wait(1800);
    break;
  }
  b.carried = false;
  if (alive(token)) restFace();
}

/* ---------- food ---------- */
const FOOD_ART = {
  fish: '<ellipse cx="-4" cy="-9" rx="24" ry="9" fill="#a9bdcc" /><path d="M17 -9 L33 -19 L30 -9 L33 1 Z" fill="#8ba2b5" /><path d="M-20 -12 Q-4 -18 12 -12" stroke="#e1eaf0" stroke-width="2" fill="none" /><path d="M-12 -9 Q-4 -4 6 -8" stroke="#8ba2b5" stroke-width="1.6" fill="none" /><circle cx="-18" cy="-11" r="2" fill="#26313b" />',
  tuna: '<path d="M-20 -14 V-2 Q0 4 20 -2 V-14 Z" fill="#cfd3d9" /><path d="M-20 -8 Q0 -2 20 -8" stroke="#3d6ea8" stroke-width="5" fill="none" /><ellipse cx="0" cy="-14" rx="20" ry="6" fill="#eaa5a1" /><ellipse cx="0" cy="-14" rx="20" ry="6" fill="none" stroke="#9aa0a8" stroke-width="2" /><path d="M-8 -15 Q0 -12 8 -16" stroke="#d98a85" stroke-width="2" fill="none" />',
  salmon: '<path d="M-24 -2 Q-26 -17 -6 -19 Q18 -21 24 -6 Q22 0 -24 -2 Z" fill="#f0905f" /><path d="M-16 -6 Q-12 -14 -6 -17 M-4 -5 Q0 -13 6 -17 M8 -5 Q12 -11 16 -13" stroke="#ffd9c4" stroke-width="2.4" fill="none" /><path d="M-24 -2 Q0 2 24 -6" stroke="#c8673f" stroke-width="2" fill="none" />',
  treat: '<g transform="rotate(-14)"><rect x="-26" y="-11" width="52" height="11" rx="4" fill="#8f7ad8" /><rect x="18" y="-11" width="9" height="11" rx="2" fill="#c5b8f4" /><path d="M-18 -6 H10" stroke="#fff" stroke-width="2" opacity=".7" /><circle cx="-22" cy="-5.5" r="2" fill="#f4c445" /></g>',
};
const foodIcon = (kind) => `<svg viewBox="-34 -30 68 40" aria-hidden="true">${FOOD_ART[kind]}</svg>`;

// Drop food at a room point: it falls to the floor (or into the bowl) and the cat comes over.
function placeFood(kind, w) {
  const bowl = SPOTS.bowl;
  let x = clamp(w.x, FLOOR.x0, FLOOR.x1);
  let gy = clamp(w.y < FLOOR.y0 ? w.y + 140 : w.y, FLOOR.y0, FLOOR.y1);
  let inBowl = false;
  if (Math.hypot(w.x - bowl.x, Math.min(0, w.y - bowl.y) * 0.5) < 90 && w.y > 600) { x = bowl.x; gy = bowl.y + 2; inBowl = true; }
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'food-item');
  g.innerHTML = `<g class="food-art">${FOOD_ART[kind]}</g>`;
  const shadow = document.createElementNS(NS, 'ellipse');
  shadow.setAttribute('class', 'prop-shadow');
  $('props-back').prepend(shadow);
  const food = { id: Math.random(), kind, x, gy, h: Math.max(30, gy - w.y), vh: 0, bite: 0, state: 'fresh', inBowl, el: g, shadow, fadeAt: 0 };
  ui.foods.push(food);
  $('props-back').append(g);
  stepFood(food, 0);
  if (ui.cat && !['eat'].includes(ui.activity)) startActivity('eat', (t) => eat(t, food));
  return food;
}

function stepFood(f, dt) {
  if (f.h > 0) { f.vh -= GRAVITY * dt; f.h = Math.max(0, f.h + f.vh * dt); if (f.h === 0 && f.vh < -200) { f.vh *= -0.25; f.h = 0.1; } }
  if (f.state === 'eating') f.bite = Math.min(1, f.bite + dt / 3.2);
  if (f.fadeAt && performance.now() > f.fadeAt) f.bite = Math.min(1, f.bite + dt / 1.5);
  const s = scaleAt(f.gy) * (f.inBowl ? 1.1 : 1.35);
  const k = 1 - f.bite * 0.75;
  f.el.setAttribute('transform', `translate(${f.x.toFixed(1)} ${(f.gy - f.h - (f.inBowl ? 6 : 0)).toFixed(1)}) scale(${(s * k).toFixed(3)})`);
  f.el.style.opacity = String(1 - f.bite * 0.9);
  f.shadow.setAttribute('cx', f.x.toFixed(1));
  f.shadow.setAttribute('cy', f.gy.toFixed(1));
  f.shadow.setAttribute('rx', (26 * s * k).toFixed(1));
  f.shadow.setAttribute('ry', (4 * s).toFixed(1));
  f.shadow.style.opacity = f.inBowl ? '0' : String(1 - f.bite);
  sortProp(f.el, f.gy);
  if (f.bite >= 1) removeFood(f);
}

function removeFood(f) {
  f.el.remove();
  f.shadow.remove();
  ui.foods = ui.foods.filter((x) => x !== f);
}

async function eat(token, food, { free = false } = {}) {
  const c = ui.cat;
  if (c.pose === 'sleep') { c.face({ eyes: 'half' }); await wait(700); }
  c.face({ eyes: 'open', pupil: 0.8 });
  c.tail = 'happy';
  await wait(food.h > 0 ? 450 : 150);
  if (!alive(token)) return;
  const s = scaleAt(food.gy);
  let side = c.x < food.x ? -1 : 1;
  let tx = food.x + side * 88 * s;
  if (tx < FLOOR.x0 || tx > FLOOR.x1) { side = -side; tx = food.x + side * 88 * s; }
  if (!(await walk(token, tx, food.gy, { run: mood() === 'hungry', speed: mood() === 'hungry' ? undefined : 170 }))) return;
  c.dir = -side;
  await wait(260);
  if (!alive(token) || !ui.foods.includes(food)) return;
  c.setPose('eat', 8);
  await wait(350);
  const applied = free || (await send('feed'));
  if (!alive(token)) return;
  if (applied) {
    food.state = 'eating';
    c.fx.eat = true;
    c.face({ eyes: 'half' });
    await wait(3300);
    c.fx.eat = false;
    if (ui.foods.includes(food)) food.bite = 1;
    if (!alive(token)) return;
    c.setPose('sit');
    c.face({ eyes: 'happy', mouth: 'tongue' });
    await wait(900);
    c.face({ eyes: 'open', mouth: 'w' });
    say(FOODS.find((x) => x.kind === food.kind)?.line ?? 'Thank you.', 3200);
    hearts(3);
    await wait(1600);
    if (alive(token) && Math.random() < 0.6) await LIFE.groom(token);
  } else {
    c.face({ eyes: 'half' });
    await wait(1000);
    if (!alive(token)) return;
    food.state = 'refused';
    food.fadeAt = performance.now() + 22000;
    c.setPose('stand');
    c.dir = side;
    say(pickOne(['I\'m full. I am, however, open to compliments.', 'Not hungry. Save it for later.', 'I couldn\'t possibly. (I could. But I won\'t.)']), 3200);
    await wait(1200);
  }
  restFace();
}

/* ---------- feather wand ---------- */
function setFeatherAnchor(w) { ui.feather.ax = w.x; ui.feather.ay = w.y; }

function stepFeather(dt) {
  const f = ui.feather;
  const g = $('feather');
  if (!g) return;
  g.style.opacity = f.on && f.active ? '1' : '0';
  if (!f.on || !f.active) { f.px = f.ax; f.py = f.ay + FEATHER_LEN; f.vx = 0; f.vy = 0; return; }
  if (f.pinned > 0 && ui.cat) {
    f.pinned -= dt;
    const p = ui.cat.local(ui.cat.p.fnx + 6, -6);
    f.px = p.x; f.py = p.y; f.vx = 0; f.vy = 0;
  } else {
    f.vy += 1500 * dt;
    f.px += f.vx * dt; f.py += f.vy * dt;
    const dx = f.px - f.ax;
    const dy = f.py - f.ay;
    const d = Math.hypot(dx, dy);
    if (d > FEATHER_LEN) {
      const nx = dx / d; const ny = dy / d;
      f.px = f.ax + nx * FEATHER_LEN; f.py = f.ay + ny * FEATHER_LEN;
      const vr = f.vx * nx + f.vy * ny;
      if (vr > 0) { f.vx -= vr * nx; f.vy -= vr * ny; }
    }
    f.vx *= Math.exp(-dt * 1.4); f.vy *= Math.exp(-dt * 1.4);
  }
  const s = scaleAt(clamp(f.py + 30, FLOOR.y0, FLOOR.y1)) * 1.6;
  const mx = (f.ax + f.px) / 2 + f.vx * 0.02;
  const my = Math.max(f.ay, f.py) - 10;
  g.querySelector('.string').setAttribute('d', `M${f.ax.toFixed(1)} ${f.ay.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${f.px.toFixed(1)} ${f.py.toFixed(1)}`);
  g.querySelector('.rod').setAttribute('d', `M${f.ax.toFixed(1)} ${f.ay.toFixed(1)} L${(f.ax + 120).toFixed(1)} ${(f.ay - 260).toFixed(1)}`);
  const ang = clamp(f.vx * 0.04, -50, 50);
  g.querySelector('.plume').setAttribute('transform', `translate(${f.px.toFixed(1)} ${f.py.toFixed(1)}) rotate(${ang.toFixed(1)}) scale(${s.toFixed(3)})`);
}

async function hunt(token) {
  const c = ui.cat;
  const f = ui.feather;
  await goFloor(token);
  let lastCatch = 0;
  while (alive(token) && f.on) {
    if (!f.active) { if (!c.move) { c.setPose('sit'); c.tail = 'calm'; } await wait(250); continue; }
    c.face({ pupil: 1 });
    c.look = [clamp((f.px - c.x) / 300, -1, 1) * c.dir, clamp((f.py - c.y + 120) / 300, -1, 1)];
    const gy = clamp(f.py + 40, FLOOR.y0, FLOOR.y1);
    const dx = f.px - c.x;
    if (f.py < 560) {
      if (Math.abs(dx) > 120 * c.s) { const p = floorPoint(f.px - Math.sign(dx) * 60 * c.s, gy); if (!c.move) c.walkTo(p.x, p.y, { speed: 200 }); else { c.move.x = p.x; c.move.y = p.y; } }
      else { c.stop(); c.setPose('sit'); if (Math.random() < 0.06) c.swat(true); }
      await wait(140);
      continue;
    }
    if (Math.abs(dx) > 280 * c.s || Math.abs(gy - c.y) > 70) {
      const p = floorPoint(f.px - Math.sign(dx) * 170 * c.s, gy);
      if (!c.move) c.walkTo(p.x, p.y, { run: true }); else { c.move.x = p.x; c.move.y = p.y; }
      await wait(140);
      continue;
    }
    c.stop();
    if (Math.abs(dx) > 10) c.dir = Math.sign(dx);
    c.setPose('crouch', 12);
    c.fx.wiggle = true;
    c.tail = 'flick';
    await wait(rand(450, 1000));
    c.fx.wiggle = false;
    if (!alive(token) || !f.on || !f.active) continue;
    const t = floorPoint(f.px - c.dir * 55 * c.s, clamp(f.py + 40, FLOOR.y0, FLOOR.y1));
    await c.jumpTo(t.x, t.y, { height: clamp(t.y - f.py, 30, 140) });
    c.swat(f.py < c.y - 110 * c.s);
    const paw = c.local(c.p.fnx + 30, -40);
    if (Math.hypot(f.px - paw.x, f.py - paw.y) < 120 * c.s) {
      f.pinned = 0.8;
      hearts(1);
      if (Date.now() - lastCatch > 5000) {
        lastCatch = Date.now();
        const applied = await send('play');
        if (!applied && Math.random() < 0.4) say('I could do this all day. (I can\'t. I\'m tired.)', 2800);
        else if (Math.random() < 0.35) say(pickOne(['Got it!', 'Mine.', 'The bird is defeated.']), 1800);
      }
    }
    c.setPose('crouch', 10);
    await wait(rand(300, 700));
  }
  c.fx.wiggle = false;
  if (alive(token)) restFace();
}

function setFeather(on) {
  ui.feather.on = on;
  ui.feather.active = on && matchMedia('(pointer: fine)').matches && Boolean(ui.pointerWorld);
  $('feather-btn').setAttribute('aria-pressed', String(on));
  ui.scene.classList.toggle('feathering', on);
  hint(on ? 'Dangle the feather near the floor, then hold still…' : null);
  if (on && ui.cat) startActivity('hunt', hunt);
  else if (ui.activity === 'hunt') ++ui.run && (ui.activity = null);
}

/* ---------- depth sorting ---------- */
function sortProp(el, gy) {
  const front = !ui.cat || gy > ui.cat.y + 2;
  const parent = $(front ? 'props-front' : 'props-back');
  if (el.parentNode !== parent) parent.append(el);
}

/* ---------- talking to the database ---------- */
async function send(kind) {
  const before = ui.state?.today?.[kind] ?? 0;
  try {
    ui.state = await api.act(kind);
    const applied = (ui.state.today?.[kind] ?? 0) > before;
    if (applied) { ui.live?.ping(); track('pet_action', { kind }); }
    renderHud();
    return applied;
  } catch (e) {
    reportError(e, `pet-${kind}`);
    return false;
  }
}

/* ---------- the egg ---------- */
function eggArt(key, id) {
  const e = coatOf(key).egg;
  const shell = 'M0 -64 C27 -64 46 -22 46 5 C46 31 26 46 0 46 C-26 46 -46 31 -46 5 C-46 -22 -27 -64 0 -64 Z';
  let deco;
  if (e.split) deco = `<path d="M-46 5 C-46 31 -26 46 0 46 C26 46 46 31 46 5 C32 12 18 -4 0 8 C-18 -4 -32 12 -46 5 Z" fill="${e.spot}" /><path d="M-10 -18 L0 -4 L10 -18" stroke="${e.spot}" stroke-width="5" fill="none" stroke-linejoin="round" />`;
  else if (e.stripes) deco = `<path d="M-40 -18 Q-20 -10 -30 6 M-44 14 Q-24 18 -34 34 M40 -18 Q20 -10 30 6 M44 14 Q24 18 34 34 M-10 -60 Q0 -46 10 -60 M-18 -34 Q0 -24 18 -34" stroke="${e.spot}" stroke-width="7" fill="none" stroke-linecap="round" />`;
  else deco = [[-18, -30, 7], [14, -12, 9], [-6, 18, 6], [22, 22, 5], [-28, 6, 4], [6, -44, 5], [-22, 32, 4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${e.spot}" />`).join('');
  return `<defs><radialGradient id="eg-${id}" cx=".38" cy=".3" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".45" /><stop offset=".5" stop-color="#fff" stop-opacity="0" />
      <stop offset="1" stop-color="#000" stop-opacity=".28" /></radialGradient>
      <clipPath id="ec-${id}"><path d="${shell}" /></clipPath></defs>
    <g clip-path="url(#ec-${id})"><path d="${shell}" fill="${e.shell}" />${deco}<path d="${shell}" fill="url(#eg-${id})" /></g>`;
}

function showEggInRoom() {
  const t = $('toys');
  t.querySelector('.room-egg')?.remove();
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'room-egg');
  const s = scaleAt(SPOTS.door.y) * 1.25;
  g.setAttribute('transform', `translate(${SPOTS.door.x} ${SPOTS.door.y - 18}) scale(${s.toFixed(3)})`);
  const crack = 'M-60 -6 L-40 4 L-24 -10 L-8 4 L8 -10 L24 4 L40 -10 L60 -4';
  g.innerHTML = `<ellipse cx="0" cy="44" rx="74" ry="16" fill="url(#g-contact)" />
    <ellipse cx="0" cy="40" rx="64" ry="20" fill="#b56f72" /><ellipse cx="0" cy="34" rx="58" ry="15" fill="#c98386" /><circle cx="0" cy="34" r="3" fill="#8f4f52" />
    <g class="egg-wobble">
      <defs><clipPath id="egg-top"><path d="M-70 -90 H70 V-4 L40 -10 L24 4 L8 -10 L-8 4 L-24 -10 L-40 4 L-70 -6 Z" /></clipPath>
        <clipPath id="egg-bottom"><path d="M-70 -6 L-40 4 L-24 -10 L-8 4 L8 -10 L24 4 L40 -10 L70 -4 V70 H-70 Z" /></clipPath></defs>
      <g class="egg-bottom" clip-path="url(#egg-bottom)">${eggArt(ui.eggCoat, 'b')}</g>
      <g class="egg-top" clip-path="url(#egg-top)">${eggArt(ui.eggCoat, 't')}</g>
      <path class="egg-crack" d="${crack}" />
    </g>`;
  t.append(g);
  ui.egg = g;
}

function renderAdopt() {
  ui.view = 'adopt';
  setViews();
  ui.cat?.layer && (ui.cat.layer.innerHTML = '');
  ui.cat = null;
  bedFront(false);
  showEggInRoom();
  const graves = ui.state.graves ?? [];
  $('adopt-intro').textContent = graves.length
    ? `${graves[0].name} would want you to try again. Pick an egg; the kitten inside takes after its shell.`
    : 'Six eggs turned up on your doorstep, warm and wobbly. Pick one; the kitten inside takes after its shell.';
  $('eggs').innerHTML = Object.entries(COATS).map(([k, c]) => `<button type="button" class="egg-pick ${k === ui.eggCoat ? 'on' : ''}" data-coat="${k}"
    aria-pressed="${k === ui.eggCoat}" aria-label="${c.label} egg"><svg viewBox="-52 -70 104 122" aria-hidden="true">${eggArt(k, `p-${k}`)}</svg><span>${c.label}</span></button>`).join('');
  $('name-ideas').innerHTML = NAMES.slice(0, 6).map((n) => `<button type="button" class="chip" data-name="${n}">${n}</button>`).join('');
  $('adopt-name').value = ui.eggName;
  $('adopt-error').textContent = '';
}

async function hatch() {
  const name = $('adopt-name').value.trim();
  if (!name) { $('adopt-error').textContent = 'Give them a name first'; $('adopt-name').focus(); return; }
  const btn = $('hatch-btn');
  btn.disabled = true;
  btn.textContent = 'Hatching…';
  let state;
  try {
    state = await api.adopt(name, ui.eggCoat);
  } catch (e) {
    reportError(e, 'pet-adopt');
    $('adopt-error').textContent = e.message?.includes('partner') ? 'Your partner needs to join first' : e.message || 'Couldn’t hatch. Try again?';
    btn.disabled = false;
    btn.textContent = 'Hatch';
    return;
  }
  $('adopt').hidden = true;
  const egg = ui.egg;
  egg.classList.add('cracking');
  await wait(reduce ? 200 : 1500);
  egg.classList.add('hatched');
  ui.state = state;
  ui.live?.ping();
  track('pet_hatched', { coat: ui.eggCoat, again: (state.graves ?? []).length > 0 });
  // the kitten tumbles out
  const d = SPOTS.door;
  makeCat(d.x, d.y - 4);
  ui.cat.size = 0.35;
  ui.cat.setPose('loaf', 20);
  ui.cat.face({ eyes: 'closed' });
  ui.view = 'live';
  const grow = performance.now();
  const growStep = (now) => {
    const u = Math.min(1, (now - grow) / 700);
    ui.cat.size = 0.35 + 0.65 * (1 - (1 - u) ** 3) + Math.sin(u * Math.PI) * 0.08;
    if (u < 1) requestAnimationFrame(growStep); else ui.cat.size = 1;
  };
  requestAnimationFrame(growStep);
  await wait(700);
  setTimeout(() => egg.remove(), 900);
  setViews();
  renderHud();
  renderJournal();
  ui.cat.face({ eyes: 'wide', pupil: 1 });
  ui.cat.earTwitch();
  await wait(600);
  startActivity('hello', async (t) => {
    ui.cat.setPose('stand');
    await wait(500);
    await walk(t, d.x + 40, FLOOR.y1 - 10, { speed: 90 });
    ui.cat.setPose('sit');
    ui.cat.face({ mouth: 'open' });
    say(`mew. I'm ${name}. I live here now.`, 5000);
    hearts(5);
    await wait(600);
    ui.cat.face({ mouth: 'w' });
    await wait(2500);
  });
}

/* ---------- views ---------- */
function makeCat(x, y) {
  const p = pet();
  ui.cat = new Cat($('cat-layer'), { coat: coatOf(p?.colour ?? ui.eggCoat), scaleAt });
  ui.cat.x = x; ui.cat.y = y; ui.cat.s = scaleAt(y);
  ui.cat.face({ pupil: defaultPupil() });
}

function setViews() {
  const v = ui.view;
  $('hud-name').hidden = v !== 'live' && v !== 'dead';
  $('vitals').hidden = v !== 'live';
  $('dock-wrap').hidden = v !== 'live';
  $('adopt').hidden = v !== 'adopt';
  $('goodbye').hidden = v !== 'dead';
  ui.scene.classList.toggle('mourning', v === 'dead');
  if (ui.ball) { ui.ball.el.style.display = v === 'live' ? '' : 'none'; ui.ball.shadow.style.display = v === 'live' ? '' : 'none'; }
}

function renderLive(fresh) {
  ui.view = 'live';
  setViews();
  ui.egg?.remove();
  if (!ui.cat || fresh) {
    const start = mood() === 'sleepy' ? SPOTS.bed : { x: rand(500, 1100), y: rand(FLOOR.y0 + 20, FLOOR.y1 - 20) };
    makeCat(start.x, start.y);
    if (mood() === 'sleepy') { ui.cat.spot = 'bed'; bedFront(true); ui.cat.setPose('sleep', 30); ui.cat.face({ eyes: 'closed' }); }
  }
  ui.cat.setCoat(coatOf(pet().colour));
  ui.cat.el.root.classList.remove('ghost');
  $('props-front').before($('cat-layer'));
  renderHud();
  renderJournal();
}

function renderDead() {
  ui.view = 'dead';
  setViews();
  ui.egg?.remove();
  for (const f of [...ui.foods]) removeFood(f);
  const p = pet();
  const sill = SPOTS.sill;
  makeCat(sill.x, sill.y);
  Object.assign(ui.cat, { spot: 'sill', s: sill.s });
  ui.cat.el.root.classList.add('ghost');
  ui.svg.append($('cat-layer')); // above the night tint, so the ghost glows
  ui.cat.setPose('sit', 30);
  ui.cat.face({ eyes: 'closed' });
  ui.cat.tail = 'sleep';
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  $('goodbye').innerHTML = `<h2>${esc(p.name)} waited for you</h2>
    <p class="muted">${fmt(p.born_at)} – ${fmt(p.died_at)} · ${ageLabel(p.born_at, Date.parse(p.died_at))}</p>
    <p>Nobody came by for a week, so ${esc(p.name)} went looking for a warmer windowsill. A cat needs a visit, a meal or a game at least once a week.</p>
    <button class="btn-soft" data-action="new-egg" type="button">Find a new egg</button>`;
  renderHud();
  renderJournal();
}

function vital(key, label, v) {
  const low = v < 25 ? 'low' : v < 50 ? 'mid' : '';
  return `<div class="vital ${low}"><span class="v-label">${label}</span>
    <span class="v-bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v)}"><i style="width:${v}%"></i></span>
    <span class="v-word">${meterWord(key, v)}</span></div>`;
}

function renderHud() {
  const p = pet();
  if (!p) return;
  const dead = Boolean(p.died_at);
  $('pet-name').textContent = p.name;
  $('pet-sub').textContent = dead ? 'remembered' : ageLabel(p.born_at, Date.now());
  $('vitals').innerHTML = dead ? '' : vital('health', 'Health', p.health) + vital('hunger', 'Fed', p.hunger) + vital('happiness', 'Happy', p.happiness);
  $('food-left').textContent = left('feed') ? `${left('feed')} meal${left('feed') === 1 ? '' : 's'} left today` : 'full for today';
  $('play-left').textContent = left('play') ? `${left('play')} games left` : 'played out';
}

function renderJournal() {
  const p = pet();
  const today = istDay(Date.now());
  const last = ui.state?.last ?? {};
  $('j-name').textContent = p?.name ?? 'your cat';
  $('j-toys').innerHTML = TOYS.map((t) => {
    const done = last[t.kind] && istDay(Date.parse(last[t.kind])) === today;
    return `<a class="j-toy ${done ? 'done' : ''}" href="${BASE}${t.slug}/">${t.label}<span>${done ? 'played today' : 'not yet'}</span></a>`;
  }).join('');
  const rows = diary(ui.state?.events ?? []);
  $('j-diary').innerHTML = rows.length && p ? rows.map((e) => `<li><span>${eventText(e, whoOf, esc(p.name))}${e.n > 1 ? ` <b>×${e.n}</b>` : ''}</span><time>${agoShort(e.at)}</time></li>`).join('')
    : '<li class="muted">Nothing yet.</li>';
  const graves = ui.state?.graves ?? [];
  $('j-memorial').hidden = !graves.length;
  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  $('j-graves').innerHTML = graves.map((g) => `<li><b>${esc(g.name)}</b> <span class="muted">${coatOf(g.colour).label} · ${fmt(g.born_at)} – ${fmt(g.died_at)}</span></li>`).join('');
}

function agoShort(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
}

let hintTimer;
function hint(text) {
  const el = $('hint');
  const name = pet()?.name ?? 'the cat';
  el.textContent = text ?? `Drag food onto the floor · pick up the yarn and throw it · stroke ${name} to hear a purr`;
  el.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => el.classList.remove('show'), text ? 6000 : 9000);
}

/* ---------- dragging food out of the pantry ---------- */
function onPantryDown(e) {
  const btn = e.target.closest?.('[data-food]');
  if (!btn || ui.view !== 'live') return;
  e.preventDefault();
  ui.drag = { kind: btn.dataset.food, x: e.clientX, y: e.clientY, moved: false };
  const g = $('drag-ghost');
  g.innerHTML = foodIcon(ui.drag.kind);
  g.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  window.addEventListener('pointermove', onPantryMove);
  window.addEventListener('pointerup', onPantryUp, { once: true });
}
function onPantryMove(e) {
  const d = ui.drag;
  if (!d) return;
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) { d.moved = true; $('drag-ghost').hidden = false; }
  $('drag-ghost').style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
}
function onPantryUp(e) {
  window.removeEventListener('pointermove', onPantryMove);
  const d = ui.drag;
  ui.drag = null;
  $('drag-ghost').hidden = true;
  if (!d) return;
  ui.lastTouch = Date.now();
  if (!d.moved) { placeFood(d.kind, { x: SPOTS.bowl.x, y: SPOTS.bowl.y - 120 }); return; } // a tap fills the bowl
  const over = document.elementFromPoint(e.clientX, e.clientY);
  if (!over?.closest('#room-host')) return;
  placeFood(d.kind, toWorld(e.clientX, e.clientY));
}

/* ---------- the frame loop ---------- */
let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  const c = ui.cat;
  if (c) {
    // eyes follow you when nothing else has its attention
    const free = ['life', null, 'pet', 'call'].includes(ui.activity) && c.pose !== 'sleep' && c.eyes !== 'closed';
    if (free && ui.pointerWorld && ui.view === 'live' && Date.now() - ui.lastTouch < 15000) {
      const h = c.headPoint();
      c.look = [clamp(((ui.pointerWorld.x - h.x) / 320) * c.dir, -1, 1), clamp((ui.pointerWorld.y - h.y - 40) / 300, -1, 1)];
    }
    if (ui.view === 'dead') c.lift = 14 + Math.sin(now / 900) * 8;
    c.update(dt, now / 1000);
    if (ui.stroke?.purring) {
      ui.stroke.since += dt;
      const stroking = now - ui.stroke.lastMove < 900;
      if (stroking && now - ui.heartAt > 700) { ui.heartAt = now; const h = c.headPoint(); fx('♥', h.x, h.y + 24, 'heart'); }
      if (ui.stroke.since > 2.4 && stroking && (c.pose === 'sit' || c.pose === 'knead')) { c.setPose('knead'); c.fx.knead = true; }
      if (!stroking) c.fx.knead = false;
      if (stroking && ui.stroke.since > 8 && Date.now() - ui.lastPetPing > PET_PING_MS) cuddle(false);
    }
    if (c.pose === 'sleep' && now - ui.zzzAt > 2600 && ui.view === 'live') { ui.zzzAt = now; const h = c.headPoint(); fx('z', h.x + 30 * c.dir, h.y + 10, 'zzz'); }
  }
  stepBall(dt);
  for (const f of [...ui.foods]) stepFood(f, dt);
  stepFeather(dt);
  camera(dt);
  // caption over the head
  const cap = $('caption');
  if (c && cap.classList.contains('show')) {
    const h = toScene(c.headPoint().x, c.headPoint().y);
    const w = ui.scene.clientWidth;
    cap.style.left = `${clamp(h.x, 130, w - 130)}px`;
    cap.style.top = `${Math.max(90, h.y - 8)}px`;
    if (now > ui.captionUntil) cap.classList.remove('show');
  }
  const bb = $('blink-back');
  if (c && !bb.hidden) {
    const h = toScene(c.headPoint().x, c.headPoint().y + 40);
    bb.style.left = `${clamp(h.x + 90, 80, ui.scene.clientWidth - 80)}px`;
    bb.style.top = `${h.y}px`;
  }
  requestAnimationFrame(frame);
}

/* ---------- partner + refresh ---------- */
async function refresh(fromPartner) {
  const before = new Set((ui.state?.events ?? []).map((e) => `${e.kind}${e.at}`));
  const wasView = ui.view;
  try { ui.state = await api.loadPet(); } catch (e) { reportError(e, 'pet-load'); return; }
  const p = pet();
  if (!p) { if (wasView !== 'adopt') renderAdopt(); return; }
  if (p.died_at) { if (wasView !== 'dead') renderDead(); return; }
  if (wasView !== 'live') { renderLive(true); return; }
  ui.cat.setCoat(coatOf(p.colour));
  renderHud();
  renderJournal();
  if (!fromPartner) return;
  const fresh = (ui.state.events ?? []).find((e) => !before.has(`${e.kind}${e.at}`) && e.user_id && e.user_id !== ui.me);
  if (!fresh || ['eat', 'chase', 'hunt', 'pet'].includes(ui.activity)) return;
  const name = partnerName();
  if (fresh.kind === 'feed') {
    say(`${name} just put some food out.`, 3200);
    const food = placeFood(pickOne(FOODS).kind, { x: SPOTS.bowl.x, y: SPOTS.bowl.y - 120 });
    startActivity('eat', (t) => eat(t, food, { free: true }));
  } else if (fresh.kind === 'play') {
    say(`${name} is playing with me!`, 3000);
    if (!reduce) startActivity('life', LIFE.zoomies);
  } else if (fresh.kind === 'pet') {
    say(`${name} gave me a cuddle.`, 3000);
    hearts(4);
  }
}

/* ---------- events ---------- */
document.addEventListener('click', (e) => {
  const egg = e.target.closest?.('[data-coat]');
  if (egg) { ui.eggCoat = egg.dataset.coat; ui.eggName = $('adopt-name').value; renderAdopt(); return; }
  const nm = e.target.closest?.('[data-name]');
  if (nm) { $('adopt-name').value = nm.dataset.name; ui.eggName = nm.dataset.name; return; }
  const a = e.target.closest?.('[data-action]')?.dataset.action;
  if (a === 'new-egg') { ui.eggName = ''; renderAdopt(); }
  if (a === 'feather') setFeather(!ui.feather.on);
  if (a === 'journal') openJournal(true);
  if (a === 'close-journal') openJournal(false);
  if (a === 'blink-back') blinkBack();
});
document.addEventListener('submit', (e) => {
  if (e.target.id === 'adopt') { e.preventDefault(); hatch(); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openJournal(false); });

function openJournal(open) {
  $('journal').hidden = !open;
  $('journal-shade').hidden = !open;
  if (open) renderJournal();
}

function blinkBack() {
  $('blink-back').hidden = true;
  const c = ui.cat;
  startActivity('pet', async () => {
    c.slowBlink();
    await wait(1000);
    c.face({ eyes: 'happy' });
    c.fx.purr = true;
    c.tail = 'quiver';
    hearts(3);
    say(pickOne(['…I love you too. Don\'t tell anyone.', 'prrrr. we understand each other.', '*slow blink*']), 3200);
    cuddle(true);
    await wait(2400);
    c.fx.purr = false;
    restFace();
  });
}

/* ---------- boot ---------- */
function showGate(html) {
  $('gate').innerHTML = html;
  $('gate').hidden = false;
  $('pet-page').hidden = true;
}

function buildScene() {
  ui.scene = $('pet-page');
  $('room-host').innerHTML = roomSVG();
  ui.svg = $('room');
  const f = document.createElementNS(NS, 'g');
  f.id = 'feather';
  f.innerHTML = `<path class="rod" /><path class="string" /><g class="plume"><path d="M0 0 C-10 14 -12 38 -4 58 C4 38 8 16 0 0 Z" />
    <path d="M0 2 L-3 54" class="quill" /><path d="M-2 10 C6 22 8 40 2 56 M2 8 C-8 20 -10 34 -6 50" class="barbs" /></g>`;
  $('toys').append(f);
  makeBall();
  $('pantry-items').innerHTML = FOODS.map((x) => `<button type="button" class="food-btn" data-food="${x.kind}" aria-label="${x.label}: drag onto the floor, or tap to fill the bowl">${foodIcon(x.kind)}<span>${x.label}</span></button>`).join('');
  $('pantry-items').addEventListener('pointerdown', onPantryDown);
  ui.scene.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  ui.scene.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && ui.feather.on) ui.feather.active = false; });
  const repaint = () => { ui.tod = paintTime(ui.scene, ui.svg, Date.now(), params.get('time')); };
  repaint();
  setInterval(repaint, 60000);
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
    showGate(`<div class="card center narrow"><h2>A cat needs two people</h2>
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
  buildScene();
  const p = pet();
  if (!p) renderAdopt();
  else if (p.died_at) renderDead();
  else {
    renderLive(true);
    setTimeout(() => say(speech(ui.state, Date.now(), partnerName(), (n) => Math.floor(Math.random() * n))), 900);
    hint();
  }
  requestAnimationFrame(frame);
  ui.live = api.subscribe(ui.roomId, () => refresh(true));
  lifeLoop();
  talkLoop();
  setInterval(() => { if (!document.hidden) refresh(false); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(false); });
}

boot();
