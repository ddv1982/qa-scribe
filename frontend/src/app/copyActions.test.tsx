import { StrictMode, useEffect } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyAttachmentImageToClipboard, copyHtmlToClipboard } from '../tauri'
import { copyMatchesSnapshot, useCopyActions, type ClipboardSnapshot } from './copyActions'

vi.mock('../tauri', async (importOriginal) => ({ ...await importOriginal<typeof import('../tauri')>(), copyHtmlToClipboard: vi.fn(), copyAttachmentImageToClipboard: vi.fn() }))
const nativeText = vi.mocked(copyHtmlToClipboard)
const nativeImage = vi.mocked(copyAttachmentImageToClipboard)
const snapshot: ClipboardSnapshot = { target: { kind: 'draft', sessionId: 'alpha', id: 'same', action: 'jira-text' }, title: 'Same', bodyHtml: '<p><strong>Saved A</strong></p>' }
function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks() })

describe('controller-lifetime copy capability', () => {
  it('captures fresh immutable fields and admits only one text or image write, including same-tick attempts', async () => {
    const held = deferred()
    nativeText.mockReturnValueOnce(held.promise)
    const input = { target: { kind: 'draft' as const, sessionId: 'alpha', id: 'same', action: 'jira-text' as const }, title: 'Same', bodyHtml: '<p><strong>Saved A</strong></p>' }
    const { result } = renderHook(useCopyActions)
    let pending!: Promise<void>
    act(() => {
      pending = result.current.copy(input)
      void result.current.copy({ ...snapshot, target: { ...snapshot.target, action: 'screenshot' } })
      void result.current.copy({ ...snapshot, title: 'Ignored' })
      input.title = 'Mutated'
      input.bodyHtml = '<p>Mutated</p>'
      input.target.sessionId = 'beta'
      input.target.id = 'changed'
    })
    expect(nativeText.mock.calls).toEqual([['<h2>Same</h2><p><strong>Saved A</strong></p>', '## Same\n\n**Saved A**']])
    expect(nativeImage).not.toHaveBeenCalled()
    expect(result.current.copyState).toEqual({ status: 'pending', snapshot })
    await act(async () => { held.resolve(); await pending })
    expect(result.current.copyState).toEqual({ status: 'succeeded', snapshot })
    expect(Object.isFrozen(result.current.copyState.status === 'idle' ? null : result.current.copyState.snapshot.target)).toBe(true)
    nativeText.mockResolvedValueOnce(undefined)
    await act(async () => { await result.current.copy({ ...snapshot, bodyHtml: '<p>Saved B</p>' }) })
    expect(nativeText.mock.calls[1]).toEqual(['<h2>Same</h2><p>Saved B</p>', '## Same\n\nSaved B'])
  })

  it('matches kind, Session, record, action, title and body instead of title or ID alone', () => {
    const state = { status: 'succeeded' as const, snapshot }
    expect(copyMatchesSnapshot(state, snapshot)).toBe(true)
    for (const other of [
      { ...snapshot, target: { kind: 'finding' as const, sessionId: 'alpha', id: 'same', action: 'jira-text' as const } },
      { ...snapshot, target: { ...snapshot.target, sessionId: 'beta' } },
      { ...snapshot, target: { kind: 'draft' as const, sessionId: 'alpha', id: 'other', action: 'jira-text' as const } },
      { ...snapshot, target: { ...snapshot.target, action: 'screenshot' as const } },
      { ...snapshot, title: 'Changed' }, { ...snapshot, bodyHtml: '<p>New content</p>' },
    ]) expect(copyMatchesSnapshot(state, other)).toBe(false)
    expect(copyMatchesSnapshot({ status: 'idle' }, snapshot)).toBe(false)
  })

  it('allows successful browser fallback after native rejection and exposes total failure with retry', async () => {
    nativeText.mockRejectedValue(new Error('Native rejected'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { result } = renderHook(useCopyActions)
    await act(async () => { await result.current.copy(snapshot) })
    expect(writeText.mock.calls).toEqual([['## Same\n\n**Saved A**']])
    expect(result.current.copyState.status).toBe('succeeded')
    writeText.mockRejectedValueOnce(new Error('All transports rejected'))
    await act(async () => { await result.current.copy(snapshot) })
    expect(result.current.copyState).toEqual({ status: 'failed', snapshot, error: 'Something went wrong: All transports rejected' })
    nativeText.mockResolvedValueOnce(undefined)
    await act(async () => { await result.current.copy(snapshot) })
    expect(result.current.copyState).toEqual({ status: 'succeeded', snapshot })
  })

  it('fails missing managed images and never skips a rejected first managed screenshot', async () => {
    nativeText.mockResolvedValue(undefined)
    const { result } = renderHook(useCopyActions)
    await act(async () => { await result.current.copy(snapshot) })
    const missing = { ...snapshot, target: { ...snapshot.target, action: 'screenshot' as const }, bodyHtml: '<p><img src="https://example.test/external.png"></p>' }
    await act(async () => { await result.current.copy(missing) })
    expect(result.current.copyState).toEqual({ status: 'failed', snapshot: missing, error: 'Something went wrong: No screenshot found in this record.' })
    expect(nativeImage).not.toHaveBeenCalled()
    nativeImage.mockRejectedValueOnce(new Error('First image disappeared'))
    const images = { ...missing, bodyHtml: '<img src="https://example.test/external.png"><img src="qa-scribe-attachment://first" alt="First"><img src="qa-scribe-attachment://second" alt="Second">' }
    await act(async () => { await result.current.copy(images) })
    expect(nativeImage.mock.calls).toEqual([['first']])
    expect(result.current.copyState).toEqual({ status: 'failed', snapshot: images, error: 'Something went wrong: First image disappeared' })
  })

  it('does not expire a newer pending copy or release its guard on elapsed time', async () => {
    vi.useFakeTimers()
    nativeText.mockResolvedValueOnce(undefined)
    const { result } = renderHook(useCopyActions)
    await act(async () => { await result.current.copy(snapshot) })
    act(() => { vi.advanceTimersByTime(1700) })
    const held = deferred()
    nativeText.mockReturnValueOnce(held.promise)
    let pending!: Promise<void>
    act(() => { pending = result.current.copy({ ...snapshot, title: 'Next' }) })
    act(() => { vi.advanceTimersByTime(60_000); void result.current.copy(snapshot) })
    expect(nativeText).toHaveBeenCalledTimes(2)
    expect(result.current.copyState.status).toBe('pending')
    await act(async () => { held.resolve(); await pending })
    act(() => { vi.advanceTimersByTime(1799) })
    expect(result.current.copyState.status).toBe('succeeded')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.copyState).toEqual({ status: 'idle' })
  })

  it.each(['resolve', 'reject'] as const)('publishes no late state or timer after unmount on %s', async (outcome) => {
    vi.useFakeTimers()
    const held = deferred()
    nativeText.mockReturnValueOnce(held.promise)
    const { result, unmount } = renderHook(useCopyActions)
    let pending!: Promise<void>
    act(() => { pending = result.current.copy(snapshot) })
    const last = result.current.copyState
    unmount()
    await act(async () => {
      if (outcome === 'resolve') held.resolve()
      else held.reject(new Error('Late failure'))
      await pending
    })
    expect(result.current.copyState).toBe(last)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restores the mounted guard during development effect replay without admitting a second write', async () => {
    const held = deferred()
    nativeText.mockReturnValueOnce(held.promise)
    const { result } = renderHook(() => {
      const actions = useCopyActions()
      const { copy } = actions
      useEffect(() => { void copy(snapshot) }, [copy])
      return actions
    }, { wrapper: StrictMode })
    expect(nativeText).toHaveBeenCalledTimes(1)
    await act(async () => { held.resolve(); await held.promise })
    expect(result.current.copyState).toEqual({ status: 'succeeded', snapshot })
  })
})
