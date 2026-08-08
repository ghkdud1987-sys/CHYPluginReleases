const CHY_ADMIN_CACHE_VERSION = "0.45.0.8-dev";
const CHY_ADMIN_CACHE = "chy-admin-shell-" + CHY_ADMIN_CACHE_VERSION;
const CHY_ADMIN_ROOT = "/CHYPluginReleases/admin/";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith("chy-admin-shell-") && k !== CHY_ADMIN_CACHE)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Do not interfere with OneSignal's dedicated worker assets or SDK traffic.
  if (url.pathname.startsWith(CHY_ADMIN_ROOT + "push/onesignal/")) return;

  if (!url.pathname.startsWith(CHY_ADMIN_ROOT)) return;

  // Always network-first for the app shell so GitHub Pages updates are picked up.
  if (
    req.mode === "navigate" ||
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/admin-config.js") ||
    url.pathname.endsWith("/admin-version.json") ||
    url.pathname.endsWith("/manifest.webmanifest")
  ) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        const cache = await caches.open(CHY_ADMIN_CACHE);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // Static icons: cache-first is fine.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CHY_ADMIN_CACHE);
      cache.put(req, fresh.clone());
    }
    return fresh;
  })());
});
