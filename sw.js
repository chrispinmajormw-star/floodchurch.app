// sw.js — the service worker. It does two jobs:
//
//  1) PUSH NOTIFICATIONS — shows them and opens the right page when one is tapped.
//
//  2) OFFLINE — keeps what you've already opened so the app still works with no signal.
//     • App pages, scripts and styles .... answered INSTANTLY from the saved copy, and refreshed in the
//                                          background (so the next visit has any update); the very first
//                                          visit, or a cleared phone, waits for the network once
//     • Your church content (Supabase) ... network first, saved separately for each signed-in
//                                          person, and wiped when they sign out. Lists that rarely change
//                                          (events, sermons…) are re-used for a minute so moving between
//                                          pages is instant; changing one in the dashboard clears it.
//     • Bible books (data/kjv, web, bbe, asv, ylt …) ... saved copy first (they never change)
//     • Everything else (sign-in, uploads, YouTube, sending data) goes straight to the network.

const SHELL_CACHE = "flood-shell-v13"; // pages, scripts, styles (versioned: replaced when this changes — BUMP THE NUMBER whenever app files change)
const DATA_CACHE = "flood-data"; // church content for the signed-in member (cleared on sign-out)
const BIBLE_CACHE = "flood-bible"; // saved Bible books (kept across updates; js/bible-text.js uses this name)
const AUDIO_CACHE = "flood-audio"; // podcasts/sermons saved on the phone (js/offline-audio.js uses this name)
// Everything NOT on this list is deleted when the service worker updates — so every cache that holds
// something the member saved on purpose (Bible, audio) MUST be listed here.
const KEEP = [SHELL_CACHE, DATA_CACHE, BIBLE_CACHE, AUDIO_CACHE];

// On a weak signal, don't make people wait: after this long, show the saved copy instead
// (the fresh one still downloads in the background and is used next time).
const SHELL_TIMEOUT = 2000; // pages, scripts, styles
const DATA_TIMEOUT = 3000; // church content

// Church lists that rarely change: when one was fetched less than a minute ago it is re-used as it is, so
// tapping between pages doesn't ask the server again. (Anything personal — gifts, prayers, notifications,
// settings — and "are we live?" always ask the server.) A change made through the app clears the saved copy.
const FRESH_TABLES = new Set([
  "announcements", "events", "conferences", "sermons", "podcasts", "devotions", "verse_of_day", "ministries",
  "discipleship_resources", "involvement_options", "faqs", "reading_plans", "site_settings", "live_schedule", "giving_funds",
]);
const DATA_FRESH_MS = 60 * 1000;

// Saved on install so the Home screen opens offline straight away. Kept SMALL on purpose:
// everything else is saved as you open it, so installing/updating never hogs a slow connection.
const PRECACHE = [
  "index.html", "login.html", "css/style.css", "manifest.json", "assets/floodwhite.svg", "assets/icons/icon-192.png",
  "js/App.js", "js/auth.js", "js/icons.js", "js/theme.js", "js/supabaseClient.js", "js/vendor/supabase.js", "js/util.js",
  "js/notifications.js", "js/site-settings.js", "js/player.js", "js/offline-audio.js", "js/schedule.js", "js/push.js", "js/push-config.js",
  "js/components/home.js", "js/poster-viewer.js", "js/verse-of-day.js", "js/bible-link.js", "data/verses.json",
  // Growth Groups: the pages and every script they use, so they open at once (also the first time after an update)
  "growth.html", "growth-group.html", "js/components/growth-group.js", "js/components/growth.js", "js/emoji-picker.js", "js/growth-files.js", "js/growth-util.js", "js/image-tools.js",
  // the other tabs of the bottom bar, so they open instantly the first time as well
  "bible.html", "media.html", "give.html", "profile.html",
  "js/components/bible.js", "js/bible-text.js", "js/bible-books.js", "js/components/media.js", "js/components/give.js", "js/components/profile.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        PRECACHE.map(async (path) => {
          try {
            const key = pageKey(new URL(path, self.registration.scope));
            if (await cache.match(key)) return; // already saved — don't download it again
            // "reload" = straight from the server, never from the browser's own 10-minute memory: that memory can
            // hold the OLD copy of a file for a while after an update, and saving it here would mix old and new.
            const res = await fetch(path, { cache: "reload" });
            if (res && res.ok) await cache.put(key, res);
          } catch (e) {
            /* offline during install, or the file doesn't exist — skip it */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

// ---------------------------------------------------------------------------
// Offline helpers
// ---------------------------------------------------------------------------

/** Pages are saved by address WITHOUT the ?query, so events.html?id=5 reuses events.html. */
function pageKey(url) {
  let path = url.pathname;
  if (path.endsWith("/")) path += "index.html";
  return new Request(url.origin + path);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/** Try the network; if it fails or is too slow, use the saved copy. Successful replies refresh the saved copy. */
async function networkFirst(request, cacheName, key, timeout) {
  const cache = await caches.open(cacheName);
  const network = fetch(request).then(async (res) => {
    if (res && res.ok) await cache.put(key, res.clone());
    return res;
  });
  try {
    return await withTimeout(network, timeout);
  } catch (err) {
    const saved = await cache.match(key);
    if (saved) {
      network.catch(() => {}); // it may still finish and refresh the saved copy; ignore a late failure
      return saved;
    }
    return network; // nothing saved yet — keep waiting for the real answer (or its real error)
  }
}

/**
 * Instant: answers from the saved copy at once, and asks the server in the background whether it changed
 * (no-cache = "has this changed?", so a 10-minute browser cache can't hide an update). The first time there
 * is nothing saved yet, so it waits for the network once.
 */
async function staleWhileRevalidate(event, request, cacheName, key) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(key);
  const refresh = fetch(request.url, { cache: "no-cache" }).then(async (res) => {
    if (res && res.ok) await cache.put(key, res.clone());
    return res;
  });
  if (saved) {
    event.waitUntil(refresh.catch(() => {})); // keep working after the page has been shown; a failure is fine
    return saved;
  }
  return refresh;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(request);
  if (saved) return saved;
  const res = await fetch(request);
  if (res && res.ok) await cache.put(request, res.clone());
  return res;
}

/** The member a Supabase request belongs to (taken from their login token), so one person's
 *  saved content is never shown to someone else who signs in on the same phone. */
function memberKey(request) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.sub || "anon";
  } catch (e) {
    return "anon";
  }
}

