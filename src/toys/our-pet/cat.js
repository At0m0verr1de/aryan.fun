// The cat: a little black cat drawn from a few soft shapes and posed by a tiny rig. The body is seen side on and the
// head faces you. Positions are room units; poses live in the cat's own space (facing right, paws on y = 0).

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const f1 = (n) => Math.round(n * 10) / 10;
const pt = (x, y) => `${f1(x)} ${f1(y)}`;

const FRONT = [44, 46]; // upper and lower leg
const BACK = [46, 48];
const PREP_S = 0.22;     // crouch before a jump
const LAND_S = 0.16;

// cx/cy/cr chest, hx/hy/hr hips, kx/ky/kt head position and tilt (deg), paws fn/ff/bn/bf (near/far, front/back),
// ta/tc/tl tail angle, curl (deg) and length, tf tail in front of the body, tuck hides the legs, haunch shows the
// sitting thigh, ear flattens the ears.
const BASE = {
  cx: 50, cy: -86, cr: 31, hx: -50, hy: -84, hr: 33, kx: 90, ky: -126, kt: 0,
  fnx: 56, fny: 0, ffx: 42, ffy: 0, bnx: -50, bny: 0, bfx: -36, bfy: 0,
  ta: 210, tc: 70, tl: 150, tf: 0, tuck: 0, haunch: 0, ear: 0,
};
const LOAF = { cx: 40, cy: -40, cr: 30, hx: -40, hy: -42, hr: 36, kx: 74, ky: -80, fnx: 60, ffx: 52, bnx: -30, bfx: -20, ta: 172, tc: 60, tl: 130, tuck: 1, haunch: 0.3 };
const SIT = { cx: 30, cy: -100, cr: 30, hx: -24, hy: -44, hr: 40, kx: 42, ky: -150, fnx: 38, ffx: 26, bnx: 14, bfx: 2, ta: 160, tc: 50, tl: 140, haunch: 1 };
export const POSES = Object.fromEntries(Object.entries({
  stand: {},
  walk: { kx: 94, ky: -120, ta: 200, tc: 40 },
  sit: SIT,
  knead: { ...SIT, fnx: 52, ffx: 40 },
  loaf: LOAF,
  lie: { ...LOAF, kx: 78, ky: -60, kt: 8, ear: 22, ta: 170, tc: 16 },
  sleep: { cx: 26, cy: -36, cr: 30, hx: -34, hy: -40, hr: 36, kx: 52, ky: -50, kt: 22, fnx: 50, ffx: 44, bnx: -24, bfx: -14, ta: 120, tc: -150, tl: 170, tf: 1, tuck: 1, haunch: 0.3 },
  crouch: { cx: 54, cy: -56, cr: 30, hx: -46, hy: -66, hr: 33, kx: 98, ky: -86, fnx: 66, ffx: 52, bnx: -34, bfx: -22, ta: 185, tc: 10 },
  leap: { cx: 66, cy: -92, cr: 29, hx: -60, hy: -84, hr: 31, kx: 108, ky: -120, fnx: 112, fny: -50, ffx: 100, ffy: -40, bnx: -112, bny: -46, bfx: -100, bfy: -38, ta: 180, tc: 0 },
  stretch: { cx: 70, cy: -44, cr: 29, hx: -46, hy: -92, hr: 33, kx: 112, ky: -64, kt: -10, fnx: 124, ffx: 110, bnx: -46, bfx: -34, ta: 230, tc: 30 },
  eat: { cx: 44, cy: -72, hx: -48, hy: -84, kx: 84, ky: -60, kt: 14, ta: 200, tc: 30 },
  flop: { cx: 44, cy: -30, cr: 28, hx: -44, hy: -32, hr: 32, kx: 92, ky: -44, kt: 70, fnx: 100, fny: -14, ffx: 94, ffy: -32, bnx: 4, bny: -22, bfx: 14, bfy: -36, ta: 172, tc: 30 },
}).map(([k, v]) => [k, { ...BASE, ...v }]));

