// Minimal service worker: makes the site installable ("Add to Home Screen")
// and lets it still open when offline. Strategy is deliberately simple:
//   - same-origin files (HTML/CSS/JS/data): network first, cache as a
//     fallback, so you always get the latest version when online and it
//     still opens without signal.
//   - poster images (TMDB, cross-origin): cache first, since those never
//     change once fetched — saves data and loads instantly on repeat visits.
// Bump CACHE_VERSION whenever this file changes so old caches get cleared.
const CACHE_VERSION = "v1";
const CACHE_NAME = `cinema-classics-${CACHE_VERSION}`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    // network-first for the app shell + data
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
  } else if (req.destination === "image") {
    // cache-first for poster images
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        });
      })
    );
  }
});
