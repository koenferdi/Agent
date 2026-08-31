/* sw.js — de schil waarmee de hub zich als app laat installeren.
 *
 * Regels:
 *   /api/*      nooit uit de cache. Verouderde stand is erger dan geen stand.
 *   al het rest eerst het netwerk, cache alleen als noodval. Je bewerkt deze
 *               bestanden zelf; dan wil je nooit een oude versie geserveerd
 *               krijgen. De cache is er voor offline, niet voor snelheid.
 *
 * Verhoog VERSIE als je iets aan de bestanden hieronder verandert.
 */
const VERSIE = "desk-v1";
const KERN = [
  "/", "/index.html", "/vloer.html", "/style.css", "/app.js",
  "/iso/iso-office.js", "/iso/iso-map.js", "/iso/iso-theme.js", "/iso/iso-bridge.js",
  "/manifest.webmanifest", "/icoon-192.png", "/icoon-512.png"
];

const bruikbaar = (res, req) =>
  res && res.ok && res.status === 200 &&
  /* een inlogpagina in plaats van een script hoort niet in de cache */
  !(req.destination !== "document" && (res.headers.get("content-type") || "").includes("text/html"));

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSIE);
    await Promise.all(KERN.map(async pad => {
      try {
        const req = new Request(pad, { cache: "reload" });
        const res = await fetch(req);
        if (bruikbaar(res, req)) await cache.put(pad, res);
      } catch { /* offline bij het installeren: dan later */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const naam of await caches.keys()) if (naam !== VERSIE) await caches.delete(naam);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return;  // altijd vers

  if (req.mode === "navigate"){
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (bruikbaar(res, req)) (await caches.open(VERSIE)).put(req, res.clone());
        return res;
      } catch {
        return (await caches.match(req)) || (await caches.match("/")) ||
          new Response("Geen verbinding met de hub.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(VERSIE);
    try {
      const res = await fetch(req);
      if (bruikbaar(res, req)) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req)) || new Response("", { status: 504 });
    }
  })());
});
