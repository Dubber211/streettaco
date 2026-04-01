const CACHE_NAME = "streettaco-v2";
const PRECACHE_URLS = ["/", "/index.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ─── Push Notifications ──────────────────────────────────────────────────── */

// Fires when a push message arrives from our Supabase Edge Function.
// The browser wakes up this service worker even if the app is closed.
self.addEventListener("push", (e) => {
  // The Edge Function sends JSON with a title and body
  const data = e.data ? e.data.json() : {};
  const title = data.title || "StreetTaco";
  const options = {
    body: data.body || "Something new is happening nearby!",
    icon: "/icon-192.png",
    badge: "/favicon.png",
    data: { url: data.url || "/" },
  };

  // showNotification returns a promise — we must wrap it in waitUntil
  // so the browser keeps the service worker alive until it's done
  e.waitUntil(self.registration.showNotification(title, options));
});

// Fires when the user taps/clicks the notification
self.addEventListener("notificationclick", (e) => {
  e.notification.close();

  // Open the app (or focus it if it's already open)
  const url = e.notification.data?.url || "/";
  e.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      // If the app is already open in a tab, focus it
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      return clients.openWindow(url);
    })
  );
});

/* ─── Caching ─────────────────────────────────────────────────────────────── */

self.addEventListener("fetch", (e) => {
  // Network-first for API calls, cache-first for assets
  if (e.request.url.includes("supabase") || e.request.url.includes("nominatim")) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
