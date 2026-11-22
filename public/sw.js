// Service worker: permite instalar la app y jugar sin internet (en un solo dispositivo).
// - Al instalarse guarda la página y todo el código (lista generada en precache.json).
// - Texturas/modelos se guardan la primera vez que se usan.
// - La página se pide primero a internet; si no hay conexión, se usa la guardada.
const C = 'simu-v2';
// Nota: la primera instalación baja ~30 MB (código + texturas) para poder jugar sin internet.

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(C);
    await c.add('/').catch(() => {});
    try {
      const { files, extras = [] } = await (await fetch('/precache.json', { cache: 'no-store' })).json();
      await Promise.all(files.map((f) => c.add(f).catch(() => {})));
      // Texturas y modelos de a poco (si algo falla se baja cuando se use).
      for (let i = 0; i < extras.length; i += 6) {
        await Promise.all(extras.slice(i, i + 6).map(async (f) => { if (!(await c.match(f))) await c.add(f).catch(() => {}); }));
      }
    } catch {}
  })());
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== C) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => {
      if (r.ok) caches.open(C).then((c) => c.put('/', r.clone()));
      return r;
    }).catch(async () => (await caches.match('/')) || Response.error()));
    return;
  }
  // Archivos con hash y recursos pesados: primero lo guardado.
  if (/\/(assets|atmosphere|clouds|core|draco)\//.test(u.pathname)) {
    e.respondWith(caches.open(C).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
    return;
  }
  // El resto (manifest, íconos…): red y, sin conexión, lo guardado.
  e.respondWith(fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(C).then((c) => c.put(req, cp)); } return r; })
    .catch(async () => (await caches.match(req, { ignoreSearch: true })) || Response.error()));
});
