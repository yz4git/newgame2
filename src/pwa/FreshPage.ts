const CACHE_PREFIX = 'brick-lab-';
const BUILD_STORAGE_KEY = 'brick-lab-build-id-v1';

interface VersionPayload {
  buildId?: unknown;
}

function normalizeBuildId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._-]{3,80}$/.test(trimmed) ? trimmed : null;
}

async function currentBuildId(): Promise<string | null> {
  try {
    const url = new URL('./version.json', document.baseURI);
    url.searchParams.set('__fresh', String(Date.now()));
    const response = await fetch(url, {
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

async function removeOldCaches(buildId: string): Promise<void> {
  if (!('caches' in window)) return;
  try {
    const active = CACHE_PREFIX + buildId;
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key.startsWith(CACHE_PREFIX) && key !== active)
      .map(key => caches.delete(key)));
  } catch {
    // CacheStorage is optional.
  }
}

async function registerWorker(buildId: string): Promise<void> {
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
  const buildId = await currentBuildId();
  if (!buildId) return;

  try {
    const url = new URL(location.href);
    url.searchParams.set('__build', buildId);
    history.replaceState(history.state, '', url);
  } catch {
    // URL version marker is optional.
  }

  let previous: string | null = null;
  try {
    previous = localStorage.getItem(BUILD_STORAGE_KEY);
    localStorage.setItem(BUILD_STORAGE_KEY, buildId);
  } catch {
    // Storage is optional.
  }

  if (previous !== buildId) await removeOldCaches(buildId);
  await registerWorker(buildId);
  await removeOldCaches(buildId);
}
