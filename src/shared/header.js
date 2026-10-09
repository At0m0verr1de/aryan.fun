// Site header: shows "Sign in" or the profile menu, keeps it in sync with the session,
// and logs account lifecycle events (it's on every page, so it's the one place that sees them all).
import { isConfigured, currentUser, onUserChange, signInWithGoogle, signOut, fullName } from './supabase.js';
import { loadSpace, setMode, emojiOf } from './space.js';
import { track, reportError, setUser, flush, isNewSession } from './telemetry.js';

const FRESH_MS = 5 * 60 * 1000; // created/signed-in this recently means it happened on this page load

const root = document.querySelector('[data-account]');
const menu = root.querySelector('[data-menu]');
const toggle = root.querySelector('[data-auth="toggle"]');
const modeRow = root.querySelector('[data-mode-row]');
let reported = false;

function render(user) {
  root.dataset.state = user ? 'in' : 'out';
  if (!user) return;
  const name = fullName(user);
  root.querySelector('[data-name]').textContent = name;
  root.querySelector('[data-email]').textContent = user.email ?? '';
  root.querySelector('[data-initial]').textContent = name.charAt(0).toUpperCase();
  loadSpace(user).then(renderSpace).catch((err) => reportError(err, 'header-space'));
}

// Emoji avatar, couple wordmark, and the (hidden unless you have a partner) mode switch.
function renderSpace(space) {
  const me = space.couple?.me;
  if (me) {
    root.querySelector('[data-initial]').textContent = emojiOf(me);
    toggle.classList.add('emoji');
  }
  modeRow.hidden = !space.couple;
  modeRow.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === space.mode)));
  const partner = space.couple?.partner;
  if (space.mode === 'couple' && me && partner) {
    document.querySelector('[data-wordmark]').textContent = `${me.display_name} & ${partner.display_name}`;
  }
}

function setMenu(open) {
  menu.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
}

// True the first time this browser sees `key`, so a reload doesn't log the same sign-in twice.
function firstTime(key) {
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
  } catch { /* storage blocked: log anyway */ }
  return true;
}

const fresh = (iso) => Boolean(iso) && Date.now() - Date.parse(iso) < FRESH_MS;

function logAuth(user) {
  setUser(user?.id);
  if (user && fresh(user.created_at) && firstTime(`mba:created:${user.id}`)) {
    track('account_created', { provider: user.app_metadata?.provider ?? 'unknown' });
  } else if (user && fresh(user.last_sign_in_at) && firstTime(`mba:signin:${user.id}:${user.last_sign_in_at}`)) {
    track('sign_in', { provider: user.app_metadata?.provider ?? 'unknown' });
  }
  if (!reported && isNewSession) {
    reported = true;
    track('session_start', {
      signed_in: Boolean(user),
      referrer: document.referrer ? new URL(document.referrer).hostname : null,
      width: innerWidth,
      lang: navigator.language,
      installed: matchMedia('(display-mode: standalone)').matches,
    });
  }
}

root.addEventListener('click', async (e) => {
  const action = e.target.closest('[data-auth]')?.dataset.auth;
  if (action === 'toggle') setMenu(menu.hidden);
  if (action === 'mode') {
    const mode = e.target.closest('[data-mode]').dataset.mode;
    track('mode_switched', { mode });
    setMode(mode);
    location.href = root.querySelector('[data-home-link]').href;
  }
  if (action === 'signin' || action === 'switch') {
    try { await signInWithGoogle(); } catch (err) { reportError(err, 'header-signin'); }
  }
  if (action === 'signout') {
    setMenu(false);
    track('sign_out');
    flush();
    await signOut();
    location.reload();
  }
});
document.addEventListener('click', (e) => { if (!root.contains(e.target)) setMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

if (isConfigured) {
  const authError = new URLSearchParams(location.search).get('error_description');
  if (authError) track('sign_in_failed', { message: authError });
  onUserChange((user) => {
    render(user);
    logAuth(user);
  });
  // Finishes any Google redirect in the URL and tidies the address bar.
  currentUser().catch((err) => {
    reportError(err, 'session');
    render(null);
  });
} else {
  root.dataset.state = 'out';
}
