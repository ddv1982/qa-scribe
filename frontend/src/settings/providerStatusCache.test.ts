import { describe, expect, it, vi } from 'vitest'
import { providerStatusFixture } from '../test/fixtures'
import { mergeFastProviderStatus, readCachedProviderStatus, writeCachedProviderStatus } from './providerStatusCache'

describe('provider status cache', () => {
  it('round-trips successful local discovery without throwing on corrupt data', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const status = providerStatusFixture()

    writeCachedProviderStatus(status, storage)
    expect(readCachedProviderStatus(storage)).toEqual(status)

    values.set('qa-scribe-provider-status-v1', '{broken')
    expect(readCachedProviderStatus(storage)).toBeNull()
  })

  it('keeps fast readiness authoritative while reusing detected defaults as stale', () => {
    const cached = providerStatusFixture()
    cached.providers[0].models.push({
      id: 'gpt-live',
      label: 'GPT Live',
      description: 'Reported by Codex CLI',
      source: 'detected',
      isDefault: false,
      reasoningEfforts: ['medium'],
      defaultReasoningEffort: 'medium',
    })
    const fast = providerStatusFixture()
    fast.providers[0] = {
      ...fast.providers[0],
      status: 'authRequired',
      available: false,
      reason: 'Sign in required.',
      defaultSnapshot: { ...fast.providers[0].defaultSnapshot, state: 'unchecked', checkedAt: null },
      models: fast.providers[0].models.slice(0, 1),
    }

    const merged = mergeFastProviderStatus(fast, cached)

    expect(merged.providers[0]).toMatchObject({ status: 'authRequired', available: false, reason: 'Sign in required.' })
    expect(merged.providers[0].defaultSnapshot).toMatchObject({ state: 'stale', model: { value: 'gpt-5.5' } })
    expect(merged.providers[0].models.map((model) => model.id)).toContain('gpt-live')
  })

  it('does not reuse an unresolved snapshot', () => {
    const cached = providerStatusFixture()
    cached.providers[0].defaultSnapshot = {
      ...cached.providers[0].defaultSnapshot,
      state: 'unresolved',
    }
    const fast = providerStatusFixture()
    fast.providers[0].defaultSnapshot = {
      ...fast.providers[0].defaultSnapshot,
      state: 'unchecked',
      checkedAt: null,
    }

    expect(mergeFastProviderStatus(fast, cached)).toEqual(fast)
  })

  it('ignores storage write failures', () => {
    expect(() => writeCachedProviderStatus(providerStatusFixture(), { setItem: vi.fn(() => { throw new Error('quota') }) })).not.toThrow()
  })
})
