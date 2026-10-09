// One-line Wordle status for the couple home: who has played today, and this month's tally.
import { localDateStr, puzzleNo, winnerOf } from './scoring.js';

// Pure, so it's testable: members [{ user_id, slot, display_name }], meId, submissions [{ user_id, puzzle_no }],
// results [{ user_id, puzzle_no, solved, guesses }] (only what the no-spoiler rule returned), today = puzzle no.
export function summarize({ members, meId, submissions, results, today, monthStart }) {
  const me = members.find((m) => m.user_id === meId);
  const partner = members.find((m) => m.user_id !== meId);
  if (!partner) return { today: 'Waiting for your person to join 💌', tally: '' };
  const played = (m) => submissions.some((s) => s.user_id === m.user_id && s.puzzle_no === today);
  const slotOf = (m) => (m.slot === 1 ? 'p1' : 'p2');

  const days = new Map();
  for (const r of results) {
    const m = members.find((x) => x.user_id === r.user_id);
    if (!m) continue;
    const day = days.get(r.puzzle_no) || {};
    day[slotOf(m)] = r;
    days.set(r.puzzle_no, day);
  }

  let todayLine;
  if (played(me) && played(partner)) {
    const w = winnerOf(days.get(today));
    todayLine = w === 'tie' ? 'Tied today 💞' : w ? `${w === slotOf(me) ? 'You' : partner.display_name} won today 👑` : 'You both played today ✨';
  } else if (played(partner)) {
    todayLine = `${partner.display_name} played, your turn 👀`;
  } else if (played(me)) {
    todayLine = `Waiting for ${partner.display_name} 💌`;
  } else {
    todayLine = "New puzzle today. Who's first? 👀";
  }

  const wins = { me: 0, partner: 0, tie: 0 };
  for (const [n, day] of days) {
    if (n < monthStart) continue;
    const w = winnerOf(day);
    if (w === 'tie') wins.tie++;
    else if (w) wins[w === slotOf(me) ? 'me' : 'partner']++;
  }
  const games = wins.me + wins.partner + wins.tie;
  let tally = '';
  if (games) {
    const lead = wins.me === wins.partner ? `All square at ${wins.me}–${wins.partner}`
      : wins.me > wins.partner ? `You lead ${wins.me}–${wins.partner} 👑` : `${partner.display_name} leads ${wins.partner}–${wins.me} 👑`;
    tally = `${lead}${wins.tie ? ` · ${wins.tie} tie${wins.tie === 1 ? '' : 's'}` : ''}`;
  }
  return { today: todayLine, tally };
}

// client: the Supabase client (passed in so this module loads under node tests).
export async function coupleHomeData(space, client) {
  const today = puzzleNo(localDateStr());
  const monthStart = puzzleNo(localDateStr().slice(0, 8) + '01');
  const roomId = space.couple.room.id;
  const [subs, results] = await Promise.all([
    client.rpc('wordle_submissions', { p_room: roomId, p_from_puzzle: Math.min(monthStart, today) }),
    client.from('wordle_results').select('user_id, puzzle_no, solved, guesses').eq('room_id', roomId).gte('puzzle_no', monthStart),
  ]);
  if (subs.error) throw subs.error;
  if (results.error) throw results.error;
  return summarize({
    members: space.couple.members, meId: space.couple.me.user_id, submissions: subs.data, results: results.data, today, monthStart,
  });
}
