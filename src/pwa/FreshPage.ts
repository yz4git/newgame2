const CACHE_PREFIX = 'rift-studio-';
const BUILD_STORAGE_KEY = 'rift-studio-build-id-v1';

interface VersionPayload {
  buildId?: unknown;
  deployedAt?: unknown;
}

function normalizeBuildId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(trimmed) ? trimmed : null;
}

function versionRequestUrl(): URL {
  const url = new URL('./version.json', document.baseURI);
  url.searchParams.set('__fresh', String(Date.now()));
  return url;
}

async function fetchCurrentBuildId(): Promise<string | null> {
  try {
    const response = await fetch(versionRequestUrl(), {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'cache-control': 'no-cache' }
    });
    if (!response.ok) return null;
    const payload = await response.json() as VersionPayload;
    return normalizeBuildId(payload.buildId);
  } catch {
    return null;
  }
}

function updateVisibleBuildId(buildId: string): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('__build') === buildId) return;
    url.searchParams.set('__build', buildId);
    history.replaceState(history.state, '', url);
  } catch {
    // Cache-busting aid only. Never interrupt gameplay.
  }
}

async function removeOldCaches(buildId: string): Promise<void> {
  if (!('caches' in window)) return;
  const activeCache = `${CACHE_PREFIX}${buildId}`;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== activeCache)
        .map((key) => caches.delete(key))
    );
  } catch {
    // CacheStorage may be unavailable in restricted/private browsing.
  }
}

async function registerBuildServiceWorker(buildId: string): Promise<void> {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;

  const script = new URL('./service-worker.js', document.baseURI);
  script.searchParams.set('build', buildId);

  try {
    const registration = await navigator.serviceWorker.register(script, {
      scope: './',
      updateViaCache: 'none'
    });
    await registration.update();
  } catch (error) {
    console.warn('Service worker registration failed.', error);
  }
}

export async function installFreshPagePolicy(): Promise<void> {
  const buildId = await fetchCurrentBuildId();
  if (!buildId) {
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      await registerBuildServiceWorker('local');
    }
    return;
  }

  updateVisibleBuildId(buildId);

  let previousBuild: string | null = null;
  try {
    previousBuild = localStorage.getItem(BUILD_STORAGE_KEY);
    localStorage.setItem(BUILD_STORAGE_KEY, buildId);
  } catch {
    // Storage is optional.
  }

  if (previousBuild !== buildId) {
    await removeOldCaches(buildId);
  }

  await registerBuildServiceWorker(buildId);
  await removeOldCaches(buildId);
}
