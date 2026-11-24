/* Service worker : l'application s'ouvre même hors connexion (la carte et les calculs, eux, ont besoin d'Internet). */
const CACHE = 'trajecto-v1.2.0';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'css/app.css',
  'js/app.js',
  'js/config.js',
  'js/core/analysis.js',
  'js/core/engine.js',
  'js/core/hooks.js',
  'js/core/store.js',
  'js/core/util.js',
  'js/features/loop.js',
  'js/features/poi.js',
  'js/features/roadbook.js',
  'js/features/score.js',
  'js/features/share.js',
  'js/features/weather.js',
  'js/io/export.js',
  'js/io/import.js',
  'js/providers/elevation-terrain.js',
  'js/providers/geocode-photon.js',
  'js/providers/poi-data.js',
  'js/providers/routing-valhalla.js',
  'js/providers/weather-openmeteo.js',
  'js/ui/icons.js',
  'js/ui/map.js',
  'js/ui/panel.js',
  'js/ui/profile.js',
  'js/ui/ui.js'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Fichiers du site : réseau d'abord en revalidant le cache HTTP (GitHub Pages garde 10 min), cache si hors connexion.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
