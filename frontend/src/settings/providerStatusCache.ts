import type { ProviderDefaultSnapshot, ProviderStatus } from '../tauri'

const PROVIDER_STATUS_CACHE_KEY = 'qa-scribe-provider-status-v1'

type ProviderStatusCache = {
  version: 1
  status: ProviderStatus
}

export function readCachedProviderStatus(storage: Pick<Storage, 'getItem'> = window.localStorage): ProviderStatus | null {
  try {
    const raw = storage.getItem(PROVIDER_STATUS_CACHE_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw) as Partial<ProviderStatusCache>
    if (cache.version !== 1 || !cache.status || !Array.isArray(cache.status.providers)) return null
    return cache.status
  } catch {
    return null
  }
}

export function writeCachedProviderStatus(
  status: ProviderStatus,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
) {
  try {
    storage.setItem(PROVIDER_STATUS_CACHE_KEY, JSON.stringify({ version: 1, status } satisfies ProviderStatusCache))
  } catch {
    // Provider discovery is still usable when private mode or quota limits
    // make this non-essential startup cache unavailable.
  }
}

export function mergeFastProviderStatus(
  fastStatus: ProviderStatus,
  cachedStatus: ProviderStatus | null,
): ProviderStatus {
  if (!cachedStatus) return fastStatus
  const cachedById = new Map(cachedStatus.providers.map((provider) => [provider.id, provider]))
  return {
    providers: fastStatus.providers.map((provider) => {
      const cached = cachedById.get(provider.id)
      if (!cached || !snapshotCanBeReused(cached.defaultSnapshot)) return provider
      return {
        ...provider,
        defaultSnapshot: { ...cached.defaultSnapshot, state: 'stale' },
        models: cached.models.length > 0 ? cached.models : provider.models,
      }
    }),
  }
}

function snapshotCanBeReused(snapshot: ProviderDefaultSnapshot): boolean {
  return Boolean(snapshot.checkedAt && ['detected', 'providerManaged', 'stale'].includes(snapshot.state))
}
