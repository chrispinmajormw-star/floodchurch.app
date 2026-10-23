// supabase/functions/send-push/index.ts
//
// Sends a push notification to members' phones. Only admins and pastors may
// call it. The VAPID private key lives here as a Supabase secret and is never
// exposed to the browser.
//
// Deploy:  npx supabase functions deploy send-push --no-verify-jwt
// Secrets: npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:you@example.com

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mirrors js/notifications.js — which Settings toggle controls which category.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return json({ error: "Push isn't configured yet (missing VAPID secrets)." }, 500);
    }

    // 1) Who is asking?
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await callerClient.auth.getUser();
    if (userError || !user) return json({ error: "Not authenticated" }, 401);

    // 2) Are they allowed? (admins and pastors only)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: profile } = await admin
      .from("profiles")
      .select("is_admin, is_pastor")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.is_admin && !profile?.is_pastor) {
      return json({ error: "Only admins and pastors can send notifications." }, 403);
    }

    // 3) What are we sending?
    const { title, body, url, category = "general", user_id = null } = await req.json();
    if (!title) return json({ error: "A title is required." }, 400);

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    // 4) Which devices?
    let subsQuery = admin.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
    if (user_id) subsQuery = subsQuery.eq("user_id", user_id);
    const { data: subs, error: subsError } = await subsQuery;
    if (subsError) return json({ error: subsError.message }, 500);
    if (!subs || subs.length === 0) return json({ sent: 0, failed: 0, skipped: 0, removed: 0 });

    // 5) Respect each member's notification preferences.
    const userIds = [...new Set(subs.map((s) => s.user_id))];
    const { data: settingsRows } = await admin.from("user_settings").select("*").in("user_id", userIds);
    const settingsByUser = new Map((settingsRows ?? []).map((r) => [r.user_id, r]));
    const prefKey = CATEGORY_PREF[category];

    const targets = subs.filter((s) => {
      if (!prefKey) return true; // "general" always goes out
      const row = settingsByUser.get(s.user_id);
      const value = row && row[prefKey] !== undefined ? row[prefKey] : DEFAULT_PREFS[prefKey];
      return Boolean(value);
    });

    // 6) Send, and clean up devices that no longer exist.
    const payload = JSON.stringify({ title, body: body ?? "", url: url ?? "index.html" });
    let sent = 0;
    let failed = 0;
    const expired: string[] = [];

    await Promise.all(
      targets.map(async (s) => {
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
          if (status === 404 || status === 410) expired.push(s.id);
        }
      }),
    );

    if (expired.length) await admin.from("push_subscriptions").delete().in("id", expired);

    return json({ sent, failed, skipped: subs.length - targets.length, removed: expired.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
