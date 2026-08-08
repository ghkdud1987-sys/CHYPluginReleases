const CHY_ADMIN_APP_VERSION = "0.45.0.9-dev";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const clients = await self.clients.matchAll({type:"window", includeUncontrolled:true});
    for (const client of clients) {
      client.postMessage({type:"CHY_ADMIN_WORKER_ACTIVE", version:CHY_ADMIN_APP_VERSION});
    }
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// IMPORTANT:
// No fetch handler here.
// The previous v0.45.0.8 worker intercepted the whole /admin/ scope.
// v0.45.0.9 intentionally leaves all network requests untouched so
// login/API/OneSignal behavior stays identical to the proven v0.45.0.7 build.
