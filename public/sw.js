const CACHE_NAME = "tilt-racer-shell-v2";
const SHELL_FILES = ["/", "/styles.css", "/app.js", "/game.js", "/controller.js", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }
  if (new URL(request.url).pathname === "/api/rooms" || new URL(request.url).pathname === "/ws") {
    return;
  }
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request) ||
        (request.mode === "navigate" ? await caches.match("/") : null);
      if (cached) {
        return cached;
      }
      throw new Error(`No offline cache entry is available for ${request.url}`);
    })
  );
});
