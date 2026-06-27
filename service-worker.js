// service-worker.js — offline app shell. App logic + your logged data work
// offline (data is in localStorage). FIT parsing and SMHI need the network.
const CACHE = "windlog-v2";
const SHELL = [
  "./", "./index.html", "./app.css",
  "./js/app.js", "./js/engine.js", "./js/store.js",
  "./js/config.js", "./js/fit.js", "./js/smhi.js",
  "./js/forecast.js", "./js/ocr.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // never cache cross-origin (CDN, SMHI, fonts) — go to network
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