// Walk: back-near, front-near, back-far, front-far a quarter apart. Run: a bouncy gallop.
const GAIT = { walk: { bn: 0, fn: 0.25, bf: 0.5, ff: 0.75 }, run: { bn: 0, bf: 0.1, fn: 0.5, ff: 0.6 } };
const TAIL = {
  calm: { amp: 7, w: 1.4, da: 0 }, happy: { amp: 5, w: 2.2, da: 28 }, low: { amp: 4, w: 0.9, da: -48 },
  flick: { amp: 15, w: 6.5, da: 0 }, sleep: { amp: 2, w: 0.6, da: 0 }, quiver: { amp: 2.5, w: 18, da: 30 },
};

const MARKUP = `<g class="cat-root">
  <ellipse class="cat-shadow" rx="96" ry="9" />
  <path class="cat-tail back fur" />
  <path class="leg far" data-leg="ff" /><path class="leg far" data-leg="bf" />
  <ellipse class="paw far" data-paw="ff" rx="9" ry="5.5" /><ellipse class="paw far" data-paw="bf" rx="9" ry="5.5" />
  <g class="cat-body fur">
    <path class="hull" /><circle class="hip" /><circle class="chest" /><ellipse class="belly" /><circle class="neck" r="25" />
  </g>
  <g class="stripes s-hip"><path d="M-6 -30 Q4 -14 -6 2 M10 -29 Q19 -16 11 -2 M-22 -23 Q-13 -10 -21 5" /></g>
  <g class="stripes s-chest"><path d="M-6 -27 Q2 -18 -4 -8 M9 -24 Q16 -16 12 -6" /></g>
  <ellipse class="bib" rx="19" ry="25" /><ellipse class="bib belly-patch" />
  <ellipse class="haunch fur" />
  <path class="leg near" data-leg="fn" /><path class="leg near" data-leg="bn" />
  <ellipse class="paw near" data-paw="fn" rx="9.5" ry="6" /><ellipse class="paw near" data-paw="bn" rx="9.5" ry="6" />
  <g class="tucked"><ellipse class="paw near" rx="10" ry="6" /><ellipse class="paw near" rx="10" ry="6" /></g>
  <g class="cat-head">
    <g class="ear ear-l"><path class="head-fur" d="M-36 -12 Q-42 -50 -31 -68 Q-12 -52 -5 -36 Z" /><path class="ear-in" d="M-31 -21 Q-35 -46 -29 -57 Q-17 -46 -12 -36 Z" /></g>
    <g class="ear ear-r"><path class="head-fur" d="M36 -12 Q42 -50 31 -68 Q12 -52 5 -36 Z" /><path class="ear-in" d="M31 -21 Q35 -46 29 -57 Q17 -46 12 -36 Z" /></g>
    <path class="head-fur" d="M0 -42 C26 -42 44 -27 45 -3 C46 9 51 16 45 21 C38 33 20 40 0 40 C-20 40 -38 33 -45 21 C-51 16 -46 9 -45 -3 C-44 -27 -26 -42 0 -42 Z" />
    <path class="stripes" d="M-14 -38 L-10 -25 M0 -41 L0 -27 M14 -38 L10 -25 M-45 3 L-34 6 M-46 11 L-35 11 M45 3 L34 6 M46 11 L35 11" />
    <path class="bib" d="M-15 10 C-22 22 -12 34 0 34 C12 34 22 22 15 10 C10 4 4 8 0 12 C-4 8 -10 4 -15 10 Z" />
    <path class="collar" d="M-29 31 Q0 47 29 31" /><circle class="bell" cx="0" cy="43" r="4.6" />
    <g class="features">
      <g class="eye" data-eye="l"><ellipse class="iris" rx="11.5" ry="12.5" /><ellipse class="pupil" rx="3" ry="9.5" />
        <circle class="glint" cx="3.6" cy="-5" r="2.6" /><circle class="glint" cx="-4" cy="4.5" r="1.2" /></g>
      <g class="eye" data-eye="r"><ellipse class="iris" rx="11.5" ry="12.5" /><ellipse class="pupil" rx="3" ry="9.5" />
        <circle class="glint" cx="3.6" cy="-5" r="2.6" /><circle class="glint" cx="-4" cy="4.5" r="1.2" /></g>
      <path class="lid closed" d="M-28 -1 Q-17 5 -6 -1 M6 -1 Q17 5 28 -1" />
      <path class="lid happy" d="M-28 1 Q-17 -7 -6 1 M6 1 Q17 -7 28 1" />
      <path class="nose" d="M-4.6 11 Q0 9.4 4.6 11 Q2 16 0 16.6 Q-2 16 -4.6 11 Z" />
      <path class="mouth m-w" d="M0 16.6 Q0 21 -5.5 22 M0 16.6 Q0 21 5.5 22" />
      <path class="mouth m-open" d="M-6 19 Q0 31 6 19 Q0 21.5 -6 19 Z" />
      <g class="mouth m-yawn"><ellipse cx="0" cy="25" rx="8" ry="10.5" /><path class="fang" d="M-6 17.5 l1.6 4 l1.6 -4 Z M2.8 17.5 l1.6 4 l1.6 -4 Z" /></g>
      <path class="tongue" d="M-3.6 21 Q0 31 3.6 21 Z" />
      <g class="whiskers"><path d="M-12 15 L-47 9 M-12 18.5 L-48 19.5 M-11 22 L-44 29 M12 15 L47 9 M12 18.5 L48 19.5 M11 22 L44 29" /></g>
    </g>
  </g>
  <path class="cat-tail front fur" />
</g>`;

