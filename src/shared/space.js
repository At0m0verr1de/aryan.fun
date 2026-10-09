// Who you are on this site: whether you're let in (invite-only for now), your couple, your groups,
// the group you're looking at, and which mode you're in. The header, the home page and toys share one fetch per page.
import { supabase } from './supabase.js';

const MODE_KEY = 'mba:mode';
const GROUP_KEY = 'mba:group';
export const GROUP_MAX = 10;
export const GROUP_EVENT = 'mba:group-change';

export const EMOJIS = ['🐼', '🐱', '🐻', '🐰', '🦊', '🐶', '🐨', '🐯', '🦁', '🐸', '🐧', '🦄',
  '🐙', '🐝', '🌸', '🌻', '🍓', '🍑', '⭐', '🌙', '🔥', '💎', '👑', '🫶'];
export const GROUP_ICONS = ['🎲', '🍻', '🎮', '🏆', '🧠', '🔥', '🌮', '🎉', '🚀', '🍕', '☕', '🏏', '🎧', '📚', '🌴', '👾'];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let cached = null;

// { access, rooms, couple: { room, members, me, partner } | null, groups: [{ ...room, members }], group, mode }
export function loadSpace(user) {
  if (cached?.userId !== user.id) cached = { userId: user.id, promise: fetchSpace(user) };
  return cached.promise;
}

// Call after anything that changes rooms or couples, so the next loadSpace refetches.
export function forgetSpace() {
  cached = null;
}

async function fetchSpace(user) {
  const [rooms, members, access] = await Promise.all([
    supabase.from('wordle_rooms').select('id, name, icon, kind, since, invite_code, created_by, max_members').order('created_at'),
    supabase.from('wordle_members').select('room_id, user_id, slot, display_name, emoji').order('slot'),
    supabase.rpc('site_has_access'),
  ]);
  for (const r of [rooms, members, access]) if (r.error) throw r.error;
  const withMembers = rooms.data.map((r) => ({ ...r, members: members.data.filter((m) => m.room_id === r.id) }));
  const coupleRoom = withMembers.find((r) => r.kind === 'couple') ?? null;
  const couple = coupleRoom && {
    room: coupleRoom,
    members: coupleRoom.members,
    me: coupleRoom.members.find((m) => m.user_id === user.id),
    partner: coupleRoom.members.find((m) => m.user_id !== user.id) ?? null,
  };
  const groups = withMembers.filter((r) => r.kind === 'group');
  const space = { access: Boolean(access.data), rooms: rooms.data, couple, groups, group: null, mode: 'general' };
  space.group = groups.find((g) => g.id === store.get(GROUP_KEY)) ?? groups[0] ?? null;
  space.mode = couple && store.get(MODE_KEY) !== 'general' ? 'couple' : 'general';
  applyMode(space.mode);
  return space;
}

// Pick the group you're looking at. Pages listen for GROUP_EVENT and redraw in place.
export function setGroup(space, id) {
  const group = space.groups.find((g) => g.id === id);
  if (!group) return;
  store.set(GROUP_KEY, id);
  if (space.group?.id === id) return;
  space.group = group;
  window.dispatchEvent(new CustomEvent(GROUP_EVENT, { detail: { id } }));
}

// After creating or joining one: remember it, refetch, and tell the page.
export async function groupChanged(user, id) {
  if (id) store.set(GROUP_KEY, id);
  forgetSpace();
  const space = await loadSpace(user);
  window.dispatchEvent(new CustomEvent(GROUP_EVENT, { detail: { id: space.group?.id ?? null } }));
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
