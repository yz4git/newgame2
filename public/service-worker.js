const params = new URL(self.location.href).searchParams;
const BUILD = params.get('build') || 'local';
const PREFIX = 'brick-lab-';
const CACHE = PREFIX + BUILD;
const SCOPE = self.registration.scope;
const OFFLINE = new URL('./index.html', SCOPE).toString();

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const shell = new URL('./', SCOPE);
      shell.searchParams.set('__build', BUILD);
      const response = await fetch(shell, { cache: 'no-store' });
      if (response.ok) await cache.put(OFFLINE, response.clone());
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallback) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (fallback ? await cache.match(fallback) : undefined) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/service-worker.js') || url.pathname.endsWith('/latest.html')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => Response.error()));
    return;
  }

  if (event.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(networkFirst(event.request, OFFLINE));
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(networkFirst(event.request));
});