function ik(jx, jy, px, py, l1, l2, bend) {
  let dx = px - jx;
  let dy = py - jy;
  const want = Math.hypot(dx, dy) || 1;
  const d = clamp(want, Math.abs(l1 - l2) + 1, l1 + l2 - 0.5);
  if (d < want) { px = jx + (dx / want) * d; py = jy + (dy / want) * d; dx = px - jx; dy = py - jy; }
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const th = Math.atan2(dy, dx) + bend * a;
  return { kx: jx + Math.cos(th) * l1, ky: jy + Math.sin(th) * l1, px, py };
}

// The outline around the chest and hip circles.
function hull(x1, y1, r1, x2, y2, r2) {
  const d = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const b = Math.acos(clamp((r1 - r2) / d, -1, 1));
  const p = (x, y, r, a) => pt(x + Math.cos(a) * r, y + Math.sin(a) * r);
  return `M${p(x1, y1, r1, ang + b)} L${p(x2, y2, r2, ang + b)} L${p(x2, y2, r2, ang - b)} L${p(x1, y1, r1, ang - b)} Z`;
}

// A tapered tail along a spine whose direction at each point is angleAt(0..1).
function tailPath(bx, by, angleAt, len) {
  const N = 18;
  const seg = len / N;
  const L = [];
  const R = [];
  let x = bx;
  let y = by;
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const a = angleAt(f) * DEG;
    if (i > 0) { x += Math.cos(a) * seg; y += Math.sin(a) * seg; }
    const w = lerp(8, 4.6, f);
    L.push(pt(x - Math.sin(a) * w, y + Math.cos(a) * w));
    R.push(pt(x + Math.sin(a) * w, y - Math.cos(a) * w));
  }
  return `M${L.join(' L')} A4.6 4.6 0 0 0 ${R[N]} L${R.reverse().join(' L')} Z`;
}

// Foot offset during a gait cycle: on the ground 60% of the time, swinging forward the rest.
function step(u, A, H) {
  if (u < 0.6) return [A * (1 - (2 * u) / 0.6), 0];
  const v = (u - 0.6) / 0.4;
  const e = v * v * (3 - 2 * v);
  return [-A + 2 * A * e, -H * Math.sin(Math.PI * v)];
}

