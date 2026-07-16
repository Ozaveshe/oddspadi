const VERSION = "oddspadi-v2";
const STATIC_CACHE = `${VERSION}-static`;
const SHELL = [
  "/",
  "/offline",
  "/manifest.webmanifest",
  "/brand/oddspadi-icon-192-maskable.png",
  "/brand/oddspadi-icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

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
            void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
      )
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline")));
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
