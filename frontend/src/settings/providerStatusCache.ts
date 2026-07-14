import type {
  ProviderDefaultOrigin,
  ProviderDefaultSnapshot,
  ProviderDiscoveryError,
  ProviderModelCatalogSnapshot,
  ProviderStatus,
} from '../tauri'

const PROVIDER_STATUS_CACHE_KEY = 'qa-scribe-provider-status-v2'
const LEGACY_PROVIDER_STATUS_CACHE_KEY = 'qa-scribe-provider-status-v1'
const MAX_CACHED_DEFAULT_VALUE_LENGTH = 256

type ProviderStatusCache = {
  version: 2
  status: ProviderStatus
}

export function readCachedProviderStatus(
  storage: Pick<Storage, 'getItem' | 'removeItem'> = window.localStorage,
): ProviderStatus | null {
  removeLegacyProviderStatusCache(storage)
  try {
    const raw = storage.getItem(PROVIDER_STATUS_CACHE_KEY)
    if (!raw) return null
    const cache = JSON.parse(raw) as Partial<ProviderStatusCache>
    if (cache.version !== 2 || !cache.status || !Array.isArray(cache.status.providers)) return null
    return sanitizedProviderStatus(cache.status)
  } catch {
    return null
  }
}

export function writeCachedProviderStatus(
  status: ProviderStatus,
  storage: Pick<Storage, 'removeItem' | 'setItem'> = window.localStorage,
) {
  removeLegacyProviderStatusCache(storage)
  try {
    const sanitized = sanitizedProviderStatus(status)
    storage.setItem(PROVIDER_STATUS_CACHE_KEY, JSON.stringify({ version: 2, status: sanitized } satisfies ProviderStatusCache))
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
    ...fastStatus,
    providers: fastStatus.providers.map((provider) => {
      const cached = cachedById.get(provider.id)
      if (!cached) return provider

      const fastDefault = provider.defaultSnapshot
      const cachedDefault = cached.defaultSnapshot
      const defaultSnapshot = snapshotCanBeReused(fastDefault)
        ? fastDefault
        : snapshotCanBeReused(cachedDefault)
          ? { ...cachedDefault, state: 'stale' as const }
          : fastDefault

      return {
        ...provider,
        defaultSnapshot,
        // Account catalogs are never reused across an app restart: the
        // frontend cache has no non-secret identity fingerprint with which to
        // prove that the signed-in account or policy is unchanged. The
        // backend owns identity-aware stale reuse within the running process.
        models: provider.models,
        catalogSnapshot: provider.catalogSnapshot,
      }
    }),
  }
}

function sanitizedProviderStatus(status: ProviderStatus): ProviderStatus {
  return {
    catalogRollout: ['disabled', 'diagnostics', 'selector'].includes(status.catalogRollout)
      ? status.catalogRollout
      : 'diagnostics',
    providers: status.providers.flatMap((provider) => {
      const identity = cachedProviderIdentity(provider.id)
      if (!identity) return []
      const providerState = ['ready', 'authRequired', 'installRequired', 'error'].includes(provider.status)
        ? provider.status
        : 'error'
      return [{
        id: identity.id,
        label: identity.label,
        status: providerState,
        available: providerState === 'ready',
        reason: cachedProviderReason(providerState),
        command: null,
        models: [],
        catalogSnapshot: sanitizeCatalogSnapshot(),
        defaultSnapshot: sanitizeDefaultSnapshot(provider.defaultSnapshot),
        localOnly: true,
      }]
    }),
  }
}

function sanitizeDefaultSnapshot(snapshot: ProviderDefaultSnapshot): ProviderDefaultSnapshot {
  return {
    state: snapshot.state,
    model: sanitizeDefaultValue(snapshot.model),
    reasoningEffort: sanitizeDefaultValue(snapshot.reasoningEffort),
    checkedAt: sanitizedCheckedAt(snapshot.checkedAt),
    cliVersion: null,
    resolutionScope: { kind: 'neutral', label: 'Neutral QA Scribe runtime scope' },
    error: sanitizeDiscoveryError(snapshot.error, 'default'),
    warnings: [],
  }
}

function sanitizeDefaultValue(value: ProviderDefaultSnapshot['model']): ProviderDefaultSnapshot['model'] {
  return {
    value: sanitizedDefaultScalar(value.value),
    resolution: value.resolution,
    origin: sanitizeOrigin(value.origin),
    recommendedValue: sanitizedDefaultScalar(value.recommendedValue),
  }
}

