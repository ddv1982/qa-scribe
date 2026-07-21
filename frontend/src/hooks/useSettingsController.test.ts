import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createOpenGenerationPreflight } from '../app/generationPreflightAction'
import { readCachedProviderStatus } from '../settings/providerStatusCache'
import { providerModelDescriptorFixture, providerStatusFixture, settingsFixture } from '../test/fixtures'
import type { ProviderStatus } from '../tauri'
import { useSettingsController } from './useSettingsController'

const tauriMock = vi.hoisted(() => ({
  getProviderStatus: vi.fn(),
  refreshProviderStatus: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock('../tauri', () => tauriMock)

describe('useSettingsController provider observation ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureTestLocalStorage()
    window.localStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    tauriMock.updateSettings.mockResolvedValue(settingsFixture())
  })

  afterEach(cleanup)

  it('does not let the shallow startup response replace a newer deep observation', async () => {
    const fast = deferred<ProviderStatus>()
    const deep = deferred<ProviderStatus>()
    const fastStatus = providerObservation('fast-startup', 'unchecked', 'idle')
    const deepStatus = providerObservation('deep-startup', 'detected', 'fresh')
    tauriMock.getProviderStatus.mockReturnValueOnce(fast.promise)
    tauriMock.refreshProviderStatus.mockReturnValueOnce(deep.promise)
    const { result } = renderController()

    let fastRequest!: Promise<void>
    let deepRequest!: Promise<void>
    act(() => {
      fastRequest = result.current.loadProviderStatus()
      deepRequest = result.current.discoverProviderDefaults()
    })

    await act(async () => {
      deep.resolve(deepStatus)
      await deepRequest
    })
    expect(result.current.providerStatus).toBe(deepStatus)

    await act(async () => {
      fast.resolve(fastStatus)
      await fastRequest
    })

    expect(result.current.providerStatus).toBe(deepStatus)
    expect(result.current.providerDiscoveryState).toBe('ready')
    expect(readCachedProviderStatus()?.providers[0].defaultSnapshot.model.value).toBe('deep-startup')
  })

  it('keeps a newer manual observation when automatic discovery completes last', async () => {
    const automatic = deferred<ProviderStatus>()
    const manual = deferred<ProviderStatus>()
    const automaticStatus = providerObservation('automatic', 'detected', 'fresh')
    const manualStatus = providerObservation('manual', 'detected', 'fresh')
    tauriMock.refreshProviderStatus
      .mockReturnValueOnce(automatic.promise)
      .mockReturnValueOnce(manual.promise)
    const { result } = renderController()

    let automaticRequest!: Promise<void>
    let manualRequest!: Promise<void>
    act(() => {
      automaticRequest = result.current.discoverProviderDefaults()
      manualRequest = result.current.refreshProviderStatus()
    })

    await act(async () => {
      manual.resolve(manualStatus)
      await manualRequest
    })
    await act(async () => {
      automatic.resolve(automaticStatus)
      await automaticRequest
    })

    expect(result.current.providerStatus).toBe(manualStatus)
    expect(result.current.providerDiscoveryState).toBe('ready')
    expect(readCachedProviderStatus()?.providers[0].defaultSnapshot.model.value).toBe('manual')
  })

  it('ignores an older automatic failure after a newer manual observation succeeds', async () => {
    const automatic = deferred<ProviderStatus>()
    const manualStatus = providerObservation('manual-after-failure', 'detected', 'fresh')
    tauriMock.refreshProviderStatus
      .mockReturnValueOnce(automatic.promise)
      .mockResolvedValueOnce(manualStatus)
    const { result } = renderController()

    let automaticRequest!: Promise<void>
    act(() => {
      automaticRequest = result.current.discoverProviderDefaults()
    })
    await act(async () => {
      await result.current.refreshProviderStatus()
    })
    await act(async () => {
      automatic.reject(new Error('late automatic failure'))
      await automaticRequest
    })

    expect(result.current.providerStatus).toBe(manualStatus)
    expect(result.current.providerDiscoveryState).toBe('ready')
  })

  it('uses invocation order for repeated deep refreshes even when promises resolve in reverse', async () => {
    const first = deferred<ProviderStatus>()
    const second = deferred<ProviderStatus>()
    const firstStatus = providerObservation('first-refresh', 'detected', 'fresh')
    const secondStatus = providerObservation('second-refresh', 'detected', 'fresh')
    tauriMock.refreshProviderStatus
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result } = renderController()

    let firstRequest!: Promise<void>
    let secondRequest!: Promise<void>
    act(() => {
      firstRequest = result.current.refreshProviderStatus()
      secondRequest = result.current.refreshProviderStatus()
    })

    await act(async () => {
      second.resolve(secondStatus)
      await secondRequest
    })
    await act(async () => {
      first.resolve(firstStatus)
      await firstRequest
    })

    expect(result.current.providerStatus).toBe(secondStatus)
    expect(readCachedProviderStatus()?.providers[0].defaultSnapshot.model.value).toBe('second-refresh')
  })

  it('keeps a successful superseded refresh as the last-good fallback when the leader rejects', async () => {
    const first = deferred<ProviderStatus>()
    const second = deferred<ProviderStatus>()
    const firstStatus = providerObservation('fallback-refresh', 'detected', 'fresh')
    tauriMock.refreshProviderStatus
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result } = renderController()

    let firstRequest!: Promise<void>
    let secondRequest!: Promise<void>
    act(() => {
      firstRequest = result.current.refreshProviderStatus()
      secondRequest = result.current.refreshProviderStatus()
    })
    await act(async () => {
      first.resolve(firstStatus)
      await firstRequest
    })

    expect(result.current.providerStatus).toBe(firstStatus)
    expect(result.current.providerDiscoveryState).toBe('refreshing')

    let rejected = false
    await act(async () => {
      second.reject(new Error('newest refresh failed'))
      try {
        await secondRequest
      } catch {
        rejected = true
      }
    })

    expect(rejected).toBe(true)
    expect(result.current.providerStatus).toBe(firstStatus)
    expect(result.current.providerDiscoveryState).toBe('stale')
    expect(readCachedProviderStatus()?.providers[0].defaultSnapshot.model.value).toBe('fallback-refresh')
  })

  it('orders a generation-preflight refresh with automatic discovery', async () => {
    const automatic = deferred<ProviderStatus>()
    const preflight = deferred<ProviderStatus>()
    const automaticStatus = providerObservation('automatic-preflight-race', 'detected', 'fresh')
    const preflightStatus = providerObservation('generation-preflight', 'detected', 'fresh')
    tauriMock.refreshProviderStatus
      .mockReturnValueOnce(automatic.promise)
      .mockReturnValueOnce(preflight.promise)
    const { result } = renderController()
    const setBusyAction = vi.fn()
    const setPendingGenerationAction = vi.fn()
    const openGenerationPreflight = createOpenGenerationPreflight(
      null,
      result.current.refreshProviderStatus,
      setBusyAction,
      setPendingGenerationAction,
    )

    let automaticRequest!: Promise<void>
    let preflightRequest!: Promise<void>
    act(() => {
      automaticRequest = result.current.discoverProviderDefaults()
      preflightRequest = openGenerationPreflight('summary')
    })

    await act(async () => {
      preflight.resolve(preflightStatus)
      await preflightRequest
    })
    await act(async () => {
      automatic.resolve(automaticStatus)
      await automaticRequest
    })

    expect(result.current.providerStatus).toBe(preflightStatus)
    expect(setBusyAction).toHaveBeenNthCalledWith(1, 'refresh-providers')
    expect(setBusyAction).toHaveBeenLastCalledWith(null)
    expect(setPendingGenerationAction).toHaveBeenCalledWith('summary')
  })

  it('retains independent last-good catalog and default snapshots when the leading refresh rejects', async () => {
    const lastGood = providerObservation('last-good', 'detected', 'stale')
    lastGood.providers[0].catalogSnapshot.models = [
      providerModelDescriptorFixture({ id: 'retained-account-model', label: 'Retained account model' }),
    ]
    tauriMock.refreshProviderStatus
      .mockResolvedValueOnce(lastGood)
      .mockRejectedValueOnce(new Error('bridge unavailable'))
    const { result } = renderController()

    await act(async () => {
      await result.current.refreshProviderStatus()
    })
    await act(async () => {
      await result.current.discoverProviderDefaults()
    })

    expect(result.current.providerStatus).toBe(lastGood)
    expect(result.current.providerStatus?.providers[0].defaultSnapshot).toMatchObject({
      state: 'detected',
      model: { value: 'last-good' },
    })
    expect(result.current.providerStatus?.providers[0].catalogSnapshot).toMatchObject({
      state: 'stale',
      models: [{ id: 'retained-account-model' }],
    })
    expect(result.current.providerDiscoveryState).toBe('stale')
  })
})

