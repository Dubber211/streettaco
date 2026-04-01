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
  const data = e.data ? e.data.json() : {};
  const title = data.title || "StreetTaco";
  const options = {
    body: data.body || "Something new is happening nearby!",
    icon: "/icon-192.png",
    badge: "/favicon.png",
    data: { url: data.url || "/", type: data.type, truck_id: data.truck_id, supabase_url: data.supabase_url, anon_key: data.anon_key },
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

  // Handle proximity action buttons
  if (data.type === "proximity" && data.truck_id && data.supabase_url && data.anon_key) {
    if (e.action === "still_here") {
      // Confirm the truck — update last_confirmed_at and bump votes
      e.waitUntil(
        fetch(`${data.supabase_url}/rest/v1/trucks?id=eq.${data.truck_id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "apikey": data.anon_key,
            "Authorization": "Bearer " + data.anon_key,
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({
            last_confirmed_at: new Date().toISOString(),
            votes: undefined, // we'll use RPC instead
          }),
        })
        .then(() =>
          // Bump votes by 1 using raw SQL via RPC
          fetch(`${data.supabase_url}/rest/v1/rpc/confirm_truck`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": data.anon_key,
              "Authorization": "Bearer " + data.anon_key,
            },
            body: JSON.stringify({ truck_id_input: data.truck_id }),
          })
        )
        .catch((err) => console.error("Confirm truck failed:", err))
      );
      return;
    }
    if (e.action === "not_here") {
      // User says truck isn't there — no action needed, just dismiss
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
