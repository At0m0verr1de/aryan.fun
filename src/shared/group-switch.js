// The header's group switcher (Groups mode only): pick a group from any page, invite people, start or join one.
// Pages that can redraw for another group set data-groups="live" on <html> and listen for GROUP_EVENT;
// anywhere else, choosing a group takes you to its leaderboard.
import { supabase } from './supabase.js';
import { loadSpace, setGroup, groupChanged, setMode, EMOJIS, GROUP_ICONS, GROUP_MAX, GROUP_EVENT, emojiOf } from './space.js';
import { track, reportError } from './telemetry.js';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const WORDLE = `${BASE}wordle-duo/`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const box = document.querySelector('[data-groups]');
const menu = box.querySelector('[data-gs-menu]');
const toggle = box.querySelector('[data-gs="toggle"]');
const dialog = document.querySelector('[data-gs-dialog]');
const form = dialog.querySelector('[data-gs-form]');
let user = null;
let space = null;

const live = () => document.documentElement.dataset.groups === 'live';
const inviteLink = (g) => `${location.origin}${WORDLE}?join=${g.invite_code}`;

function setMenu(open) {
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
}

// Draw the chip and its menu. Hidden in partner mode, signed out, or without an invite.
export function renderGroups(s, u) {
  space = s;
  user = u;
  box.hidden = !s || s.mode !== 'general' || !s.access;
  if (box.hidden) return;
  const g = s.group;
  box.querySelector('[data-gs-icon]').textContent = g ? g.icon : '＋';
  box.querySelector('[data-gs-name]').textContent = g ? g.name : 'Start a group';
  box.querySelector('[data-gs-list]').innerHTML = s.groups.map((x) => `<button role="menuitem" type="button" data-gs="pick" data-id="${x.id}"
    aria-current="${x.id === g?.id}"><span>${esc(x.icon)}</span><span>${esc(x.name)}</span><span class="gs-count">${x.members.length}/${x.max_members}</span></button>`).join('');
  box.querySelector('[data-gs-sep]').hidden = !s.groups.length;
  box.querySelector('[data-gs="invite"]').hidden = !g;
}

function picker(name, choices, chosen) {
  return `<div class="gs-pick" data-gs-pick><input type="hidden" name="${name}" value="${esc(chosen)}">${choices.map((c) =>
    `<button type="button" class="${c === chosen ? 'on' : ''}" data-gs-choice="${c}" aria-label="${c}">${c}</button>`).join('')}</div>`;
}

// One dialog, two jobs: start a group, or type an invite code.
function openDialog(kind) {
  form.dataset.kind = kind;
  dialog.querySelector('[data-gs-error]').hidden = true;
  const me = space?.groups.flatMap((g) => g.members).find((m) => m.user_id === user?.id) ?? space?.couple?.me;
  if (kind === 'new') {
    dialog.querySelector('[data-gs-title]').textContent = 'New group';
    dialog.querySelector('[data-gs-submit]').textContent = 'Create';
    dialog.querySelector('[data-gs-fields]').innerHTML = `
      <label>Group name<input class="field-input" name="name" maxlength="40" placeholder="College gang" required></label>
      <label>Icon</label>${picker('icon', GROUP_ICONS, GROUP_ICONS[1])}
      <label>Your name in it<input class="field-input" name="display" maxlength="24" value="${esc(me?.display_name ?? user?.user_metadata?.full_name?.split(' ')[0] ?? '')}" required></label>
      <label>Your emoji</label>${picker('emoji', EMOJIS, me ? emojiOf(me) : EMOJIS[0])}
      <p class="muted" style="margin:10px 0 0;font-size:.85rem">Up to ${GROUP_MAX} people. You'll get an invite link next.</p>`;
  } else {
    dialog.querySelector('[data-gs-title]').textContent = 'Join with a code';
    dialog.querySelector('[data-gs-submit]').textContent = 'Continue';
    dialog.querySelector('[data-gs-fields]').innerHTML = `
      <label>Invite code<input class="field-input code" name="code" maxlength="6" placeholder="AB12CD" required autocomplete="off"></label>`;
  }
  dialog.showModal();
  dialog.querySelector('input:not([type=hidden])')?.focus();
}

async function share(g, button) {
  const link = inviteLink(g);
  const label = button.querySelector('span');
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Wordle Leaderboard', text: `Join "${g.name}" on my Wordle leaderboard ${g.icon}`, url: link });
      track('wordle_invite_shared', { method: 'share', where: 'header' });
      return;
    }
  } catch { /* cancelled or unsupported: copy instead */ }
  try {
    await navigator.clipboard.writeText(link);
    track('wordle_invite_shared', { method: 'copy', where: 'header' });
    label.textContent = 'Link copied ✓';
    setTimeout(() => { label.textContent = 'Invite people'; }, 1800);
  } catch {
    prompt('Copy this invite link:', link);
  }
}

// Somewhere other than the home page or Wordle: go to the group's leaderboard.
function goToGroup(id) {
  if (!live()) location.href = `${WORDLE}?room=${id}`;
}

box.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-gs]');
  if (!el) return;
  const action = el.dataset.gs;
  if (action === 'toggle') { setMenu(menu.hidden); return; }
  setMenu(false);
  if (action === 'pick') {
    track('group_switched');
    setGroup(space, el.dataset.id);
    renderGroups(space, user);
    goToGroup(el.dataset.id);
  }
  if (action === 'invite' && space?.group) await share(space.group, el);
  if (action === 'new' || action === 'join') openDialog(action);
});

dialog.addEventListener('click', (e) => {
  const choice = e.target.closest('[data-gs-choice]');
  if (choice) {
    const pick = choice.closest('[data-gs-pick]');
    pick.querySelector('input').value = choice.dataset.gsChoice;
    pick.querySelectorAll('[data-gs-choice]').forEach((b) => b.classList.toggle('on', b === choice));
  }
  if (e.target.closest('[data-gs="cancel"]')) dialog.close();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(form);
  if (form.dataset.kind === 'join') {
    location.href = `${WORDLE}?join=${encodeURIComponent(String(f.get('code')).trim())}`;
    return;
  }
  const submit = dialog.querySelector('[data-gs-submit]');
  submit.disabled = true;
  try {
    const { data, error } = await supabase.rpc('wordle_create_room', {
      p_name: String(f.get('name')).trim(), p_display_name: String(f.get('display')).trim(),
      p_emoji: f.get('emoji'), p_kind: 'group', p_icon: f.get('icon'),
    });
    if (error) throw error;
    track('wordle_room_created', { kind: 'group', where: 'header' });
    dialog.close();
    setMode('general');
    space = await groupChanged(user, data.id);
    renderGroups(space, user);
    goToGroup(data.id);
  } catch (err) {
    reportError(err, 'header-new-group');
    const msg = dialog.querySelector('[data-gs-error]');
    msg.textContent = err?.message === 'invite only' ? 'Starting groups is invite-only for now.' : err?.message || 'Something went wrong';
    msg.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

document.addEventListener('click', (e) => { if (!box.contains(e.target)) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
// Pages (or this menu) changed the group or the list: redraw the chip.
window.addEventListener(GROUP_EVENT, async () => {
  if (!user) return;
  try { renderGroups(await loadSpace(user), user); } catch (err) { reportError(err, 'header-groups'); }
});
