import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { catalogSnapshotNeedsRefresh, useSettingsDiscovery } from '../app/useSettingsDiscovery'
import { providerStatusFixture } from '../test/fixtures'
import type { ProviderDefaultOrigin, ProviderModelCatalogSnapshot, ProviderStatus } from '../tauri'
import { mergeFastProviderStatus, readCachedProviderStatus, writeCachedProviderStatus } from './providerStatusCache'

const checkedAt = '2026-07-13T10:00:00Z'

describe('provider status cache', () => {
  it('persists only a sanitized v2 snapshot and tolerates corrupt data', () => {
    const values = new Map<string, string>([
      ['qa-scribe-provider-status-v1', 'legacy token ghp_old_secret from /Users/private'],
    ])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key) },
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const status = providerStatusFixture()
    const legacyProvider = status.providers[0] as ProviderStatus['providers'][number] & { executablePath?: string }
    legacyProvider.executablePath = '/mock/bin/codex'
    const legacyModelOrigin = status.providers[0].defaultSnapshot.model.origin as ProviderDefaultOrigin & { technicalPath?: string }
    const legacyReasoningOrigin = status.providers[0].defaultSnapshot.reasoningEffort.origin as ProviderDefaultOrigin & { technicalPath?: string }
    legacyModelOrigin.technicalPath = '/Users/private/.codex/config.toml'
    legacyReasoningOrigin.technicalPath = '/Users/private/.codex/config.toml'
    legacyModelOrigin.displayPath = '/Users/private/.codex/config.toml'
    ;(status.providers[0] as ProviderStatus['providers'][number] & { accountEmail?: string }).accountEmail = 'private@example.test'
    ;(status.providers[0].defaultSnapshot as ProviderStatus['providers'][number]['defaultSnapshot'] & { rawProtocol?: string }).rawProtocol = 'private-protocol-record'
    status.providers[0].reason = 'token ghp_secret from /Users/private/repository'
    status.providers[0].defaultSnapshot.model.value = '/Users/private/repository/ghp_secret'
    status.providers[0].defaultSnapshot.model.recommendedValue = 'ghp_recommendedsecretvalue'
    status.providers[0].defaultSnapshot.reasoningEffort.value = 'secret-recommended'
    setCatalogSnapshot(status.providers[0], {
      state: 'stale',
      error: { code: 'network', message: 'token ghp_secret from /Users/private/repository', retryable: true },
    })

    writeCachedProviderStatus(status, storage)

    const serialized = values.get('qa-scribe-provider-status-v2') ?? ''
    const cached = readCachedProviderStatus(storage)
    expect(serialized).not.toContain('ghp_secret')
    expect(serialized).not.toContain('/Users/private')
    expect(serialized).not.toContain('private@example.test')
    expect(serialized).not.toContain('private-protocol-record')
    expect(values.has('qa-scribe-provider-status-v1')).toBe(false)
    expect(cached?.providers[0]).toMatchObject({
      reason: 'Last known local CLI status. Refresh to verify.',
      catalogSnapshot: {
        state: 'idle',
        models: [],
        error: null,
      },
    })
    expect(cached?.providers[0]).not.toHaveProperty('executablePath')
    expect(cached?.providers[0].defaultSnapshot.model.origin).not.toHaveProperty('technicalPath')
    expect(cached?.providers[0].defaultSnapshot.model.origin?.displayPath).toBeNull()
    expect(cached?.providers[0].defaultSnapshot.reasoningEffort.origin).not.toHaveProperty('technicalPath')
    expect(cached?.providers[0].defaultSnapshot).toMatchObject({
      model: { value: null, recommendedValue: null },
      reasoningEffort: { value: null },
    })

    values.set('qa-scribe-provider-status-v1', 'legacy secret after write')
    values.set('qa-scribe-provider-status-v2', '{broken')
    expect(readCachedProviderStatus(storage)).toBeNull()
    expect(values.has('qa-scribe-provider-status-v1')).toBe(false)
  })

  it('preserves bounded namespaced model IDs while filtering path and token-like values', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key) },
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const status = providerStatusFixture()
    status.providers[0].defaultSnapshot.model.value = 'anthropic/claude-sonnet-4.6'
    status.providers[0].defaultSnapshot.model.recommendedValue = 'provider/model-preview'
    status.providers[0].defaultSnapshot.reasoningEffort.value = 'xhigh'

    writeCachedProviderStatus(status, storage)

    expect(readCachedProviderStatus(storage)?.providers[0].defaultSnapshot).toMatchObject({
      model: {
        value: 'anthropic/claude-sonnet-4.6',
        recommendedValue: 'provider/model-preview',
      },
      reasoningEffort: { value: 'xhigh' },
    })
  })

  it('reuses defaults but never replays an account catalog across app processes', () => {
    const cached = providerStatusFixture()
    cached.catalogRollout = 'selector'
    const liveModel = {
      ...cached.providers[0].models[0],
      id: 'gpt-live',
      label: 'GPT Live',
      description: 'Available for this account',
      source: 'detected' as const,
      isDefault: false,
      reasoningEfforts: ['medium'],
      defaultReasoningEffort: 'medium',
    }
    setCatalogSnapshot(cached.providers[0], { models: [cached.providers[0].models[0], liveModel] })
    const fast = providerStatusFixture()
    fast.catalogRollout = 'diagnostics'
    fast.providers[0] = {
      ...fast.providers[0],
      status: 'authRequired',
      available: false,
      reason: 'Sign in required.',
      defaultSnapshot: { ...fast.providers[0].defaultSnapshot, state: 'unchecked', checkedAt: null },
      models: fast.providers[0].models.slice(0, 1),
    }
    setCatalogSnapshot(fast.providers[0], { state: 'idle', checkedAt: null, models: [] })

    const merged = mergeFastProviderStatus(fast, cached)
    const catalog = getCatalogSnapshot(merged.providers[0])

    expect(merged.providers[0]).toMatchObject({ status: 'authRequired', available: false, reason: 'Sign in required.' })
    expect(merged.catalogRollout).toBe('diagnostics')
    expect(merged.providers[0].defaultSnapshot).toMatchObject({ state: 'stale', model: { value: 'gpt-5.5' } })
    expect(catalog).toMatchObject({ state: 'idle', models: [] })
    expect(catalog.models.map((model) => model.id)).not.toContain('gpt-live')
    expect(merged.providers[0].models.map((model) => model.id)).not.toContain('gpt-live')
  })

  it('strips authoritative account models from the persisted snapshot', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key) },
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const status = providerStatusFixture()
    const accountModel = {
      ...status.providers[0].models[0],
      id: 'account-private-model',
      label: 'Account private model',
      source: 'cliCatalog' as const,
    }
    status.providers[0].models = [accountModel]
    setCatalogSnapshot(status.providers[0], {
      state: 'fresh',
      source: 'cliCatalog',
      models: [accountModel],
    })

    writeCachedProviderStatus(status, storage)

    const serialized = values.get('qa-scribe-provider-status-v2') ?? ''
    const cached = readCachedProviderStatus(storage)
    expect(serialized).not.toContain('account-private-model')
    expect(cached?.providers[0].models).toEqual([])
    expect(cached?.providers[0].catalogSnapshot).toMatchObject({
      state: 'idle',
      source: 'preset',
      models: [],
      checkedAt: null,
    })
  })

  it('does not infer catalog freshness from a reusable default snapshot', () => {
    const cached = providerStatusFixture()
    setCatalogSnapshot(cached.providers[0], { state: 'failed', models: [] })
    const fast = providerStatusFixture()
    fast.providers[0].defaultSnapshot = {
      ...fast.providers[0].defaultSnapshot,
      state: 'unchecked',
      checkedAt: null,
    }
    setCatalogSnapshot(fast.providers[0], { state: 'idle', checkedAt: null, models: [] })

    const merged = mergeFastProviderStatus(fast, cached)

    expect(merged.providers[0].defaultSnapshot.state).toBe('stale')
    expect(getCatalogSnapshot(merged.providers[0])).toMatchObject({ state: 'idle', models: [] })
    expect(merged.providers[0].models.map((model) => model.id)).toEqual(['default'])
  })

  it('refreshes missing, idle, stale, failed, or old catalogs independently of defaults', () => {
    const provider = providerStatusFixture().providers[0]
    expect(catalogSnapshotNeedsRefresh(provider, Date.parse('2026-07-13T10:01:00Z'))).toBe(true)

    setCatalogSnapshot(provider, { state: 'fresh', checkedAt })
    expect(catalogSnapshotNeedsRefresh(provider, Date.parse('2026-07-13T10:04:59Z'))).toBe(false)
    expect(catalogSnapshotNeedsRefresh(provider, Date.parse('2026-07-13T10:05:00Z'))).toBe(true)

    for (const state of ['idle', 'stale', 'failed'] as const) {
      setCatalogSnapshot(provider, { state, checkedAt })
      expect(catalogSnapshotNeedsRefresh(provider)).toBe(true)
    }
  })

  it('requests an idle catalog once and resets the guard after a fresh observation', () => {
    const provider = providerStatusFixture().providers[0]
    provider.defaultSnapshot = {
      ...provider.defaultSnapshot,
      checkedAt: new Date().toISOString(),
    }
    setCatalogSnapshot(provider, { state: 'idle', checkedAt: null, models: [] })
    const discover = vi.fn(() => Promise.resolve())
    const { rerender } = renderHook(
      ({ activeProvider }) => useSettingsDiscovery('settings', activeProvider, discover),
      { initialProps: { activeProvider: { ...provider } } },
    )

    expect(discover).toHaveBeenCalledTimes(1)
    rerender({ activeProvider: { ...provider } })
    expect(discover).toHaveBeenCalledTimes(1)

    setCatalogSnapshot(provider, { state: 'fresh', checkedAt: new Date().toISOString() })
    rerender({ activeProvider: { ...provider } })
    expect(discover).toHaveBeenCalledTimes(1)

    setCatalogSnapshot(provider, { state: 'stale', checkedAt })
    rerender({ activeProvider: { ...provider } })
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('ignores storage write failures', () => {
    expect(() => writeCachedProviderStatus(providerStatusFixture(), {
      removeItem: vi.fn(),
      setItem: vi.fn(() => { throw new Error('quota') }),
    })).not.toThrow()
  })
})

function setCatalogSnapshot(
  provider: ProviderStatus['providers'][number],
  patch: Partial<ProviderModelCatalogSnapshot> = {},
) {
  provider.catalogSnapshot = {
    state: 'fresh',
    source: 'cliCatalog',
    models: provider.models,
    checkedAt,
    cliVersion: 'codex-cli 0.144.1',
    resolutionScope: { kind: 'neutral', label: 'Neutral QA Scribe runtime scope' },
    error: null,
    warnings: [],
    ...patch,
  }
}

function getCatalogSnapshot(provider: ProviderStatus['providers'][number]): ProviderModelCatalogSnapshot {
  return provider.catalogSnapshot
}
