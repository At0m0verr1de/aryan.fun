// One-line Chess Mates status for the couple home.
import { chessLine } from './chess.js';

// client: the Supabase client (passed in so this module loads under node tests).
export async function chessHomeData(space, client) {
  const { data, error } = await client.rpc('chess_state');
  if (error) throw error;
  if (!data || data.names.length < 2) return 'Add your chess.com usernames to start ♟';
  const { me, partner } = space.couple;
  return chessLine(data.games, me.user_id, partner?.user_id, partner?.display_name ?? 'Your person');
}
