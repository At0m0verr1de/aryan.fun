// Group rankings. Pure, so they're testable. A "day" here is { [userId]: result } (only rows the
// no-spoiler rule let through), and `played` says who submitted even when their result is sealed.
import { scoreOf } from './scoring.js';

// Solved in 1 = 6 points … solved in 6 = 1; a fail or a skipped day = 0.
export const pointsOf = (r) => (r?.solved ? 7 - r.guesses : 0);

// One day, best first. Equal scores share a rank (earlier finisher listed first);
// then people who played but are sealed to you, then people who haven't played.
export function rankDay(members, day = {}, played = new Set()) {
  const rows = members.map((member) => {
    const result = day[member.user_id] ?? null;
    return { member, result, played: Boolean(result) || played.has(member.user_id), rank: null };
  });
  const scored = rows.filter((r) => r.result)
    .sort((a, b) => scoreOf(a.result) - scoreOf(b.result) || String(a.result.created_at ?? '').localeCompare(String(b.result.created_at ?? '')));
  scored.forEach((r, i) => {
    r.rank = i && scoreOf(scored[i - 1].result) === scoreOf(r.result) ? scored[i - 1].rank : i + 1;
  });
  return [...scored, ...rows.filter((r) => !r.result && r.played), ...rows.filter((r) => !r.played)];
}

// Days played in a row up to `to` (today not played yet doesn't break it), looking back no further than `floor`.
export function streakOf(userId, getDay, to, floor) {
  let n = getDay(to)?.[userId] ? to : to - 1;
  let streak = 0;
  while (n >= floor && getDay(n)?.[userId]) { streak++; n--; }
  return streak;
}

// Points table for puzzles from..to. Ties on points share a rank; a better average breaks the listing order.
export function standings(members, getDay, from, to, floor = from) {
  const rows = members.map((member) => {
    const s = { member, points: 0, played: 0, solved: 0, avg: null, streak: streakOf(member.user_id, getDay, to, floor), rank: 0 };
    let guesses = 0;
    for (let n = from; n <= to; n++) {
      const r = getDay(n)?.[member.user_id];
      if (!r) continue;
      s.played++;
      s.points += pointsOf(r);
      if (r.solved) { s.solved++; guesses += r.guesses; }
    }
    s.avg = s.solved ? guesses / s.solved : null;
    return s;
  });
  rows.sort((a, b) => b.points - a.points || (a.avg ?? 99) - (b.avg ?? 99) || b.played - a.played);
  rows.forEach((r, i) => { r.rank = i && rows[i - 1].points === r.points ? rows[i - 1].rank : i + 1; });
  return rows;
}

// The line above today's table: progress, then the winner once everyone visible has played.
export function dayHeadline(rows, meId, isToday) {
  const played = rows.filter((r) => r.played).length;
  const scored = rows.filter((r) => r.result);
  const name = (r) => (r.member.user_id === meId ? 'You' : r.member.display_name);
  if (rows.length < 2) return 'Just you so far. Invite your people 💌';
  if (!played) return isToday ? 'Nobody has played yet. Go first 👀' : 'Nobody played this day';
  const me = rows.find((r) => r.member.user_id === meId);
  if (me && !me.result && scored.length < played) return `${played} of ${rows.length} played. Add yours to see their boards 🤫`;
  const top = scored.filter((r) => r.rank === 1);
  if (scored.length < 2 || !top.length) return `${played} of ${rows.length} played`;
  const score = top[0].result.solved ? `${top[0].result.guesses}/6` : 'X/6';
  const who = top.length === 1 ? name(top[0]) : top.length === 2 ? `${name(top[0])} & ${name(top[1])}` : `${top.length} people`;
  const verb = top.length === 1 ? (name(top[0]) === 'You' ? 'lead' : 'leads') : 'share the lead';
  const done = played === rows.length || !isToday;
  return done ? `👑 ${who} ${top.length === 1 ? (name(top[0]) === 'You' ? 'win' : 'wins') : 'tie'} with ${score}` : `${who} ${verb} with ${score} · ${played} of ${rows.length} played`;
}
