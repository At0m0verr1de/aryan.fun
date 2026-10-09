// All Supabase access for Kitne Ka?. Prices stay in the database until you've guessed.
import { supabase } from '../../shared/supabase.js';

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
};

export const loadToday = () => rpc('price_today');
export const guess = (slot, rupees) => rpc('price_guess', { p_slot: slot, p_guess: rupees });

// "Partner guessed something, refetch". Carries nothing.
export function subscribe(roomId, onChange) {
  const channel = supabase.channel(`kitne-${roomId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'changed' }, onChange).subscribe();
  return {
    ping: () => channel.send({ type: 'broadcast', event: 'changed', payload: {} }),
    close: () => supabase.removeChannel(channel),
  };
}
