// Drinks maths. Everything is measured in "shots": 30 ml at 40% = 12 ml of pure alcohol,
// whatever was actually drunk, so a pint and a peg compare honestly. Pure functions, no DOM.

export const SHOT_ML = 30;
export const SHOT_ABV = 40;
const SHOT_ALCOHOL_ML = SHOT_ML * SHOT_ABV / 100;
const BOTTLE_SHOTS = 750 * 0.4 / SHOT_ALCOHOL_ML; // a 750 ml bottle of 40% spirit = 25 shots
const NIGHT_ENDS_HOUR = 6; // drinks before 6am belong to the night before
const DAY_MS = 86400000;

// Sizes are typical Indian pours (30/60 ml pegs, 330/500/650 ml beers).
export const KINDS = {
  beer:     { label: 'Beer',     emoji: '🍺', abv: 5,  sizes: [330, 500, 650], size: 330 },
  wine:     { label: 'Wine',     emoji: '🍷', abv: 12, sizes: [150, 250],      size: 150 },
  shot:     { label: 'Shot',     emoji: '🥃', abv: 40, sizes: [30, 60],        size: 30 },
  cocktail: { label: 'Cocktail', emoji: '🍸', abv: 12, sizes: [150, 250],      size: 150 },
  other:    { label: 'Other',    emoji: '🧪', abv: 8,  sizes: [100, 330],      size: 330 },
};

export const HANGOVERS = [
  { label: 'Fine', emoji: '😌' },
  { label: 'Meh', emoji: '🥴' },
  { label: 'Rough', emoji: '🤢' },
  { label: 'Dead', emoji: '💀' },
];

export const shotsOf = (d) => (Number(d.ml) * Number(d.abv) / 100 * (d.qty ?? 1)) / SHOT_ALCOHOL_ML;
export const round1 = (n) => Math.round(n * 10) / 10;
export const bottlesOf = (shots) => shots / BOTTLE_SHOTS;

const pad = (n) => String(n).padStart(2, '0');
export const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const utc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const addDays = (s, n) => new Date(utc(s) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY_MS);
export const mondayOf = (s) => addDays(s, -((new Date(utc(s)).getUTCDay() + 6) % 7));
export const monthStart = (s) => `${s.slice(0, 7)}-01`;
export const monthEnd = (s) => addDays(`${addMonths(s, 1).slice(0, 7)}-01`, -1);
export function addMonths(s, n) {
  const [y, m] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-01`;
}

// The night a drink logged right now belongs to: before 6am it's still last night.
export function currentNight(now = new Date()) {
  const night = new Date(now);
  if (night.getHours() < NIGHT_ENDS_HOUR) night.setDate(night.getDate() - 1);
  return dateStr(night);
}

// day → { userId: shots }
export function shotsByDay(drinks) {
  const out = new Map();
  for (const d of drinks) {
    const day = out.get(d.day) || {};
    day[d.user_id] = (day[d.user_id] || 0) + shotsOf(d);
    out.set(d.day, day);
  }
  return out;
}

const inRange = (day, from, to) => day >= from && day <= to;

// One person's numbers for [from, to]. Days after `today` don't count as dry (they haven't happened).
export function personStats(drinks, userId, from, to, today) {
  const mine = drinks.filter((d) => d.user_id === userId && inRange(d.day, from, to));
  const nights = new Map();
  const kinds = {};
  for (const d of mine) {
    const s = shotsOf(d);
    nights.set(d.day, (nights.get(d.day) || 0) + s);
    kinds[d.kind] = (kinds[d.kind] || 0) + (d.qty ?? 1);
  }
  const total = [...nights.values()].reduce((a, b) => a + b, 0);
  const lastDay = to < today ? to : today;
  const elapsed = lastDay < from ? 0 : daysBetween(from, lastDay) + 1;
  let biggest = null;
  for (const [day, s] of nights) if (!biggest || s > biggest.shots) biggest = { day, shots: s };
  const favourite = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    total,
    nights: nights.size,
    dry: Math.max(0, elapsed - [...nights.keys()].filter((d) => d <= lastDay).length),
    perNight: nights.size ? total / nights.size : 0,
    biggest,
    favourite,
  };
}

// Consecutive drink-free days ending today (today counts only once it's free so far).
export function dryStreak(drinks, userId, today) {
  const days = new Set(drinks.filter((d) => d.user_id === userId).map((d) => d.day));
  let n = 0;
  let day = today;
  while (!days.has(day) && n < 3660) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

// Shots per week (Mon–Sun) in a month, for the side-by-side bars: [{ start, totals: { userId: shots } }]
export function weeksOf(drinks, from, to) {
  const weeks = [];
  for (let start = mondayOf(from); start <= to; start = addDays(start, 7)) weeks.push({ start, totals: {} });
  for (const d of drinks) {
    if (!inRange(d.day, from, to)) continue;
    const week = weeks.find((w) => d.day >= w.start && d.day < addDays(w.start, 7));
    if (week) week.totals[d.user_id] = (week.totals[d.user_id] || 0) + shotsOf(d);
  }
  return weeks;
}

// Shots per month in a year: [{ month: 'YYYY-MM', totals: { userId: shots } }] × 12
export function monthsOf(drinks, year) {
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${pad(i + 1)}`, totals: {} }));
  for (const d of drinks) {
    if (!d.day.startsWith(`${year}-`)) continue;
    const m = months[Number(d.day.slice(5, 7)) - 1];
    m.totals[d.user_id] = (m.totals[d.user_id] || 0) + shotsOf(d);
  }
  return months;
}

// "Rough mornings tend to follow ~X shots": compares nights rated fine/meh against rough/dead.
// Needs at least two of each to say anything.
export function hangoverInsight(drinks, notes, userId) {
  const nights = shotsByDay(drinks.filter((d) => d.user_id === userId));
  const easy = [];
  const rough = [];
  for (const n of notes) {
    if (n.user_id !== userId || n.hangover == null) continue;
    const shots = nights.get(n.day)?.[userId];
    if (!shots) continue;
    (n.hangover >= 2 ? rough : easy).push(shots);
  }
  if (easy.length < 2 || rough.length < 2) return null;
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { easy: avg(easy), rough: avg(rough), threshold: Math.min(...rough), rated: easy.length + rough.length };
}

// How full each pitcher is: the bigger total sits at ~85%, so both always read at a glance.
// A month's jug holds 15 shots (a year's holds 12 of them). Past the brim you're cut off.
export const JUG_SHOTS = 15;
export function jugOf(total, months = 1) {
  const cap = JUG_SHOTS * months;
  return { cap, level: Math.min(1, total / cap), left: round1(Math.max(0, cap - total)), over: total > cap };
}
