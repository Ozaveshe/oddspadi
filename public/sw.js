const VERSION = "oddspadi-v3";
const STATIC_CACHE = `${VERSION}-static`;
// `/` was listed here but nothing ever served it: navigations are network-first
// with an /offline fallback. Caching the root HTML in a shared cache was dead
// weight and a stale-shell hazard the moment that strategy changed.
const SHELL = [
  "/offline",
  "/manifest.webmanifest",
  "/brand/oddspadi-icon-192-maskable.png",
  "/brand/oddspadi-icon-512-maskable.png"
];
// Bounds the runtime cache. Hashed `_next/static` chunks change every deploy
// and were only ever evicted when VERSION changed, so the cache grew without
// limit across releases until the browser evicted the whole origin.
const MAX_STATIC_ENTRIES = 180;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Individually, not `addAll`: that is atomic, so one 404 anywhere in the
      // list failed the whole install and left /offline uncached — silently
      // disabling offline support entirely.
      Promise.all(SHELL.map((path) => cache.add(path).catch(() => undefined)))
    )
  );
  self.skipWaiting();
});

async function trimStaticCache() {
  const cache = await caches.open(STATIC_CACHE);
  const keys = await cache.keys();
  if (keys.length <= MAX_STATIC_ENTRIES) return;
  // Oldest-first: `keys()` preserves insertion order.
  await Promise.all(keys.slice(0, keys.length - MAX_STATIC_ENTRIES).map((key) => cache.delete(key)));
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Cache only immutable/public assets. Account pages, community responses,
  // and APIs must always stay on the network so one session can never replay
  // another session's data from a shared service-worker cache.
  const staticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/brand/");

  if (staticAsset) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached || fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(STATIC_CACHE)
              .then((cache) => cache.put(request, copy))
              .then(trimStaticCache);
          }
          return response;
        })
      )
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        // `caches.match` resolves to undefined on a miss, and responding with
        // undefined throws a network error — so a failed install turned every
        // offline navigation into an opaque browser error page.
        const cached = await caches.match("/offline");
        return cached ?? new Response(
          "<!doctype html><meta charset=\"utf-8\"><title>You are offline</title><p>You are offline. Reconnect for live scores and fresh match data.",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      })
    );
  }
});

function safeNotificationPath(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/", self.location.origin);
    if (url.origin !== self.location.origin) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = {};
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "OddsPadi", {
      body: data.body || "Your football padi has a matchday update.",
      icon: "/brand/oddspadi-icon-192-maskable.png",
      badge: "/brand/oddspadi-icon-192-maskable.png",
      data: { url: safeNotificationPath(data.url) },
      tag: data.tag,
      renotify: false
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeNotificationPath(event.notification.data?.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const current = clients.find((client) => "focus" in client);
      return current
        ? current.navigate(url).then(() => current.focus())
        : self.clients.openWindow(url);
    })
  );
});
