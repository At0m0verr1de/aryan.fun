// One-line Drinks status for the couple home: this week's shots for each of you.
import { personStats, mondayOf, addDays, round1, dateStr } from './stats.js';

export function drinksLine(drinks, members, meId, today) {
  const week = mondayOf(today);
  const totals = members.map((m) => ({ m, shots: personStats(drinks, m.user_id, week, addDays(week, 6), today).total }));
  if (!totals.some((t) => t.shots)) return 'A dry week so far 🌱';
  return `This week: ${totals.map(({ m, shots }) => `${m.user_id === meId ? 'you' : m.display_name} ${round1(shots)}`).join(' · ')} shots`;
}

// client: the Supabase client (passed in so this module loads under node tests).
export async function drinksHomeData(space, client) {
  const today = dateStr(new Date());
  const { data, error } = await client.from('drinks').select('user_id, day, kind, ml, abv, qty').gte('day', mondayOf(today));
  if (error) throw error;
  return drinksLine(data, space.couple.members, space.couple.me.user_id, today);
}
