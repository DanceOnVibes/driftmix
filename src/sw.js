/**
 * DriftMix's service worker: lets DriftMix install as an app and open with
 * no internet.
 *
 *  - Install: every file of this version is saved on the device.
 *  - Pages: fresh from the internet when there is one (within 3 seconds),
 *    otherwise the saved copy.
 *  - Everything else: the saved copy first (file names change with every
 *    version, so a saved file is never out of date).
 *  - A new version waits until the page says "update" (the "New version"
 *    strip), then takes over and old saved files are removed.
 *
 * Built by vite.config.js, which fills in the version and the file list.
 */
const VERSION = "__VERSION__";
const FILES = __FILES__;
const CACHE = `driftmix-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("driftmix-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "update") self.skipWaiting();
});

// Share › DriftMix (phone): the shared tracks arrive here (see share_target
// in the app manifest). They're kept on the device for a moment, then
// DriftMix opens and takes them (src/audio/incoming.js). Nothing is uploaded.
const SHARED = "shared-tracks";
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "POST" || url.origin !== self.location.origin || !url.pathname.endsWith("/share-target")) return;
  event.respondWith(
    (async () => {
      try {
        const form = await req.formData();
        const cache = await caches.open(SHARED);
        let i = 0;
        for (const file of form.getAll("tracks")) {
          if (!(file instanceof File)) continue;
          const headers = { "content-type": file.type || "application/octet-stream", "x-name": encodeURIComponent(file.name || "Shared track") };
          await cache.put(new Request(`./shared/${Date.now()}-${i++}`), new Response(file, { headers }));
        }
      } catch {
        /* nothing kept: the page says so */
      }
      return Response.redirect("./?shared=1#autodj", 303);
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const fresh = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 3000))]);
          return fresh;
        } catch {
          return (await cache.match(req, { ignoreSearch: true })) || (await cache.match("./")) || (await cache.match("./index.html")) || Response.error();
        }
      })(),
    );
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(req, { ignoreSearch: true });
      if (saved) return saved;
      return fetch(req);
    })(),
  );
});