export class Cat {
  // layer: an SVG <g>; scaleAt(y): size at floor depth y.
  constructor(layer, { coat, scaleAt, size = 1 }) {
    layer.innerHTML = MARKUP;
    this.layer = layer;
    this.scaleAt = scaleAt;
    this.size = size;
    const q = (s) => layer.querySelector(s);
    this.el = {
      stripesHip: q('.s-hip'), stripesChest: q('.s-chest'), bib: q('.bib'), bellyPatch: q('.belly-patch'),
      root: q('.cat-root'), shadow: q('.cat-shadow'), tailB: q('.cat-tail.back'), tailF: q('.cat-tail.front'),
      hull: q('.hull'), hip: q('.hip'), chest: q('.chest'), belly: q('.belly'), neck: q('.neck'), haunch: q('.haunch'),
      tucked: q('.tucked'), tuckPaws: [...layer.querySelectorAll('.tucked .paw')], head: q('.cat-head'), features: q('.features'),
      earL: q('.ear-l'), earR: q('.ear-r'), eyes: [...layer.querySelectorAll('.eye')], pupils: [...layer.querySelectorAll('.pupil')],
      lidClosed: q('.lid.closed'), lidHappy: q('.lid.happy'), tongue: q('.tongue'),
      mouths: { w: q('.m-w'), open: q('.m-open'), yawn: q('.m-yawn') },
      legs: Object.fromEntries([...layer.querySelectorAll('.leg')].map((e) => [e.dataset.leg, e])),
      paws: Object.fromEntries([...layer.querySelectorAll('[data-paw]')].map((e) => [e.dataset.paw, e])),
    };
    this.setCoat(coat);
    this.x = 800; this.y = 780; this.lift = 0; this.s = scaleAt(780); this.dir = 1; this.dirVis = 1; this.spot = 'floor';
    this.p = { ...POSES.stand }; this.pose = 'stand'; this.blend = 7;
    this.eyes = 'open'; this.mouth = 'w'; this.pupil = 0.3; this.look = [0, 0];
    this.eyeOpen = 1; this.blinkIn = 2; this.blinking = 0; this.slow = 0; this.twitch = 0; this.twitchSide = 0;
    this.lookNow = [0, 0]; this.pupilNow = 0.3;
    this.tail = 'calm'; this.tailNow = { ...TAIL.calm };
    this.fx = { purr: false, knead: false, lick: false, chatter: false, wiggle: false, eat: false, swat: 0, swatUp: false };
    this.move = null; this.jump = null; this.moving = 0; this.gait = 0; this.gaitKind = 'walk';
  }

  // coat: an entry from COATS in pet.js. The gradients live in the room's <defs>, so the colours go on the <svg>.
  setCoat(coat) {
    const svg = this.layer.ownerSVGElement;
    const set = (k, v) => svg.style.setProperty(k, v);
    coat.fur.forEach((c, i) => set(`--fur${i + 1}`, c));
    coat.head.forEach((c, i) => set(`--head${i + 1}`, c));
    coat.iris.forEach((c, i) => set(`--iris${i + 1}`, c));
    set('--ear-in', coat.ear); set('--nose', coat.nose); set('--whisker', coat.whisker); set('--collar', coat.collar);
    set('--stripe', coat.stripe ?? 'transparent'); set('--bib-op', coat.bib ? '1' : '0');
    set('--paw', coat.bib ? '#f4f1ee' : coat.fur[2]); set('--far-leg', coat.bib ? coat.fur[2] : coat.fur[2]);
  }
  setPose(name, blend = 7) { this.pose = name; this.blend = blend; }
  face({ eyes, mouth, pupil } = {}) {
    if (eyes) this.eyes = eyes;
    if (mouth) this.mouth = mouth;
    if (pupil != null) this.pupil = pupil;
  }
  slowBlink() { this.slow = 1.8; }
  earTwitch() { this.twitch = 0.45; this.twitchSide = Math.random() < 0.5 ? 0 : 1; }
  swat(up = false) { this.fx.swat = 0.32; this.fx.swatUp = up; }

