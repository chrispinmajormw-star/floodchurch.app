// notifications.js — shared logic for the in-app notification list, the
// unread badge on the bell, and sending notifications from the dashboard.
import { supabase } from "./supabaseClient.js";

// What each member has switched on in Settings → Notifications.
const DEFAULT_PREFS = {
  live_alerts: true,
  daily_verse: true,
  giving_receipts: false,
  ministry_updates: true,
};

// Which Settings toggle controls which kind of notification.
// "general" has no toggle: it always arrives.
const CATEGORY_PREF = {
  live: "live_alerts",
  verse: "daily_verse",
  devotion: "daily_verse",
  ministry: "ministry_updates",
  receipt: "giving_receipts",
};

export const CATEGORY_LABELS = {
  general: "General",
  live: "Live service",
  verse: "Verse of the Day",
  devotion: "Devotion",
  ministry: "Ministry news",
  receipt: "Giving receipt",
};

export function categoryAllowed(category, prefs) {
  const key = CATEGORY_PREF[category];
  return key ? Boolean(prefs[key]) : true;
}

export async function getPrefs(userId) {
  const { data } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  return { ...DEFAULT_PREFS, ...(data || {}) };
}

async function getSeenAt(userId) {
  const { data } = await supabase.from("profiles").select("notifications_seen_at").eq("id", userId).maybeSingle();
  return data?.notifications_seen_at || null;
}

/** Newest first, already filtered by the member's own preferences. */
export async function fetchNotifications(userId, limit = 50) {
  const [{ data, error }, prefs, seenAt] = await Promise.all([
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(limit),
    getPrefs(userId),
    getSeenAt(userId),
  ]);
  if (error) throw new Error(error.message);
  const seen = seenAt ? new Date(seenAt).getTime() : 0;
  return (data || [])
    .filter((n) => categoryAllowed(n.category, prefs))
    .map((n) => ({ ...n, unread: new Date(n.created_at).getTime() > seen }));
}

export async function getUnreadCount(userId) {
  const items = await fetchNotifications(userId, 50);
  return items.filter((n) => n.unread).length;
}

/**
 * Marks everything up to `newestIso` as read. We use the newest notification's
 * own (server) timestamp rather than the phone's clock, so a wrong clock on
 * someone's phone can't hide or resurrect notifications.
 */
export async function markAllRead(userId, newestIso) {
  if (!newestIso) return;
  await supabase.from("profiles").update({ notifications_seen_at: newestIso }).eq("id", userId);
}

/**
 * Staff only. Saves a broadcast notification (so it shows in everyone's bell)
 * and then asks the send-push function to buzz phones that opted in.
 * The in-app part always works; push is best-effort and reports what happened.
 */
export async function sendBroadcast({ title, body = "", url = "index.html", category = "general" }) {
  const { error } = await supabase.from("notifications").insert({ title, body, url, category });
  if (error) throw new Error(error.message);

  const push = { ok: false, sent: 0 };
  try {
    const { data, error: fnError } = await supabase.functions.invoke("send-push", {
      body: { title, body, url, category },
    });
    if (!fnError && data && !data.error) {
      push.ok = true;
      push.sent = data.sent ?? 0;
    }
  } catch (e) {
    /* push isn't set up yet — the in-app notification above still went out */
  }
  return push;
}

export function describePush(push) {
  if (!push.ok) return "Posted in the app. (Push alerts aren't set up yet, so nothing was sent to phones.)";
  if (push.sent === 0) return "Posted in the app. No phones have push turned on yet.";
  return `Posted in the app and pushed to ${push.sent} device${push.sent === 1 ? "" : "s"}.`;
}
