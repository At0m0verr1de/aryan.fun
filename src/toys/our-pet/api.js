// All Supabase access for the pet. The meters live in the database; the page only reads them and asks to
// feed, play or cuddle (each with a daily allowance) or to hatch a new egg.
import { supabase } from '../../shared/supabase.js';

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
};

export const loadPet = () => rpc('pet_state');
export const adopt = (name, colour) => rpc('pet_adopt', { p_name: name, p_colour: colour });
export const act = (kind) => rpc('pet_act', { p_kind: kind });

// "Something happened to the pet, refetch". Carries nothing.
export function subscribe(roomId, onChange) {
  const channel = supabase.channel(`pet-${roomId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'changed' }, onChange).subscribe();
  return {
    ping: () => channel.send({ type: 'broadcast', event: 'changed', payload: {} }),
    close: () => supabase.removeChannel(channel),
  };
}
