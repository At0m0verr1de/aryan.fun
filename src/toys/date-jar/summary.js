// One-line Date Jar status for the couple home.
import { jarLine } from './jar.js';

// client: the Supabase client (passed in so this module loads under node tests).
export async function jarHomeData(space, client) {
  const { data, error } = await client.rpc('jar_state');
  if (error) throw error;
  return jarLine(data.slips, space.couple.me.user_id);
}
