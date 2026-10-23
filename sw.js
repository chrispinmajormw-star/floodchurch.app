// sw.js — the service worker. It does two jobs:
//
//  1) PUSH NOTIFICATIONS — shows them and opens the right page when one is tapped.
//
//  2) OFFLINE — keeps what you've already opened so the app still works with no signal.
//     • App pages, scripts and styles .... network first (so updates always arrive),
//                                          falling back to the last saved copy when offline
//     • Your church content (Supabase) ... network first, saved separately for each signed-in
//                                          person, and wiped when they sign out
//     • Bible books (data/kjv/…) ......... saved copy first (they never change)
//     • Everything else (sign-in, uploads, YouTube, sending data) goes straight to the network.

const SHELL_CACHE = "flood-shell-v2"; // pages, scripts, styles (versioned: replaced when this changes)
const DATA_CACHE = "flood-data"; // church content for the signed-in member (cleared on sign-out)
const BIBLE_CACHE = "flood-bible"; // saved Bible books (kept across updates; js/bible-text.js uses this name)
const KEEP = [SHELL_CACHE, DATA_CACHE, BIBLE_CACHE];

const SHELL_TIMEOUT = 6000; // after this long on a slow network, show the saved copy if there is one
const DATA_TIMEOUT = 8000;

// Pre-saved on install so the main screens work offline even before they've been opened.
// Anything that doesn't exist is quietly skipped.
const PRECACHE = [
  "index.html", "bible.html", "media.html", "give.html", "profile.html", "settings.html",
  "notifications.html", "login.html", "events.html", "help.html", "watch.html", "sermons.html", "devotions.html",
  "css/style.css", "manifest.json", "assets/floodwhite.svg", "assets/icons/icon-192.png",
  "js/App.js", "js/auth.js", "js/icons.js", "js/theme.js", "js/supabaseClient.js", "js/util.js",
  "js/notifications.js", "js/push.js", "js/push-config.js", "js/site-settings.js",
  "js/bible-books.js", "js/bible-text.js", "js/player.js",
  "js/components/home.js", "js/components/bible.js", "js/components/media.js",
  "js/components/settings.js", "js/components/notifications.js", "js/components/events.js",
  "js/components/help.js", "js/components/give.js", "js/components/profile.js",
  "js/components/watch.js", "js/components/sermons.js", "js/components/devotions.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.all(
        PRECACHE.map(async (path) => {
          try {
            const res = await fetch(path);
            if (res && res.ok) await cache.put(pageKey(new URL(path, self.registration.scope)), res);
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

function supabaseData(request) {
  const url = new URL(request.url);
  url.searchParams.set("__member", memberKey(request)); // only ever used as our own saved-copy label
  return networkFirst(request, DATA_CACHE, new Request(url.href), DATA_TIMEOUT);
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
  if (request.method !== "GET") return; // saving data (sign-in, gifts, posts…) always goes live
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

  // Bible books: use the saved copy if there is one.
  if (url.pathname.includes("/data/kjv/")) {
    event.respondWith(cacheFirst(request, BIBLE_CACHE));
    return;
  }

  // The app's own pages, scripts, styles and data files.
  const isPage = request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/");
  const key = isPage ? pageKey(url) : request;
  event.respondWith(
    networkFirst(request, SHELL_CACHE, key, SHELL_TIMEOUT).catch(() =>
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
