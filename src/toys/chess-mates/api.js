// All Supabase access for Chess Mates. Games are fetched from chess.com by the database
// (supabase/migrations/*_chess.sql); the page can only read them, set usernames, and ask for a sync.
import { supabase } from '../../shared/supabase.js';

const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
};

export const loadChess = () => rpc('chess_state');
export const setNames = (mine, partner) => rpc('chess_set_names', { p_mine: mine, p_partner: partner });
export const sync = () => rpc('chess_sync');

// Quick check before saving, straight from the browser (chess.com allows any site to read its public API).
export async function playerExists(username) {
  const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username.trim().toLowerCase())}`);
  if (res.status === 404) return false;
  return true; // anything else (429, offline) shouldn't block saving; the sync will report a real problem
}

// "New games, refetch" between the two of you. Carries nothing.
export function subscribe(roomId, onChange) {
  const channel = supabase.channel(`chess-${roomId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'changed' }, onChange).subscribe();
  return {
    ping: () => channel.send({ type: 'broadcast', event: 'changed', payload: {} }),
    close: () => supabase.removeChannel(channel),
  };
}
