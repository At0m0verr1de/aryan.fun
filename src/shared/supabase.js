// One Supabase client for every toy. Toys import { supabase, currentUser, signInWithGoogle } from here.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

export const supabase = isConfigured
  ? createClient(url, anonKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

// Resolves once any OAuth redirect in the URL has been exchanged for a session.
export async function currentUser() {
  if (!supabase) throw new Error('supabase is not configured');
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  stripAuthParams();
  return data.session?.user ?? null;
}

// Sends the browser to Google and back to this exact page, so ?join= codes survive the trip.
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.href, queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
}

// Calls back with the signed-in user (or null) now and on every sign-in, sign-out, or token refresh.
export function onUserChange(callback) {
  if (!supabase) { callback(null); return () => {}; }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
  return () => data.subscription.unsubscribe();
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Google's first name, used to prefill name fields.
export function firstName(user) {
  const full = user?.user_metadata?.full_name || user?.user_metadata?.name || '';
  return full.split(' ')[0].slice(0, 24);
}

export const fullName = (user) => user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '';

// Google profile photo, or null when the account has none.
export const avatarUrl = (user) => user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;

function stripAuthParams() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return;
  for (const key of ['code', 'error', 'error_code', 'error_description']) params.delete(key);
  const query = params.toString();
  history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
}
