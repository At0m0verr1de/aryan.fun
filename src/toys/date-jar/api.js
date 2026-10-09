// All Supabase access for Date Jar. Every call is an RPC; the rules (couple only, folded partner slips,
// one shared draw, a veto a week) live in supabase/migrations/*_date_jar.sql.
import { supabase } from '../../shared/supabase.js';

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
};

export const loadJar = () => rpc('jar_state');

export const addSlip = ({ idea, cost, payer, place, length }) =>
  rpc('jar_add', { p_idea: idea, p_cost: cost, p_payer: payer, p_place: place, p_length: length });

export const removeSlip = (id) => rpc('jar_remove', { p_id: id });

export const draw = (mood) =>
  rpc('jar_draw', { p_place: mood.place ?? null, p_length: mood.length ?? null, p_max_cost: mood.max ?? null });

export const veto = (id) => rpc('jar_veto', { p_id: id });

export const done = (id, spent, rating, memory) =>
  rpc('jar_done', { p_id: id, p_spent: spent, p_rating: rating, p_memory: memory });

// "Something changed, refetch" between the two of you. Carries nothing, so nothing leaks.
export function subscribe(roomId, onChange) {
  const channel = supabase.channel(`jar-${roomId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'changed' }, onChange).subscribe();
  return {
    ping: () => channel.send({ type: 'broadcast', event: 'changed', payload: {} }),
    close: () => supabase.removeChannel(channel),
  };
}
