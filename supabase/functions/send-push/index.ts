// supabase/functions/send-push/index.ts
//
// Sends push notifications to members' phones. Who may call it:
//   • the DATABASE  — sends the x-push-secret header (this is how automatic alerts work)
//   • admins and pastors (signed in) — the dashboard's "Send a Notification" and friends
//   • any signed-in member — but ONLY for { mode: "test" }, which goes to their own phones
// Staff can also ask { mode: "status" } to see whether push is set up.
// The VAPID private key lives here as a Supabase secret and is never exposed to the browser.
//
// Deploy:  npx supabase functions deploy send-push --no-verify-jwt
// Secrets: npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com PUSH_INTERNAL_SECRET=...

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-secret",
};

// Mirrors js/notifications.js — which Settings toggle controls which category.
// (Categories not listed here — "general" and "staff" — are never muted.)
const CATEGORY_PREF: Record<string, string> = {
  live: "live_alerts",
  verse: "daily_verse",
  devotion: "daily_verse",
  ministry: "ministry_updates",
  receipt: "giving_receipts",
};
const DEFAULT_PREFS: Record<string, boolean> = {
  live_alerts: true,
  daily_verse: true,
  giving_receipts: false,
  ministry_updates: true,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Compares two secrets without revealing, by timing, how much of them matched. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** Sends to the right phones. respectPrefs=false is for a member's own test. */
async function deliver(
  admin: Db,
  msg: { title: string; body: string; url: string; category: string; userId: string | null; respectPrefs: boolean },
) {
  let subsQuery = admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
  if (msg.userId) subsQuery = subsQuery.eq("user_id", msg.userId);
  const { data: subs, error: subsError } = await subsQuery;
  if (subsError) return { error: subsError.message as string };
  if (!subs || subs.length === 0) return { sent: 0, failed: 0, skipped: 0, removed: 0 };

  // Respect each member's notification preferences.
  let targets = subs;
  if (msg.respectPrefs) {
    const userIds = [...new Set(subs.map((s: { user_id: string }) => s.user_id))];
    const { data: settingsRows } = await admin.from("user_settings").select("*").in("user_id", userIds);
    const settingsByUser = new Map((settingsRows ?? []).map((r: { user_id: string }) => [r.user_id, r]));
    const prefKey = CATEGORY_PREF[msg.category];
    targets = subs.filter((s: { user_id: string }) => {
      if (!prefKey) return true;
      const row = settingsByUser.get(s.user_id) as Record<string, unknown> | undefined;
      const value = row && row[prefKey] !== undefined ? row[prefKey] : DEFAULT_PREFS[prefKey];
      return Boolean(value);
    });
  }

  const payload = JSON.stringify({ title: msg.title, body: msg.body, url: msg.url });
  let sent = 0;
  let failed = 0;
  const expired: string[] = [];

  await Promise.all(
    targets.map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (err) {
        failed++;
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) expired.push(s.id); // that phone no longer exists
      }
    }),
  );

  if (expired.length) await admin.from("push_subscriptions").delete().in("id", expired);
  return { sent, failed, skipped: subs.length - targets.length, removed: expired.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
    const INTERNAL_SECRET = Deno.env.get("PUSH_INTERNAL_SECRET") ?? "";
    const vapidReady = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ---- 1) Who is calling? -------------------------------------------------------------
    let trusted = false; // the database itself
    let caller: { id: string; isStaff: boolean } | null = null;

    const givenSecret = req.headers.get("x-push-secret");
    if (givenSecret !== null) {
      if (!INTERNAL_SECRET || !safeEqual(givenSecret, INTERNAL_SECRET)) return json({ error: "Bad secret." }, 401);
      trusted = true;
    } else {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
      const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await callerClient.auth.getUser();
      if (userError || !user) return json({ error: "Not authenticated" }, 401);
      const { data: profile } = await admin.from("profiles").select("is_admin, is_pastor").eq("id", user.id).maybeSingle();
      caller = { id: user.id, isStaff: Boolean(profile?.is_admin || profile?.is_pastor) };
    }

    const input = await req.json().catch(() => ({}));
    const mode = typeof input.mode === "string" ? input.mode : "send";

    // ---- 2) "status": is push set up? (staff only) -------------------------------------
    if (mode === "status") {
      if (!trusted && !caller?.isStaff) return json({ error: "Only admins and pastors can see this." }, 403);
      const { data: subs } = await admin.from("push_subscriptions").select("id");
      return json({ vapid: vapidReady, internal: Boolean(INTERNAL_SECRET), devices: subs?.length ?? 0 });
    }

    if (!vapidReady) return json({ error: "Push isn't configured yet (missing VAPID secrets)." }, 500);
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    // ---- 3) "test": any signed-in member, to their OWN phones only ---------------------
    if (mode === "test") {
      if (!caller) return json({ error: "Sign in to send a test." }, 401);
      const result = await deliver(admin, {
        title: "Flood Church", body: "Test notification \u2014 alerts are working on this phone.", url: "settings.html",
        category: "general", userId: caller.id, respectPrefs: false,
      });
      if ("error" in result) return json({ error: result.error }, 500);
      return json(result);
    }

    // ---- 4) a real notification: the database, or an admin/pastor ----------------------
    if (!trusted && !caller?.isStaff) return json({ error: "Only admins and pastors can send notifications." }, 403);

    const { title, body, url, category = "general", user_id = null } = input;
    if (!title) return json({ error: "A title is required." }, 400);

    const result = await deliver(admin, {
      title: String(title), body: String(body ?? ""), url: String(url ?? "index.html"),
      category: String(category), userId: typeof user_id === "string" && user_id ? user_id : null, respectPrefs: true,
    });
    if ("error" in result) return json({ error: result.error }, 500);
    return json(result);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
