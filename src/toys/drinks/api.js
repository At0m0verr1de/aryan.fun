// All Supabase access for Drinks. Rules (you + your partner only) live in supabase/migrations/*_drinks.sql.
import { supabase } from '../../shared/supabase.js';

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// Rows the rules let us see: ours and our partner's, nobody else's.
export async function loadRange(from, to) {
  const [drinks, notes, goals] = await Promise.all([
    supabase.from('drinks').select('id, user_id, day, kind, ml, abv, qty, created_at').gte('day', from).lte('day', to).order('created_at'),
    supabase.from('drink_days').select('user_id, day, hangover, note').gte('day', from).lte('day', to),
    supabase.from('drink_goals').select('user_id, weekly_shots'),
  ]);
  return { drinks: unwrap(drinks), notes: unwrap(notes), goals: unwrap(goals) };
}

export const addDrink = async ({ day, kind, ml, abv, qty }) =>
  unwrap(await supabase.from('drinks').insert({ day, kind, ml, abv, qty }).select('id').single());

export const deleteDrink = async (id) => unwrap(await supabase.from('drinks').delete().eq('id', id));

// One row per person per night; clearing both fields removes it.
export async function saveNote(day, hangover, note) {
  if (hangover == null && !note) return unwrap(await supabase.from('drink_days').delete().eq('day', day));
  return unwrap(await supabase.from('drink_days')
    .upsert({ day, hangover, note: note || null, updated_at: new Date().toISOString() }, { onConflict: 'user_id,day' }));
}

export const saveGoal = async (weeklyShots) =>
  unwrap(await supabase.from('drink_goals')
    .upsert({ weekly_shots: weeklyShots, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }));

// "Something changed, refetch" between the two of you. Carries nothing, so nothing leaks.
export function subscribe(roomId, onChange) {
  const channel = supabase.channel(`drinks-${roomId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'changed' }, onChange).subscribe();
  return {
    ping: () => channel.send({ type: 'broadcast', event: 'changed', payload: {} }),
    close: () => supabase.removeChannel(channel),
  };
}
