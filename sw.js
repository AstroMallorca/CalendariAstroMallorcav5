const CACHE_NAME = "calendari-astromallorca-v4";

const CORE_ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "sw.js",
  "manifest.webmanifest",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "data/efemerides_2026.json",
  "data/cataleg_icones.json",
  "data/eclipses.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Permetem el nostre origen + Google Sheets + Google Calendar
  const allowed =
    url.origin === self.location.origin ||
    url.origin === "https://docs.google.com" ||
    url.origin === "https://calendar.google.com";

  if (!allowed) return;

  // HTML: network-first
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Dades dinàmiques: stale-while-revalidate
  if (isDynamicData(url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Assets: cache-first
  event.respondWith(cacheFirst(req));
});

function isDynamicData(url) {
  // CSV dels Sheets
  if (url.pathname.endsWith(".csv")) return true;

  // ICS del calendari
  if (url.pathname.endsWith(".ics")) return true;

  // JSON locals (si els regeneres sovint)
  if (url.origin === self.location.origin && url.pathname.includes("/data/") && url.pathname.endsWith(".json")) {
    return true;
  }

  return false;
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;

  const fresh = await fetch(req);
  if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
  return fresh;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response("Sense connexió.", { status: 503 });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const networkPromise = fetch(req)
    .then((fresh) => {
      // Nota: respostes cross-origin poden ser "opaque"; igualment es poden cachejar
      if (fresh) cache.put(req, fresh.clone());
      return fresh;
    })
    .catch(() => null);

  return cached || (await networkPromise) || new Response("Sense dades.", { status: 503 });
}
