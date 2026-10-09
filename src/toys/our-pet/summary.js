// The pet's line (and colour) for the couple home.
import { petHomeLine, COLOURS } from './pet.js';

// client: the Supabase client (passed in so this module loads under node tests).
export async function petHomeData(space, client) {
  const { data, error } = await client.rpc('pet_state');
  if (error) throw error;
  const pet = data?.pet;
  return {
    line: petHomeLine(data, Date.now(), space.couple.partner?.display_name ?? 'Your person'),
    colours: pet && !pet.died_at ? COLOURS[pet.colour] : null,
    dead: Boolean(pet?.died_at),
  };
}
