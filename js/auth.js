// auth.js — sign up, sign in, sign out, and current-session helpers.
import { supabase } from "./supabaseClient.js";

export async function signUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } }, // stored in auth.users' metadata
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Call this once per page that needs to react to login/logout (e.g. redirect if not signed in).
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}
