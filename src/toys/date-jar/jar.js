// Date Jar rules that don't touch the page or the database, so they can be unit tested.
// A slip's cost is the whole date; payer null means split 50/50, otherwise that person pays it all.

export const VETOES_PER_WEEK = 1;
export const WEEK_MS = 7 * 86400000;
export const MAX_IN_JAR = 90;
export const CHEAP = 500;

export const PLACES = { in: { emoji: '🛋️', label: 'Stay in' }, out: { emoji: '🌆', label: 'Go out' } };
export const LENGTHS = { quick: { emoji: '⏱️', label: 'Quick' }, evening: { emoji: '🌙', label: 'Evening' }, day: { emoji: '☀️', label: 'Whole day' } };
export const COST_PRESETS = [0, 500, 1500, 3000, 5000];

export const STARTERS = [
  { idea: 'Sunset walk and cutting chai', cost: 100, place: 'out', length: 'quick' },
  { idea: 'Cook a dish from a country neither of us has been to', cost: 800, place: 'in', length: 'evening' },
  { idea: 'Thrift each other an outfit, ₹500 each', cost: 1000, place: 'out', length: 'evening' },
  { idea: 'Board game café, loser buys dessert', cost: 1200, place: 'out', length: 'evening' },
  { idea: 'Recreate our first date', cost: 2000, place: 'out', length: 'evening' },
  { idea: 'Late-night drive to look at the stars', cost: 300, place: 'out', length: 'evening' },
  { idea: 'Pottery class', cost: 3000, place: 'out', length: 'day' },
  { idea: 'Blanket fort and the first movie we watched together', cost: 0, place: 'in', length: 'evening' },
  { idea: 'Breakfast somewhere we have never been', cost: 900, place: 'out', length: 'quick' },
  { idea: 'Polaroid walk: only 10 photos allowed', cost: 600, place: 'out', length: 'day' },
  { idea: 'Spa night at home, phones in a drawer', cost: 400, place: 'in', length: 'evening' },
  { idea: 'Plan a fake trip to Japan, down to the day', cost: 0, place: 'in', length: 'quick' },
];

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const rupees = (n) => inr.format(Math.round(n || 0));
// ₹ ₹₹ ₹₹₹ ₹₹₹₹ for the folded-slip teaser.
export const costBand = (cost) => (cost <= 0 ? 'Free' : '₹'.repeat(cost <= 600 ? 1 : cost <= 2000 ? 2 : cost <= 5000 ? 3 : 4));

// What one person pays for one slip. Done dates use what they really cost.
export function shareOf(slip, userId) {
  const total = slip.status === 'done' && slip.spent != null ? slip.spent : slip.cost;
  if (!total) return 0;
  if (slip.payer == null) return total / 2;
  return slip.payer === userId ? total : 0;
}

const sum = (slips, userId) => slips.reduce((n, s) => n + shareOf(s, userId), 0);

// Per person: the whole jar, the average draw (what the next shake costs you on average),
// the date that's drawn now, and what done dates cost this month and ever.
export function money(slips, members, monthStart) {
  const jar = slips.filter((s) => s.status === 'jar');
  const drawn = slips.filter((s) => s.status === 'drawn');
  const done = slips.filter((s) => s.status === 'done');
  const month = done.filter((s) => (s.done_at ?? '') >= monthStart);
  return members.map((m) => ({
    userId: m.user_id,
    jar: sum(jar, m.user_id),
    nextDraw: jar.length ? sum(jar, m.user_id) / jar.length : 0,
    upNext: sum(drawn, m.user_id),
    month: sum(month, m.user_id),
    ever: sum(done, m.user_id),
  }));
}

// Who's treating more, in one friendly line.
export function fairness(rows, nameOf, key = 'jar') {
  if (rows.length < 2) return '';
  const [a, b] = rows;
  const total = a[key] + b[key];
  if (!total) return '';
  const gap = Math.abs(a[key] - b[key]) / total;
  if (gap < 0.1) return 'Pretty even ⚖️';
  const name = nameOf((a[key] > b[key] ? a : b).userId);
  return `${name} ${name === 'You' ? 'treat' : 'treats'} more ${gap > 0.5 ? '💸💸' : '💸'}`;
}

// A picture for a date, guessed from its words; falls back to stay-in or go-out.
const PICTURES = [
  [/movie|film|cinema|netflix/, '🎬'], [/cook|dinner|lunch|food|eat|pizza|pasta|biryani/, '🍝'], [/breakfast|brunch|pancake/, '🥞'],
  [/chai|coffee|tea|café|cafe/, '☕'], [/sunset|sunrise|beach|sea/, '🌅'], [/star|sky|moon/, '✨'], [/drive|road ?trip|car/, '🚗'],
  [/walk|hike|trek|park/, '🥾'], [/pottery|paint|art|draw|craft/, '🎨'], [/game|board|cards|bowling|arcade/, '🎲'],
  [/trip|travel|japan|flight|holiday/, '✈️'], [/spa|massage|bath/, '🛁'], [/dance|club|party|concert|music/, '🪩'],
  [/book|library|read/, '📚'], [/photo|polaroid|camera/, '📸'], [/thrift|shop|outfit|mall/, '🛍️'], [/picnic/, '🧺'],
  [/fort|blanket|cuddle/, '🏕️'], [/first date/, '💘'], [/dessert|cake|ice cream|chocolate/, '🍰'],
];
export function pictureOf(idea, place) {
  const text = String(idea ?? '').toLowerCase();
  return PICTURES.find(([re]) => re.test(text))?.[1] ?? (place === 'in' ? '🛋️' : '🌆');
}

// Vetoes left for a person this week, and when the next one comes back.
export function vetoesLeft(vetoes, userId, now = Date.now()) {
  const mine = vetoes.filter((v) => v.user_id === userId && now - Date.parse(v.at) < WEEK_MS).map((v) => Date.parse(v.at)).sort();
  const left = Math.max(0, VETOES_PER_WEEK - mine.length);
  return { left, backAt: left ? null : mine[0] + WEEK_MS };
}

export const matches = (slip, mood) => slip.status === 'jar'
  && (!mood.place || slip.place === mood.place)
  && (!mood.length || slip.length === mood.length)
  && (mood.max == null || slip.cost <= mood.max);

// The couple home card line.
export function jarLine(slips, meId) {
  const drawn = slips.find((s) => s.status === 'drawn');
  if (drawn) return `Up next: ${drawn.idea} 💌`;
  const inJar = slips.filter((s) => s.status === 'jar');
  if (!inJar.length) return 'Empty jar. Write the first date idea ✍️';
  const secret = inJar.filter((s) => s.added_by !== meId).length;
  return `${inJar.length} date${inJar.length === 1 ? '' : 's'} folded inside${secret ? ` · ${secret} secret${secret === 1 ? '' : 's'} 🤫` : ''}`;
}

// Stable pseudo-random numbers per slip, so the pile looks the same on every render.
export function seeded(id, k) {
  let h = 2166136261;
  for (const c of `${id}:${k}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
