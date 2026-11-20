// auth.js — sign up, sign in, sign out, and page-guard helpers.
//
// The app is open to everyone: most pages work with no account (use getViewer, which returns null for a
// visitor). Pages that need an account (giving, prayer requests, profile…) use requireAuth, which sends the
// visitor to a friendly "Sign in or create an account to continue" screen and brings them straight back.
import { supabase } from "./supabaseClient.js";

/** True when this phone holds a saved sign-in (an instant check, no network). */
export function hasStoredSession() {
  try {
    return Object.keys(localStorage).some((k) => k.includes("-auth-token") && localStorage.getItem(k));
  } catch (e) {
    return false;
  }
}

/** The pages that need an account, and what to say the account is FOR ("You need an account to …"). */
const PAGE_REASONS = {
  "give.html": "give to the church online",
  "give-result.html": "confirm your gift",
  "giving-history.html": "see your giving history",
  "prayer.html": "send a prayer request",
  "profile.html": "see your profile",
  "edit-profile.html": "edit your profile",
  "saved-sermons.html": "see your saved sermons",
  "be-involved.html": "serve or join a team",
  "discipleship.html": "join discipleship",
  "notifications.html": "see your notifications",
  "admin.html": "open the dashboard",
};
const ACTION_REASONS = {
  "save-sermon": "save sermons",
  comment: "join the conversation",
  love: "show some love",
  "reading-plan": "track your reading plans",
  alerts: "get alerts on your phone",
};

/**
 * A page address that is safe to send someone back to after they sign in: a page of this app and nothing else
 * ("watch.html?kind=sermon&id=3"). Anything else (another site, a script, a path) gives null, so the sign-in
 * page can never be used to bounce a visitor somewhere else.
 */
export function safeNext(value) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return /^[a-z0-9][a-z0-9-]*\.html(\?[A-Za-z0-9_=&%.,:+-]*)?$/i.test(v) ? v : null;
}

/** The page being looked at now, as safeNext likes it: "watch.html?kind=sermon&id=3". */
function currentTarget() {
  const page = location.pathname.split("/").pop() || "index.html";
  return page + (location.search || "");
}

/** Where to send someone to sign in (or create an account) and then come back to `next` (default: this page). */
function accountUrl(base, { next, why } = {}) {
  const target = safeNext(next === undefined ? currentTarget() : next);
  const q = new URLSearchParams();
  if (target) q.set("next", target);
  if (why) q.set("why", why);
  return q.toString() ? `${base}?${q}` : base;
}
export const loginUrl = (options) => accountUrl("login.html", options);
export const signupUrl = (options) => accountUrl("signup.html", options);

/** Why an account is needed here, in a few words ("give to the church online"), or null if no reason applies. */
export function gateReason(next, why) {
  if (why && ACTION_REASONS[why]) return ACTION_REASONS[why];
  const page = typeof next === "string" ? next.split("?")[0] : "";
  return PAGE_REASONS[page] || null;
}

/** Where to go after signing in or creating an account: the page they came from, or Home. */
export function afterSignInTarget() {
  return safeNext(new URLSearchParams(location.search).get("next")) || "index.html";
}

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
  location.href = "index.html"; // back to the open app, as a visitor
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
 * Who is using the app? The signed-in member, or null for a visitor with no account.
 *
 * With no signal (or a connection that goes nowhere), a member who was already signed in stays signed in
 * and sees their saved content, instead of being treated as a visitor.
 */
async function resolveUser() {
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
  return null;
}

/**
 * For pages that work for everyone. Resolves with the signed-in member, or null for a visitor with no account.
 * Never redirects anywhere.
 */
export async function getViewer() {
  return resolveUser();
}

/**
 * Call at the top of any page that NEEDS an account. A visitor is sent to the "Sign in or create an account
 * to continue" screen, and brought straight back to this page afterwards; a member just gets their details.
 */
export async function requireAuth() {
  const user = await resolveUser();
  if (user) return user;
  location.href = loginUrl();
  return null;
}

/** Reacts to future sign-in/sign-out events on the current page. */
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}
