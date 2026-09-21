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
  if (data.user) await ensureProfile(data.user);
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

/**
 * Call at the top of any page that requires a signed-in user.
 * Redirects to login.html if there's no session, otherwise resolves with the user.
 */
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.href = "login.html";
    return null;
  }
  return session.user;
}

/** Reacts to future sign-in/sign-out events on the current page. */
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}