  walkTo(x, y, { run = false, speed } = {}) {
    this.stop();
    return new Promise((done) => {
      this.gaitKind = run ? 'run' : 'walk';
      this.move = { x, y, speed: speed ?? (run ? 360 : 120), done };
      this.setPose('walk', 9);
    });
  }

  // Land at (x, y) with size s; spot names where it ends up (floor, sill, sofa).
  jumpTo(x, y, { s, spot = 'floor', height = 60 } = {}) {
    this.stop();
    const s1 = s ?? this.scaleAt(y);
    if (Math.abs(x - this.x) > 4) this.dir = Math.sign(x - this.x);
    return new Promise((done) => {
      const dist = Math.hypot(x - this.x, y - this.y);
      this.jump = { x0: this.x, y0: this.y, s0: this.s, x1: x, y1: y, s1, t: 0, dur: 0.34 + dist / 1400, h: height + Math.max(0, this.y - y) * 0.25, spot, done };
      this.setPose('crouch', 14);
    });
  }

  stop() {
    if (this.move) { const m = this.move; this.move = null; m.done(false); }
  }

  get busyMoving() { return Boolean(this.move || this.jump); }

  // Room point of the head, the mouth and the front paw (for captions, food and the ball).
  local(lx, ly) { return { x: this.x + this.dirVis * this.s * this.size * lx, y: this.y - this.lift + this.s * this.size * ly }; }
  headPoint() { return this.local(this.p.kx, this.p.ky - 40); }
  mouthPoint() { return this.local(this.p.kx, this.p.ky + 24); }

  hit(wx, wy) {
    const k = this.s * this.size;
    const dv = Math.abs(this.dirVis) < 0.25 ? this.dir : this.dirVis;
    const lx = (wx - this.x) / (dv * k);
    const ly = (wy - (this.y - this.lift)) / k;
    const p = this.p;
    if (Math.hypot(lx - p.kx, ly - p.ky) < 54) return true;
    const mx = (p.cx + p.hx) / 2;
    const my = (p.cy + p.hy) / 2;
    const rx = Math.abs(p.cx - p.hx) / 2 + 46;
    return ((lx - mx) / rx) ** 2 + ((ly - my) / 62) ** 2 < 1;
  }

  update(dt, t) {
    const p = this.p;
    // where we're headed
    if (this.jump) this.updateJump(dt);
    else if (this.move) {
      const m = this.move;
      const dx = m.x - this.x;
      const dy = m.y - this.y;
      const d = Math.hypot(dx, dy);
      const stepLen = m.speed * this.s * dt;
      if (Math.abs(dx) > 3) this.dir = Math.sign(dx);
      if (d <= stepLen) { this.x = m.x; this.y = m.y; this.move = null; this.setPose('stand'); m.done(true); }
      else { this.x += (dx / d) * stepLen; this.y += (dy / d) * stepLen; }
      this.gait += stepLen / this.s / (this.gaitKind === 'run' ? 94 : 60);
      if (this.spot === 'floor') this.s = this.scaleAt(this.y);
    }
    const walking = Boolean(this.move);
    this.moving = lerp(this.moving, walking ? 1 : 0, 1 - Math.exp(-dt * 10));
    const turnRate = 7 * dt;
    this.dirVis = this.dirVis < this.dir ? Math.min(this.dir, this.dirVis + turnRate) : Math.max(this.dir, this.dirVis - turnRate);

    // pose blend
    const target = POSES[this.pose] ?? POSES.stand;
    const k = 1 - Math.exp(-dt * this.blend);
    for (const key in target) p[key] = lerp(p[key], target[key], k);

    // face
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) { this.blinking = 0.13; this.blinkIn = 2 + Math.random() * 4; }
    this.blinking = Math.max(0, this.blinking - dt);
    this.slow = Math.max(0, this.slow - dt);
    const slowF = this.slow > 0 ? Math.max(0, Math.abs(this.slow - 0.9) / 0.9 * 1.4 - 0.25) : 1;
    const want = { open: 1, wide: 1.12, half: 0.5, closed: 0, happy: 0 }[this.eyes] ?? 1;
    this.eyeOpen = lerp(this.eyeOpen, want * Math.min(1, slowF), 1 - Math.exp(-dt * 12));
    const shownOpen = this.blinking > 0 ? 0.06 : this.eyeOpen;
    this.lookNow = [lerp(this.lookNow[0], this.look[0], 1 - Math.exp(-dt * 8)), lerp(this.lookNow[1], this.look[1], 1 - Math.exp(-dt * 8))];
    this.pupilNow = lerp(this.pupilNow, this.pupil, 1 - Math.exp(-dt * 4));
    this.twitch = Math.max(0, this.twitch - dt);

