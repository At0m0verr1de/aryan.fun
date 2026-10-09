// One-line Kitne Ka? status for the couple home.
import { kitneLine } from './price.js';

// client: the Supabase client (passed in so this module loads under node tests).
export async function kitneHomeData(space, client) {
  const { data, error } = await client.rpc('price_today');
  if (error) throw error;
  return kitneLine(data, space.couple.partner?.display_name ?? 'Your person');
}
