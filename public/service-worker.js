const params = new URL(self.location.href).searchParams;
const BUILD = params.get('build') || 'local';
const CACHE_PREFIX = 'rift-studio-';
const CACHE = `${CACHE_PREFIX}${BUILD}`;
const SCOPE = self.registration.scope;
const OFFLINE_DOCUMENT = new URL('./index.html', SCOPE).toString();
const PRECACHE = [
  './manifest.webmanifest'
];

async function putIfOk(cache, request, response) {
  if (response && response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);

    for (const path of PRECACHE) {
      try {
        const url = new URL(path, SCOPE);
        url.searchParams.set('__build', BUILD);
        const response = await fetch(url, { cache: 'no-store' });
        if (response.ok) await cache.put(new URL(path, SCOPE), response.clone());
      } catch {
        // Optional precache item; installation should still succeed.
      }
    }

    try {
      const shellUrl = new URL('./', SCOPE);
      shellUrl.searchParams.set('__build', BUILD);
      const shell = await fetch(shellUrl, { cache: 'no-store' });
      if (shell.ok) await cache.put(OFFLINE_DOCUMENT, shell.clone());
    } catch {
      // First install may be offline.
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackRequest = null) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    await putIfOk(cache, request, response);
    return response;
  } catch {
    return (await cache.match(request))
      ?? (fallbackRequest ? await cache.match(fallbackRequest) : undefined)
      ?? Response.error();
  }
}

async function cacheFirstHashedAsset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request, { cache: 'force-cache' });
    await putIfOk(cache, request, response);
    return response;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.endsWith('/version.json') ||
    url.pathname.endsWith('/service-worker.js') ||
    url.pathname.endsWith('/latest.html')
  ) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => Response.error()));
    return;
  }

  if (event.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    event.respondWith(networkFirst(event.request, OFFLINE_DOCUMENT));
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirstHashedAsset(event.request));
    return;
  }

  event.respondWith(networkFirst(event.request));
});
