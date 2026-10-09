// Pure date + scoring helpers. A "day" is { p1?: result, p2?: result } where result = { solved, guesses, grid }.
export const EPOCH = Date.UTC(2021, 5, 19); // Wordle #0
export const DAY_MS = 86400000;
export const FAILED_SCORE = 7;
export const SLOTS = ['p1', 'p2'];

const pad = (n) => String(n).padStart(2, '0');
export const localDateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const addDays = (s, n) => new Date(toUTC(s) + n * DAY_MS).toISOString().slice(0, 10);
export const puzzleNo = (s) => Math.round((toUTC(s) - EPOCH) / DAY_MS);
export const dateForPuzzle = (n) => new Date(EPOCH + n * DAY_MS).toISOString().slice(0, 10);
export const mondayIndex = (s) => (new Date(toUTC(s)).getUTCDay() + 6) % 7;

export const scoreOf = (r) => (r.solved ? r.guesses : FAILED_SCORE);
export const scoreLabel = (r) => (r.solved ? `${r.guesses}` : 'X');
export const other = (p) => (p === 'p1' ? 'p2' : 'p1');

export function winnerOf(day) {
  if (!day || !day.p1 || !day.p2) return null;
  const a = scoreOf(day.p1);
  const b = scoreOf(day.p2);
  return a === b ? 'tie' : a < b ? 'p1' : 'p2';
}

// days: [puzzleNo, day][] in any order. Streaks count consecutive outright wins over played-by-both days.
export function computeStats(days) {
  const sorted = [...days].sort((a, b) => a[0] - b[0]);
  const s = { wins: { p1: 0, p2: 0 }, ties: 0, per: {} };
  for (const p of SLOTS) s.per[p] = { played: 0, solved: 0, total: 0, dist: [0, 0, 0, 0, 0, 0, 0], streak: 0, best: 0 };
  const run = { p1: 0, p2: 0 };
  for (const [, day] of sorted) {
    for (const p of SLOTS) {
      const r = day[p];
      if (!r) continue;
      const ps = s.per[p];
      ps.played++;
      if (r.solved) { ps.solved++; ps.total += r.guesses; ps.dist[r.guesses - 1]++; } else ps.dist[6]++;
    }
    const w = winnerOf(day);
    if (!w) continue;
    if (w === 'tie') s.ties++; else s.wins[w]++;
    for (const p of SLOTS) {
      run[p] = w === p ? run[p] + 1 : 0;
      s.per[p].best = Math.max(s.per[p].best, run[p]);
    }
  }
  for (const p of SLOTS) s.per[p].streak = run[p];
  return s;
}

// Outright wins from Monday through `today` (YYYY-MM-DD). getDay(puzzleNo) returns a day or undefined.
export function weekStandings(getDay, today) {
  const w = { p1: 0, p2: 0 };
  for (let i = 0; i <= mondayIndex(today); i++) {
    const res = winnerOf(getDay(puzzleNo(addDays(today, -i))));
    if (res === 'p1' || res === 'p2') w[res]++;
  }
  return w;
}
