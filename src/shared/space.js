// Who you are on this site: whether you're let in (invite-only for now), your couple, your rooms,
// and which mode you're in. The header, the home page and toys share one fetch per page.
import { supabase } from './supabase.js';

const MODE_KEY = 'mba:mode';

export const EMOJIS = ['🐼', '🐱', '🐻', '🐰', '🦊', '🐶', '🐨', '🐯', '🦁', '🐸', '🐧', '🦄',
  '🐙', '🐝', '🌸', '🌻', '🍓', '🍑', '⭐', '🌙', '🔥', '💎', '👑', '🫶'];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let cached = null;

// { access, rooms, couple: { room, me, partner } | null, mode: 'couple' | 'general' }
export function loadSpace(user) {
  if (cached?.userId !== user.id) cached = { userId: user.id, promise: fetchSpace(user) };
  return cached.promise;
}

// Call after anything that changes rooms or couples, so the next loadSpace refetches.
export function forgetSpace() {
  cached = null;
}

async function fetchSpace(user) {
  const [rooms, access] = await Promise.all([
    supabase.from('wordle_rooms').select('id, name, kind, since, invite_code, created_by').order('created_at'),
    supabase.rpc('site_has_access'),
  ]);
  if (rooms.error) throw rooms.error;
  if (access.error) throw access.error;
  const coupleRoom = rooms.data.find((r) => r.kind === 'couple') ?? null;
  let couple = null;
  if (coupleRoom) {
    const { data: members, error } = await supabase.from('wordle_members')
      .select('user_id, slot, display_name, emoji').eq('room_id', coupleRoom.id).order('slot');
    if (error) throw error;
    couple = {
      room: coupleRoom,
      members,
      me: members.find((m) => m.user_id === user.id),
      partner: members.find((m) => m.user_id !== user.id) ?? null,
    };
  }
  const space = { access: Boolean(access.data), rooms: rooms.data, couple, mode: 'general' };
  space.mode = couple && store.get(MODE_KEY) !== 'general' ? 'couple' : 'general';
  applyMode(space.mode);
  return space;
}

// Couple mode is the default whenever you have a partner; general is the hidden alternative.
export function setMode(mode) {
  store.set(MODE_KEY, mode);
  applyMode(mode);
}

// data-mode drives the couple theme. Layout.astro sets it early from this key to avoid a flash.
function applyMode(mode) {
  document.documentElement.dataset.mode = mode;
  store.set(`${MODE_KEY}:last`, mode);
}

// Room emojis from before photos were briefly used are real; '-' was a placeholder.
export const emojiOf = (member) => (member?.emoji && member.emoji !== '-' ? member.emoji : '🙂');