function renderController() {
  return renderHook(() => useSettingsController({ setError: vi.fn(), setNotice: vi.fn() }))
}

function providerObservation(
  marker: string,
  defaultState: ProviderStatus['providers'][number]['defaultSnapshot']['state'],
  catalogState: ProviderStatus['providers'][number]['catalogSnapshot']['state'],
): ProviderStatus {
  const status = providerStatusFixture()
  const model = providerModelDescriptorFixture({ id: marker, label: marker })
  status.providers[0] = {
    ...status.providers[0],
    reason: marker,
    models: [model],
    defaultSnapshot: {
      ...status.providers[0].defaultSnapshot,
      state: defaultState,
      model: { ...status.providers[0].defaultSnapshot.model, value: marker },
      checkedAt: defaultState === 'unchecked' ? null : `2026-07-20T10:00:00.${marker.length.toString().padStart(3, '0')}Z`,
    },
    catalogSnapshot: {
      ...status.providers[0].catalogSnapshot,
      state: catalogState,
      models: [model],
      checkedAt: catalogState === 'idle' ? null : `2026-07-20T10:00:00.${marker.length.toString().padStart(3, '0')}Z`,
    },
  }
  return status
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason?: unknown) => void = () => {}
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

function ensureTestLocalStorage() {
  if (typeof window.localStorage.clear === 'function') return
  const storage = new Map<string, string>()
  const localStorage = {
    get length() { return storage.size },
    clear() { storage.clear() },
    getItem(key: string) { return storage.get(key) ?? null },
    key(index: number) { return Array.from(storage.keys())[index] ?? null },
    removeItem(key: string) { storage.delete(key) },
    setItem(key: string, value: string) { storage.set(key, value) },
  } satisfies Storage
  Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorage })
}
