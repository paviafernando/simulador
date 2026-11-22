// Service worker mínimo: permite instalar la app (pantalla completa) y cachea los recursos estáticos.
const C = 'simu-v1';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  const cacheable = /\/(assets|atmosphere|clouds|core|draco)\//.test(u.pathname);
  if (!cacheable) return; // HTML/JS: siempre de la red
  e.respondWith(caches.open(C).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
});
