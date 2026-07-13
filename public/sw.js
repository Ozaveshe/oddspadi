const VERSION = "oddspadi-v1";
const STATIC_CACHE = `${VERSION}-static`;
const DATA_CACHE = `${VERSION}-data`;
const SHELL = ["/", "/offline", "/manifest.webmanifest", "/brand/oddspadi-icon-192-maskable.png", "/brand/oddspadi-icon-512-maskable.png"];

self.addEventListener("install", (event) => { event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))); self.clients.claim(); });

self.addEventListener("fetch", (event) => {
  const request = event.request; if (request.method !== "GET") return;
  const url = new URL(request.url); if (url.origin !== self.location.origin) return;
  const staticAsset = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/") || /\.(?:js|css|woff2?|png|svg)$/.test(url.pathname);
  if (staticAsset) { event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => { const copy = response.clone(); caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)); return response; }))); return; }
  event.respondWith(fetch(request).then((response) => { if (response.ok) { const copy = response.clone(); caches.open(DATA_CACHE).then((cache) => cache.put(request, copy)); } return response; }).catch(async () => (await caches.match(request)) || (request.mode === "navigate" ? caches.match("/offline") : Response.error())));
});

self.addEventListener("push", (event) => { const data = event.data?.json() ?? {}; event.waitUntil(self.registration.showNotification(data.title || "OddsPadi", { body: data.body || "Your football padi has a matchday update.", icon: "/brand/oddspadi-icon-192-maskable.png", badge: "/brand/oddspadi-icon-192-maskable.png", data: { url: data.url || "/" }, tag: data.tag, renotify: false })); });
self.addEventListener("notificationclick", (event) => { event.notification.close(); const url = event.notification.data?.url || "/"; event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => { const current = clients.find((client) => "focus" in client); return current ? current.navigate(url).then(() => current.focus()) : self.clients.openWindow(url); })); });
