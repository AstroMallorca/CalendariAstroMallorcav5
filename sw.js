// sw.js
// Offline + actualització automàtica (Sheets CSV + Calendar ICS)
// IMPORTANT: cada vegada que facis canvis importants, puja la versió (v7 -> v8, etc.)
const CACHE_NAME = "calendariastromallorca";

// Fitxers mínims per arrencar OFFLINE (mateix origen)
const CORE_ASSETS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "sw.js",
  "manifest.webmanifest",

  // Icones PWA (segons la teva estructura)
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",

  // Logos UI
  "assets/icons/astromallorca.png",
  "assets/icons/nocturn.png",

  // Dades locals (si existeixen)
  "data/efemerides_2026.json"
  // Pots afegir aquí altres json locals si els fas servir sempre:
  // "data/cataleg_icones.json",
  // "data/eclipses.json",
];

// Instal·lació: cache del core
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

// Activació: neteja de versions antigues
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

  // Allowlist d'orígens (per poder cachejar Sheets i Calendar)
  const allowedOrigins = new Set([
    self.location.origin,
    "https://docs.google.com",
    "https://calendar.google.com"
  ]);

  if (!allowedOrigins.has(url.origin)) return;

  // HTML: network-first (per actualitzar la UI quan hi ha internet)
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Dades dinàmiques: stale-while-revalidate
  if (isDynamicData(url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Assets estàtics: cache-first
  event.respondWith(cacheFirst(req));
});

function isDynamicData(url) {
  // Sheets publicats
  if (url.origin === "https://docs.google.com" && url.search.includes("output=csv")) return true;
  if (url.pathname.endsWith(".csv")) return true;

  // Calendar ICS
  if (url.origin === "https://calendar.google.com" && url.pathname.endsWith(".ics")) return true;
  if (url.pathname.endsWith(".ics")) return true;

  // JSON locals que poden canviar sovint
  if (url.origin === self.location.origin && url.pathname.startsWith("/CalendariAstroMallorca/data/")) return true;
  if (url.origin === self.location.origin && url.pathname.includes("/data/") && url.pathname.endsWith(".json")) return true;

  return false;
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;

  const fresh = await fetch(req);
  // Respostes opaques (cross-origin) també es poden cachejar
  if (fresh) cache.put(req, fresh.clone());
  return fresh;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;

    return new Response("Sense connexió i sense cache disponible.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const networkPromise = fetch(req)
    .then((fresh) => {
      if (fresh) cache.put(req, fresh.clone());
      return fresh;
    })
    .catch(() => null);

  // Serveix cache immediat si existeix, i refresca en segon pla
  return cached || (await networkPromise) || new Response("Sense dades.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