    const tm = TAIL[this.tail] ?? TAIL.calm;
    for (const key of ['amp', 'w', 'da']) this.tailNow[key] = lerp(this.tailNow[key], tm[key], 1 - Math.exp(-dt * 3));

    this.draw(t, shownOpen);
  }

  updateJump(dt) {
    const j = this.jump;
    j.t += dt;
    const air = j.t - PREP_S;
    if (air < 0) return;
    if (air < j.dur) {
      if (this.pose !== 'leap') this.setPose('leap', 16);
      const u = air / j.dur;
      this.x = lerp(j.x0, j.x1, u);
      this.y = lerp(j.y0, j.y1, u);
      this.s = lerp(j.s0, j.s1, u);
      this.lift = j.h * 4 * u * (1 - u);
      return;
    }
    this.x = j.x1; this.y = j.y1; this.s = j.s1; this.lift = 0; this.spot = j.spot;
    if (this.pose !== 'crouch') this.setPose('crouch', 18);
    if (air > j.dur + LAND_S) { this.jump = null; this.setPose('stand'); j.done(true); }
  }

  draw(t, open) {
    const p = this.p;
    const e = this.el;
    const fx = this.fx;
    const k = this.s * this.size;
    const breathe = Math.sin(t * (this.pose === 'sleep' ? 1.3 : 2)) * (this.pose === 'sleep' ? 1.6 : 1);
    const bob = this.moving * (this.gaitKind === 'run' ? 5 : 2) * Math.abs(Math.sin(this.gait * TAU));
    const wig = fx.wiggle ? Math.sin(t * 22) * 3.2 : 0;
    const purr = fx.purr ? Math.sin(t * 85) * 0.35 : 0;

    const cx = p.cx;
    const cy = p.cy - bob - breathe * 0.6;
    const cr = p.cr + breathe * 0.3;
    const hx = p.hx + wig;
    const hy = p.hy - bob * 0.6 + Math.abs(wig) * 0.3;
    const hr = p.hr;
    const eatBob = fx.eat ? Math.abs(Math.sin(t * 8)) * 5 : 0;
    const kx = p.kx;
    const ky = p.ky - bob * 1.2 - breathe * 0.5 + eatBob;

    e.root.setAttribute('transform', `translate(${f1(this.x + purr)} ${f1(this.y - this.lift)}) scale(${(this.dirVis * k).toFixed(3)} ${k.toFixed(3)})`);
    const shadowW = (Math.abs(cx - hx) / 2 + 52) * (1 - Math.min(0.5, this.lift / 300));
    e.shadow.setAttribute('cx', f1((cx + hx) / 2));
    e.shadow.setAttribute('cy', f1(this.lift / k + 1));
    e.shadow.setAttribute('rx', f1(shadowW));
    e.shadow.style.opacity = String(1 - Math.min(0.7, this.lift / 260));

    // body
    e.hull.setAttribute('d', hull(cx, cy, cr, hx, hy, hr));
    e.chest.setAttribute('cx', f1(cx)); e.chest.setAttribute('cy', f1(cy)); e.chest.setAttribute('r', f1(cr));
    e.hip.setAttribute('cx', f1(hx)); e.hip.setAttribute('cy', f1(hy)); e.hip.setAttribute('r', f1(hr));
    const bang = Math.atan2(cy - hy, cx - hx) / DEG;
    e.belly.setAttribute('cx', f1((cx + hx) / 2)); e.belly.setAttribute('cy', f1((cy + hy) / 2 + 7));
    e.belly.setAttribute('rx', f1(Math.hypot(cx - hx, cy - hy) / 2 + 6)); e.belly.setAttribute('ry', f1((cr + hr) / 2 * 0.86));
    e.belly.setAttribute('transform', `rotate(${f1(bang)} ${f1((cx + hx) / 2)} ${f1((cy + hy) / 2 + 7)})`);
    e.neck.setAttribute('cx', f1(lerp(cx, kx, 0.55))); e.neck.setAttribute('cy', f1(lerp(cy, ky + 26, 0.55)));
    e.haunch.setAttribute('cx', f1(hx + 8)); e.haunch.setAttribute('cy', f1(hy + 6));
    e.haunch.setAttribute('rx', f1(hr * 0.95 * p.haunch + 0.01)); e.haunch.setAttribute('ry', f1(hr * 0.8 * p.haunch + 0.01));
    e.haunch.style.opacity = p.haunch > 0.05 ? '1' : '0';
    e.stripesHip.setAttribute('transform', `translate(${f1(hx)} ${f1(hy)}) scale(${f1(hr / 33)})`);
    e.stripesChest.setAttribute('transform', `translate(${f1(cx)} ${f1(cy)}) scale(${f1(cr / 31)})`);
    e.bib.setAttribute('cx', f1(cx + cr * 0.55)); e.bib.setAttribute('cy', f1(cy + cr * 0.2));
    e.bib.setAttribute('transform', `rotate(${f1(bang * 0.3)} ${f1(cx + cr * 0.55)} ${f1(cy + cr * 0.2)})`);
    e.bellyPatch.setAttribute('cx', f1((cx + hx) / 2 + 6)); e.bellyPatch.setAttribute('cy', f1((cy + hy) / 2 + 20));
    e.bellyPatch.setAttribute('rx', f1(Math.hypot(cx - hx, cy - hy) / 2 - 4)); e.bellyPatch.setAttribute('ry', f1(10 * (1 - p.tuck * 0.6)));
    e.bellyPatch.setAttribute('transform', `rotate(${f1(bang)} ${f1((cx + hx) / 2 + 6)} ${f1((cy + hy) / 2 + 20)})`);

    // legs
    const gait = GAIT[this.gaitKind];
    const A = this.gaitKind === 'run' ? 28 : 18;
    const H = this.gaitKind === 'run' ? 18 : 11;
    const joints = {
      fn: [cx + 4, cy + cr * 0.45, FRONT, 1], ff: [cx - 6, cy + cr * 0.45, FRONT, 1],
      bn: [hx - 2, hy + hr * 0.35, BACK, -1], bf: [hx + 8, hy + hr * 0.35, BACK, -1],
    };
    for (const leg of ['ff', 'bf', 'fn', 'bn']) {
      let px = p[`${leg}x`];
      let py = p[`${leg}y`];
      if (this.moving > 0.01) {
        const u = (((this.gait + gait[leg]) % 1) + 1) % 1;
        const [ox, oy] = step(u, A, H);
        px += ox * this.moving; py += oy * this.moving;
      }
      if (leg === 'fn' || leg === 'ff') {
        if (fx.knead) py -= 9 * Math.max(0, Math.sin(t * 6.5 + (leg === 'ff' ? Math.PI : 0)));
        if (leg === 'fn' && fx.lick) { const w = Math.sin(t * 7); px = lerp(px, kx + 6, 0.9); py = lerp(py, ky + 30 + w * 6, 0.9); }
        if (leg === 'fn' && fx.swat > 0) {
          const u = Math.sin(Math.PI * (1 - fx.swat / 0.32));
          px = lerp(px, cx + (fx.swatUp ? 40 : 78), u); py = lerp(py, fx.swatUp ? cy - 90 : cy - 26, u);
        }
      }
      const [jx, jy, [l1, l2], bend] = joints[leg];
      const g = ik(jx, jy, px, py, l1, l2, bend);
      e.legs[leg].setAttribute('d', `M${pt(jx, jy)} L${pt(g.kx, g.ky)} L${pt(g.px, g.py)}`);
      e.paws[leg].setAttribute('cx', f1(g.px + 3)); e.paws[leg].setAttribute('cy', f1(g.py - 4));
    }
    if (fx.swat > 0) fx.swat = Math.max(0, fx.swat - 1 / 60);
    const legOpacity = String(clamp(1 - p.tuck * 1.25, 0, 1));
    for (const leg in e.legs) { e.legs[leg].style.opacity = legOpacity; e.paws[leg].style.opacity = legOpacity; }
    e.tucked.style.opacity = String(clamp(p.tuck * 1.25 - 0.25, 0, 1));
    e.tuckPaws[0].setAttribute('cx', f1(cx + cr * 0.8)); e.tuckPaws[0].setAttribute('cy', f1(-5));
    e.tuckPaws[1].setAttribute('cx', f1(cx + cr * 0.45)); e.tuckPaws[1].setAttribute('cy', f1(-4));

    // tail
    const tn = this.tailNow;
    const upright = 1 - Math.max(p.tuck, p.haunch);
    const base = [hx - hr * 0.92, hy + hr * lerp(-0.25, 0.35, Math.max(p.haunch, p.tuck))];
    const d = tailPath(base[0], base[1], (f) => p.ta + tn.da * upright * (1 - f * 0.3) + p.tc * f ** 1.6 + tn.amp * Math.sin(t * tn.w - f * 2.4) * f, p.tl);
    const front = p.tf > 0.5;
    e.tailB.setAttribute('d', front ? '' : d);
    e.tailF.setAttribute('d', front ? d : '');

    // head
    const [lx, ly] = this.lookNow;
    const lick = fx.lick ? 12 + Math.sin(t * 7) * 6 : 0;
    e.head.setAttribute('transform', `translate(${f1(kx)} ${f1(ky)}) rotate(${f1(p.kt + lx * 5 + lick)})`);
    e.features.setAttribute('transform', `translate(${f1(lx * 3.2)} ${f1(ly * 1.8)})`);
    const ear = p.ear;
    const tw = this.twitch > 0 ? Math.sin((this.twitch / 0.45) * Math.PI) * 16 : 0;
    e.earL.setAttribute('transform', `rotate(${f1(-ear - (this.twitchSide === 0 ? tw : 0))} -22 -34)`);
    e.earR.setAttribute('transform', `rotate(${f1(ear + (this.twitchSide === 1 ? tw : 0))} 22 -34)`);
    e.eyes.forEach((eye, i) => eye.setAttribute('transform', `translate(${i ? 17 : -17} -2) scale(1 ${Math.max(0.04, open).toFixed(3)})`));
    const prx = lerp(2.6, 7.6, this.pupilNow);
    e.pupils.forEach((pu) => { pu.setAttribute('rx', f1(prx)); pu.setAttribute('cx', f1(lx * 4)); pu.setAttribute('cy', f1(ly * 3)); });
    const shut = this.eyeOpen < 0.2 || this.blinking > 0;
    e.lidClosed.style.opacity = shut && this.eyes !== 'happy' ? '1' : '0';
    e.lidHappy.style.opacity = this.eyes === 'happy' && this.eyeOpen < 0.25 ? '1' : '0';
    let mouth = this.mouth;
    if (fx.chatter) mouth = Math.sin(t * 70) > 0 ? 'open' : 'w';
    if (fx.eat) mouth = Math.sin(t * 8) > 0 ? 'open' : 'w';
    const tongue = mouth === 'tongue' || (fx.lick && Math.sin(t * 7) > 0.2);
    if (mouth === 'tongue') mouth = 'w';
    for (const [name, el] of Object.entries(e.mouths)) el.style.opacity = name === mouth ? '1' : '0';
    e.tongue.style.opacity = tongue ? '1' : '0';
  }
}
