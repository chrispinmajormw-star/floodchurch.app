// sw.js — the service worker. Its only job is to show push notifications and
// open the right page when one is tapped. It does not cache anything, so it
// can never serve stale pages after you update the site.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