function sanitizedDefaultScalar(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_CACHED_DEFAULT_VALUE_LENGTH) return null
  if ([...trimmed].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })) return null
  if (/^(?:\/|\\\\|[a-z]:[\\/]|~[\\/]|file:)/iu.test(trimmed)) return null
  if (/(?:^|[^a-z0-9])(?:github_pat_|gh[pousr]_|sk-)[a-z0-9_-]{8,}/iu.test(trimmed)) return null
  if (/(?:^|[-_.])(?:token|secret|password|credential)(?:$|[-_.:=])/iu.test(trimmed)) return null
  return trimmed
}

function sanitizeCatalogSnapshot(): ProviderModelCatalogSnapshot {
  // Persisting an authoritative account catalog would allow the next app
  // process to display it before the backend can verify the current identity.
  // Retain only the neutral shape needed to trigger a fresh deep discovery.
  return {
    state: 'idle',
    source: 'preset',
    models: [],
    checkedAt: null,
    cliVersion: null,
    resolutionScope: { kind: 'neutral', label: 'Neutral QA Scribe runtime scope' },
    error: null,
    warnings: [],
  }
}

function sanitizeOrigin(origin: ProviderDefaultOrigin | null): ProviderDefaultOrigin | null {
  if (!origin) return null
  const labels: Record<ProviderDefaultOrigin['kind'], string> = {
    userConfig: 'User configuration',
    projectConfig: 'Project configuration',
    profile: 'CLI profile',
    managedConfig: 'Managed configuration',
    runtimeFlag: 'Runtime override',
    environment: 'Environment variable',
    cliRecommendation: 'CLI recommendation',
    configFile: 'CLI configuration file',
    unknown: 'CLI configuration',
  }
  return {
    kind: origin.kind,
    label: labels[origin.kind] ?? labels.unknown,
    displayPath: sanitizedDisplayPath(origin.displayPath),
  }
}

function sanitizeDiscoveryError(
  error: ProviderDiscoveryError | null,
  subject: 'catalog' | 'default',
): ProviderDiscoveryError | null {
  if (!error) return null
  const label = subject === 'catalog' ? 'Model catalog discovery' : 'CLI default discovery'
  let message: string
  switch (error.code) {
    case 'timedOut':
      message = `${label} timed out. Retry when the CLI and network are available.`
      break
    case 'authRequired':
      message = `${label} requires sign-in. Sign in with the CLI, then retry.`
      break
    case 'policyDenied':
      message = `${label} is restricted by account or organization policy.`
      break
    case 'network':
      message = `${label} could not reach the provider. Check network access, then retry.`
      break
    case 'rateLimited':
      message = `${label} is temporarily rate limited. Retry later.`
      break
    case 'unsupported':
    case 'protocolIncompatible':
      message = `${label} is not supported by this CLI version. Update the CLI or use a custom model.`
      break
    case 'unavailable':
      message = `${label} is unavailable. Check sign-in, policy, and network access, then retry.`
      break
    case 'spawnFailed':
      message = `${label} could not start the CLI. Check the installation, then retry.`
      break
    default:
      message = `${label} could not be completed. Update the CLI or retry.`
  }
  return { code: error.code, message, retryable: error.retryable }
}

function cachedProviderIdentity(id: string): { id: string; label: string } | null {
  if (id === 'claude_code') return { id, label: 'Claude Code' }
  if (id === 'codex_cli') return { id, label: 'Codex CLI' }
  if (id === 'copilot_cli') return { id, label: 'GitHub Copilot CLI' }
  return null
}

function sanitizedDisplayPath(path: string | null): string | null {
  if (!path || path.includes('..')) return null
  if (path.startsWith('~/') && !path.slice(2).includes('\\')) return path
  return path.includes('/') || path.includes('\\') ? null : path
}

function sanitizedCheckedAt(value: string | null): string | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

function cachedProviderReason(status: ProviderStatus['providers'][number]['status']): string {
  if (status === 'ready') return 'Last known local CLI status. Refresh to verify.'
  if (status === 'authRequired') return 'Sign-in may be required. Refresh after signing in.'
  if (status === 'installRequired') return 'The CLI was not installed during the last check.'
  return 'The last CLI check needs attention. Refresh for current status.'
}

function removeLegacyProviderStatusCache(storage: Pick<Storage, 'removeItem'>) {
  try {
    storage.removeItem(LEGACY_PROVIDER_STATUS_CACHE_KEY)
  } catch {
    // Cleanup is best-effort; a blocked legacy removal must not prevent live
    // discovery or the sanitized v2 cache from being used.
  }
}

function snapshotCanBeReused(snapshot: ProviderDefaultSnapshot): boolean {
  return Boolean(snapshot.checkedAt && ['detected', 'providerManaged', 'stale'].includes(snapshot.state))
}
