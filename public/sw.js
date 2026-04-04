const CACHE_NAME = "streettaco-v3";
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
    ).then(() => {
      // Notify all open tabs that a new version is active
      self.clients.matchAll({ type: "window" }).then((windowClients) => {
        windowClients.forEach((client) => client.postMessage({ type: "sw_updated" }));
      });
    })
  );
  self.clients.claim();
});

/* ─── Push Notifications ──────────────────────────────────────────────────── */

// Fires when a push message arrives from our Supabase Edge Function.
// The browser wakes up this service worker even if the app is closed.
self.addEventListener("push", (e) => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || "StreetTaco";
  const options = {
    body: data.body || "Something new is happening nearby!",
    icon: "/icon-192.png",
    badge: "/favicon.png",
    data: { url: data.url || "/", type: data.type, truck_id: data.truck_id },
  };

  // Proximity notifications get action buttons
  if (data.type === "proximity") {
    options.actions = [
      { action: "still_here", title: "Still here" },
      { action: "not_here", title: "Nope" },
    ];
    options.requireInteraction = true;
  }

  e.waitUntil(self.registration.showNotification(title, options));
});

// Fires when the user taps/clicks the notification or an action button
self.addEventListener("notificationclick", (e) => {
  const data = e.notification.data || {};
  e.notification.close();

  // Handle proximity action buttons by messaging an open client window.
  // The app holds the Supabase session, so it can call the RPC securely.
  if (data.type === "proximity" && data.truck_id) {
    if (e.action === "still_here") {
      e.waitUntil(
        clients.matchAll({ type: "window" }).then((windowClients) => {
          for (const client of windowClients) {
            client.postMessage({ type: "confirm_truck", truck_id: data.truck_id });
            return; // only need to message one client
          }
          // No open window — open the app with a confirm param
          return clients.openWindow(`/?confirm=${data.truck_id}`);
        })
      );
      return;
    }
    if (e.action === "not_here") {
      return;
    }
  }

  // Default: open the app
  const url = data.url || "/";
  e.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

/* ─── Caching ─────────────────────────────────────────────────────────────── */

self.addEventListener("fetch", (e) => {
  // Let API calls go straight to the network — no caching
  if (e.request.url.includes("supabase") || e.request.url.includes("nominatim")) {
    return;
  }

  // Network-first for app assets, fall back to cache, then offline page
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((cached) => {
          if (cached) return cached;
          // For navigation requests, serve the cached index so the SPA can handle it
          if (e.request.mode === "navigate") return caches.match("/index.html");
          return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
        })
      )
  );
});
