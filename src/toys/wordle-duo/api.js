// All Supabase access for Wordle. Security rules live in supabase/migrations/*_wordle_duo.sql and *_groups.sql.
// A result belongs to the person (one per puzzle) and shows in every room they share with you.
import { supabase } from '../../shared/supabase.js';

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export const createRoom = async (name, displayName, emoji, kind = 'group', icon = null) =>
  unwrap(await supabase.rpc('wordle_create_room', { p_name: name, p_display_name: displayName, p_emoji: emoji, p_kind: kind, p_icon: icon }));

// Make a group of two your couple room (or undo it) and set the together-since date.
export const setCouple = async (roomId, couple, since) =>
  unwrap(await supabase.rpc('wordle_set_couple', { p_room: roomId, p_couple: couple, p_since: since }));

export const previewRoom = async (code) =>
  unwrap(await supabase.rpc('wordle_room_preview', { p_code: code }))?.[0] ?? null;

// The group's creator removing someone.
export const removeMember = async (roomId, userId) =>
  unwrap(await supabase.rpc('wordle_remove_member', { p_room: roomId, p_user: userId }));

export const joinRoom = async (code, displayName, emoji) =>
  unwrap(await supabase.rpc('wordle_join_room', { p_code: code, p_display_name: displayName, p_emoji: emoji }));

// Everything a room view needs. Rows the no-spoiler rule hides simply don't come back.
export async function loadRoom(roomId, fromPuzzle) {
  const [room, members, submissions] = await Promise.all([
    supabase.from('wordle_rooms').select('id, name, icon, kind, since, max_members, invite_code, created_by, created_at').eq('id', roomId).maybeSingle(),
    supabase.from('wordle_members').select('user_id, slot, display_name, emoji, joined_at').eq('room_id', roomId).order('slot'),
    supabase.rpc('wordle_submissions', { p_room: roomId, p_from_puzzle: fromPuzzle }),
  ]);
  const people = unwrap(members);
  const results = people.length
    ? unwrap(await supabase.from('wordle_results').select('user_id, puzzle_no, solved, guesses, grid, source, words, answer, verified, created_at')
      .in('user_id', people.map((m) => m.user_id)).gte('puzzle_no', fromPuzzle))
    : [];
  return { room: unwrap(room), members: people, results, submissions: unwrap(submissions) };
}

export const submitResult = async (userId, puzzle, r) =>
  unwrap(await supabase.from('wordle_results').insert({
    user_id: userId, puzzle_no: puzzle,
    solved: r.solved, guesses: r.solved ? r.guesses : null, grid: r.grid || [], source: r.source,
    words: r.words ?? null, answer: r.answer ?? null, verified: Boolean(r.verified),
  }));

export const deleteResult = async (userId, puzzle) =>
  unwrap(await supabase.from('wordle_results').delete().match({ user_id: userId, puzzle_no: puzzle }));

export const updateMe = async (roomId, userId, patch) =>
  unwrap(await supabase.from('wordle_members').update(patch).match({ room_id: roomId, user_id: userId }));

// Creator only: { name, icon }.
export const updateRoom = async (roomId, patch) =>
  unwrap(await supabase.from('wordle_rooms').update(patch).eq('id', roomId));

export const leaveRoom = async (roomId, userId) =>
  unwrap(await supabase.from('wordle_members').delete().match({ room_id: roomId, user_id: userId }));

// A "something changed, refetch" ping to everyone in the room. Carries no scores, so nothing leaks.
export function subscribe(roomId, onChange) {
  const channel = supabase.channel(`wordle-${roomId}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'changed' }, onChange).subscribe();
  return {
    ping: () => channel.send({ type: 'broadcast', event: 'changed', payload: {} }),
    close: () => supabase.removeChannel(channel),
  };
}
