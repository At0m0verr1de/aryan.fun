// Pure helpers for Kitne Ka?: rupee formatting the Indian way, reading typed guesses, scoring, verdicts, tallies.

const LAKH = 100000;
const CRORE = 10000000;
const UNITS = { k: 1000, K: 1000, l: LAKH, L: LAKH, lakh: LAKH, lakhs: LAKH, lac: LAKH, cr: CRORE, crore: CRORE, crores: CRORE };
export const MAX_GUESS = 100000000000;

// 1234567 → "₹12,34,567"
export function inr(n) {
  const s = String(Math.round(n));
  if (s.length <= 3) return `₹${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${rest},${last3}`;
}

const trim = (x) => String(Number(x.toFixed(2)));

// 150000 → "₹1.5 lakh", 23000000 → "₹2.3 crore", 4500 → "₹4,500"
export function inWords(n) {
  if (n >= CRORE) return `₹${trim(n / CRORE)} crore`;
  if (n >= LAKH) return `₹${trim(n / LAKH)} lakh`;
  return inr(n);
}

// "1.5L", "2 cr", "12k", "1,20,000", "₹ 499" → a number of rupees, or null.
export function parseGuess(text) {
  const m = String(text ?? '').replace(/[₹,\s]/g, '').match(/^(\d+(?:\.\d+)?)([a-zA-Z]*)$/);
  if (!m) return null;
  const unit = m[2] ? UNITS[m[2]] ?? UNITS[m[2].toLowerCase()] : 1;
  if (!unit) return null;
  const n = Math.round(Number(m[1]) * unit);
  return n >= 1 && n <= MAX_GUESS ? n : null;
}

// Same as the database: 100 spot on, 2× off ≈ 37, 3× off or worse = 0.
export const points = (guess, price) => Math.max(0, Math.round(100 * (1 - Math.abs(Math.log(guess / price)) / Math.log(3))));

export function verdict(guess, price) {
  const p = points(guess, price);
  const ratio = guess / price;
  const off = ratio >= 1 ? `${trim(ratio)}× too high` : `${trim(1 / ratio)}× too low`;
  if (p >= 97) return { emoji: '🎯', title: 'Spot on!', sub: 'Are you the shopkeeper?' };
  if (p >= 85) return { emoji: '🔥', title: 'So close!', sub: ratio >= 1 ? 'A touch high' : 'A touch low' };
  if (p >= 60) return { emoji: '👍', title: 'Not bad', sub: ratio >= 1 ? 'A bit high' : 'A bit low' };
  if (p >= 25) return { emoji: '🤏', title: 'Hmm', sub: off };
  return { emoji: ratio >= 1 ? '💸' : '🙈', title: ratio >= 1 ? 'Way too rich' : 'Way too cheap', sub: off };
}

// Where a guess sits on the closeness meter: 0 = a third of the price or less, 0.5 = exact, 1 = triple or more.
export const meterPos = (guess, price) => Math.min(1, Math.max(0, 0.5 + Math.log(guess / price) / (2 * Math.log(3))));

// Totals per day from the history rows [{day, user_id, points, n}].
export function standings(history, me, partner, monthPrefix) {
  const days = new Map();
  for (const h of history) {
    const d = days.get(h.day) ?? {};
    d[h.user_id] = h;
    days.set(h.day, d);
  }
  const t = { me: 0, partner: 0, ties: 0, days: 0 };
  for (const [day, d] of days) {
    if (!day.startsWith(monthPrefix) || d[me]?.n !== 5 || d[partner]?.n !== 5) continue;
    t.days++;
    if (d[me].points > d[partner].points) t.me++;
    else if (d[partner].points > d[me].points) t.partner++;
    else t.ties++;
  }
  return t;
}

// One line for the couple home, from price_today().
export function kitneLine(state, partnerName) {
  if (!state) return 'Guess the price of five everyday things 🛒';
  const mine = state.items.filter((i) => i.guess != null);
  const theirs = state.items.filter((i) => i.partner_played).length;
  if (!mine.length) return theirs ? `${partnerName} has guessed today's prices, your turn 🛒` : 'Five new things to price today 🛒';
  if (mine.length < 5) return `${mine.length} of 5 guessed, finish today's round`;
  const total = mine.reduce((s, i) => s + i.points, 0);
  if (theirs < 5) return `You scored ${total}/500 · ${partnerName} yet to finish`;
  const them = state.items.reduce((s, i) => s + (i.partner_points ?? 0), 0);
  return total === them ? `Tied at ${total} today` : total > them ? `You won today ${total}–${them} 🏆` : `${partnerName} won today ${them}–${total}`;
}
