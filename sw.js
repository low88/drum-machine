const VERSION = 'microfonia-v1.0';
const APP = ['./', 'index.html', 'style.css', 'engine.js', 'kit.js', 'app.js', 'glitch-worklet.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'mf-fonts').map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return; const url = new URL(req.url);
  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) { e.respondWith(caches.open('mf-fonts').then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; }))); return; }
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(r => { if (r.ok) { const cl = r.clone(); caches.open(VERSION).then(c => c.put(req, cl)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
