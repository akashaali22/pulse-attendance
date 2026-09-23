// Minimal service worker: makes the app installable and shows a friendly page when the phone is
// offline. Attendance data is never cached — punches must reach the server to count.
const VERSION = "pulse-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll([OFFLINE_URL, "/icon-192.png", "/manifest.webmanifest"])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never interfere with check-ins, leave requests, logins
  if (new URL(req.url).origin !== self.location.origin) return;

  // Pages: always from the network, with an offline notice as the fallback.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  // Static assets: serve from cache when present, otherwise fetch and remember.
  if (/\/_next\/static\/|\.(png|svg|ico|webmanifest)$/.test(req.url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
