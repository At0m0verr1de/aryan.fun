// All Supabase access for Wordle Duo. Security rules live in supabase/migrations/*_wordle_duo.sql.
import { supabase } from '../../shared/supabase.js';

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const listMyRooms = async () =>
  unwrap(await supabase.from('wordle_rooms').select('id, name, kind, invite_code, created_by, created_at').order('created_at'));

export const createRoom = async (name, displayName, emoji, kind = 'duo') =>
  unwrap(await supabase.rpc('wordle_create_room', { p_name: name, p_display_name: displayName, p_emoji: emoji, p_kind: kind }));

// Make a duo room your couple room (or undo it) and set the together-since date.
export const setCouple = async (roomId, couple, since) =>
  unwrap(await supabase.rpc('wordle_set_couple', { p_room: roomId, p_couple: couple, p_since: since }));

export const previewRoom = async (code) =>
  unwrap(await supabase.rpc('wordle_room_preview', { p_code: code }))?.[0] ?? null;

export const joinRoom = async (code, displayName, emoji) =>
  unwrap(await supabase.rpc('wordle_join_room', { p_code: code, p_display_name: displayName, p_emoji: emoji }));

// Everything a room view needs. Rows the no-spoiler rule hides simply don't come back.
export async function loadRoom(roomId, fromPuzzle) {
  const [room, members, results, submissions] = await Promise.all([
    supabase.from('wordle_rooms').select('id, name, kind, since, max_members, invite_code, created_by').eq('id', roomId).maybeSingle(),
    supabase.from('wordle_members').select('user_id, slot, display_name, emoji').eq('room_id', roomId).order('slot'),
    supabase.from('wordle_results').select('user_id, puzzle_no, solved, guesses, grid, source, words, answer, verified')
      .eq('room_id', roomId).gte('puzzle_no', fromPuzzle),
    supabase.rpc('wordle_submissions', { p_room: roomId, p_from_puzzle: fromPuzzle }),
  ]);
  return { room: unwrap(room), members: unwrap(members), results: unwrap(results), submissions: unwrap(submissions) };
}

export const submitResult = async (roomId, userId, puzzle, r) =>
  unwrap(await supabase.from('wordle_results').insert({
    room_id: roomId, user_id: userId, puzzle_no: puzzle,
    solved: r.solved, guesses: r.solved ? r.guesses : null, grid: r.grid || [], source: r.source,
    words: r.words ?? null, answer: r.answer ?? null, verified: Boolean(r.verified),
  }));

export const deleteResult = async (roomId, userId, puzzle) =>
  unwrap(await supabase.from('wordle_results').delete().match({ room_id: roomId, user_id: userId, puzzle_no: puzzle }));

export const updateMe = async (roomId, userId, patch) =>
  unwrap(await supabase.from('wordle_members').update(patch).match({ room_id: roomId, user_id: userId }));

export const renameRoom = async (roomId, name) =>
  unwrap(await supabase.from('wordle_rooms').update({ name }).eq('id', roomId));

export const leaveRoom = async (roomId, userId) =>
  unwrap(await supabase.from('wordle_members').delete().match({ room_id: roomId, user_id: userId }));

// A "something changed, refetch" ping between the two of you. Carries no scores, so nothing leaks.
export function subscribe(roomId, onChange) {
  const channel = supabase.channel(`wordle-${roomId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'changed' }, onChange).subscribe();
  return {
    ping: () => channel.send({ type: 'broadcast', event: 'changed', payload: {} }),
    close: () => supabase.removeChannel(channel),
  };
}
