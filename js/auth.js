// auth.js — sign up, sign in, sign out, and page-guard helpers.
import { supabase } from "./supabaseClient.js";

/** Creates the auth user AND a matching row in `profiles`. */
export async function signUp({ email, password, name }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  if (error) throw error;

  // If email confirmation is off, we already have a session and can create the profile now.
  // If confirmation is required, this runs after the user's first sign-in instead (see ensureProfile below).
  if (data.user) {
    await ensureProfile(data.user, name);
  }
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data.user) {
    await ensureProfile(data.user);
    await pullThemeFromAccount(data.user.id);
  }
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  location.href = "login.html";
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Creates a profiles row the first time we see this user (safe to call repeatedly). */
async function ensureProfile(user, name) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    await supabase.from("profiles").insert({
      id: user.id,
      name: name || user.user_metadata?.name || user.email.split("@")[0],
      member_id: `FLD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      avatar_initial: (name || user.email)[0].toUpperCase(),
    });
  }
}

/** On a new phone, bring across the Dark/Light choice and accent colour saved on the account. */
async function pullThemeFromAccount(userId) {
  try {
    const { data } = await supabase.from("user_settings").select("theme, accent").eq("user_id", userId).maybeSingle();
    if (data?.theme) localStorage.setItem("flood-theme", data.theme);
    if (data?.accent) localStorage.setItem("flood-accent", data.accent);
  } catch (e) {
    /* the theme just stays as it is on this phone */
  }
}

/** The member saved on this phone from their last sign-in (used when we can't reach the server). */
function storedUser() {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.includes("-auth-token")) continue;
      const parsed = JSON.parse(localStorage.getItem(key));
      const user = parsed?.user || parsed?.currentSession?.user;
      if (user?.id) return user;
    }
  } catch (e) {}
  return null;
}

const SLOW_SESSION_MS = 4000;

/**
 * Call at the top of any page that requires a signed-in user.
 * Redirects to login.html if there's no session, otherwise resolves with the user.
 *
 * With no signal (or a connection that goes nowhere), a member who was already signed in
 * stays signed in and sees their saved content, instead of being sent to a login page
 * they can't use without internet.
 */
export async function requireAuth() {
  // Fully offline: no need to wait for anything.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const user = storedUser();
    if (user) return user;
  }

  const pending = supabase.auth.getSession();
  let result = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve(null), SLOW_SESSION_MS))]);

  if (result === null) {
    // Taking too long — probably refreshing a login over a dead connection.
    const user = storedUser();
    if (user) return user;
    result = await pending;
  }

  const session = result?.data?.session;
  if (session) return session.user;

  const error = result?.error;
  const unreachable = error && (error.name === "AuthRetryableFetchError" || error.status === 0 || /fetch|network/i.test(error.message || ""));
  if (unreachable) {
    const user = storedUser();
    if (user) return user;
  }

  location.href = "login.html";
  return null;
}

/** Reacts to future sign-in/sign-out events on the current page. */
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}