/** "announcements" from https://…supabase.co/rest/v1/announcements?select=* */
function tableOf(url) {
  const m = url.pathname.match(/^\/rest\/v1\/([^/?]+)/);
  return m ? m[1] : null;
}

/** A saved reply, stamped with the moment it was saved (so we know how old it is). */
async function stamped(res) {
  const headers = new Headers(res.headers);
  headers.set("x-saved-at", String(Date.now()));
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

/** A rarely-changing list: re-use a copy saved under a minute ago; otherwise network first, like everything else. */
async function freshOrNetwork(request, key) {
  const cache = await caches.open(DATA_CACHE);
  const saved = await cache.match(key);
  if (saved && Date.now() - Number(saved.headers.get("x-saved-at") || 0) < DATA_FRESH_MS) return saved;
  const network = fetch(request).then(async (res) => {
    if (res && res.ok) await cache.put(key, await stamped(res.clone()));
    return res;
  });
  try {
    return await withTimeout(network, DATA_TIMEOUT);
  } catch (err) {
    if (saved) {
      network.catch(() => {});
      return saved; // slow or offline: an older copy beats waiting
    }
    return network;
  }
}

/** Forgets every saved copy of one table (for every member), so the next look asks the server. */
async function forgetTable(table) {
  const cache = await caches.open(DATA_CACHE);
  for (const saved of await cache.keys()) {
    if (tableOf(new URL(saved.url)) === table) await cache.delete(saved);
  }
}

function supabaseData(request) {
  const url = new URL(request.url);
  const table = tableOf(url);
  url.searchParams.set("__member", memberKey(request)); // only ever used as our own saved-copy label
  const key = new Request(url.href);
  if (FRESH_TABLES.has(table)) return freshOrNetwork(request, key);
  return networkFirst(request, DATA_CACHE, key, DATA_TIMEOUT);
}

function offlinePage() {
  const html =
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Offline — Flood Church</title>" +
    '<body style="font-family:system-ui,sans-serif;background:#0a0a0c;color:#f5f5f7;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;margin:0">' +
    '<div><h1 style="font-size:22px;margin:0 0 10px">You\u2019re offline</h1>' +
    '<p style="color:#9a9ba3;line-height:1.6;margin:0 0 20px">This page hasn\u2019t been saved on your phone yet. Reconnect, then try again.</p>' +
    '<button onclick="location.reload()" style="background:#3b82f6;color:#fff;border:0;border-radius:999px;padding:12px 22px;font-size:15px;font-weight:700">Try again</button></div></body>';
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    // Saving data (sign-in, gifts, posts…) always goes live. If it changes one of the church lists, clear the
    // saved copies of that list first and again afterwards, so the next look can never show the old version.
    const target = new URL(request.url);
    const table = target.hostname.endsWith(".supabase.co") ? tableOf(target) : null;
    if (table && FRESH_TABLES.has(table)) {
      event.respondWith(
        (async () => {
          await forgetTable(table);
          try {
            return await fetch(request);
          } finally {
            await forgetTable(table);
          }
        })()
      );
    }
    return;
  }
  const url = new URL(request.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  // Church content from Supabase (reads only — sign-in, uploads and functions are never touched).
  if (url.hostname.endsWith(".supabase.co")) {
    if (url.pathname.startsWith("/rest/v1/")) event.respondWith(supabaseData(request));
    return;
  }

  // The code library the app is built on (needed to start the app at all, so keep a copy).
  if (url.hostname === "esm.sh") {
    event.respondWith(networkFirst(request, SHELL_CACHE, request, SHELL_TIMEOUT));
    return;
  }

  if (url.origin !== self.location.origin) return; // YouTube, pictures from other sites… → normal handling
  if (url.pathname.endsWith("/sw.js")) return;

  // Bible books (every version's folder): use the saved copy if there is one.
  if (/\/data\/(kjv|web|bbe|asv|ylt)\//.test(url.pathname)) {
    event.respondWith(cacheFirst(request, BIBLE_CACHE));
    return;
  }

  // The app's own pages, scripts, styles and data files.
  const isPage = request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
  const key = isPage ? pageKey(url) : request;
  event.respondWith(
    staleWhileRevalidate(event, request, SHELL_CACHE, key).catch(() =>
      request.mode === "navigate" ? offlinePage() : Response.error()
    )
  );
});

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Flood Church", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Flood Church";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "assets/icons/icon-192.png",
      badge: "assets/icons/icon-192.png",
      data: { url: data.url || "index.html" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "index.html";
  const target = new URL(raw, self.registration.scope);
  const sameSite = target.origin === self.location.origin;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      if (sameSite) {
        for (const client of windows) {
          if (client.url.startsWith(self.registration.scope) && "focus" in client) {
            return client.focus().then((c) => (c && "navigate" in c ? c.navigate(target.href) : null));
          }
        }
      }
      return self.clients.openWindow(target.href);
    })
  );
});
