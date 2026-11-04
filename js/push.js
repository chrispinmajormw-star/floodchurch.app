// push.js — turning push notifications on/off for THIS phone or browser.
// Uses the service worker (sw.js) and the Push API, and records the device
// in Supabase's push_subscriptions table so the send-push function can reach it.
import { supabase } from "./supabaseClient.js";
import { VAPID_PUBLIC_KEY } from "./push-config.js";

const SW_PATH = "sw.js";

export function pushConfigured() {
  return Boolean(VAPID_PUBLIC_KEY) && !VAPID_PUBLIC_KEY.startsWith("PASTE");
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration() {
  await navigator.serviceWorker.register(SW_PATH);
  return navigator.serviceWorker.ready;
}

/** 'unsupported' | 'unconfigured' | 'blocked' | 'enabled' | 'disabled' */
export async function getPushStatus() {
  if (!pushSupported()) return "unsupported";
  if (!pushConfigured()) return "unconfigured";
  if (Notification.permission === "denied") return "blocked";
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub && Notification.permission === "granted" ? "enabled" : "disabled";
  } catch (e) {
    return "disabled";
  }
}

export async function enablePush(userId) {
  if (!pushSupported()) throw new Error("This browser doesn't support push notifications.");
  if (!pushConfigured()) throw new Error("Push alerts aren't set up yet. Please try again later.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notifications are blocked. Allow them in your phone or browser settings, then try again.");
  }

  const reg = await getRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }

  const json = sub.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: (navigator.userAgent || "").slice(0, 200),
    },
    { onConflict: "endpoint" }
  );
  if (error) throw new Error(error.message);
  return true;
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
  } catch (e) {
    /* best effort — nothing to clean up if there was no subscription */
  }
}

/** The plain-English reason a server call failed (the server's own message when it sent one). */
async function serverMessage(error, fallback) {
  try {
    if (error && error.context && typeof error.context.json === "function") {
      const body = await error.context.json();
      if (body && typeof body.error === "string") return body.error;
    }
  } catch (e) {
    /* fall through */
  }
  return fallback;
}

/**
 * Asks the server to send a test alert to THIS member's own phones.
 * → { ok: true, sent: n }  or  { ok: false, message }
 */
export async function sendTestPush() {
  const { data, error } = await supabase.functions.invoke("send-push", { body: { mode: "test" } });
  if (error || !data) {
    const raw = await serverMessage(error, "");
    // The server's technical notes mean "not set up yet" — don't show members jargon.
    const message = /configured|VAPID|secret/i.test(raw) ? "Phone alerts aren\u2019t switched on at the church\u2019s server yet." : "Couldn\u2019t send the test. Check your internet connection and try again.";
    return { ok: false, message };
  }
  return { ok: true, sent: data.sent ?? 0 };
}

/** Staff only: is push set up? → { vapid, internal, devices, linked } (any part may be null if it couldn't be checked). */
export async function getPushHealth() {
  const [fn, rpc] = await Promise.all([
    supabase.functions.invoke("send-push", { body: { mode: "status" } }).catch(() => ({ error: true })),
    supabase.rpc("push_setup_status").then((r) => r, () => ({ error: true })),
  ]);
  const status = fn && !fn.error && fn.data ? fn.data : null;
  const linked = rpc && !rpc.error && rpc.data ? Boolean(rpc.data.linked) : null;
  return { vapid: status ? Boolean(status.vapid) : null, internal: status ? Boolean(status.internal) : null, devices: status ? Number(status.devices) : null, linked };
}
