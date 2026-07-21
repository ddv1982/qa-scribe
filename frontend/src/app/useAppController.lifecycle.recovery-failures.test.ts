import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, generationStatusFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToHtml, richEditorDocumentToPlainText } from '../editor/editorDocument'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController recovery failure protection', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)
  it('keeps preserved images unsaved until their compensating write succeeds', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({
        noteEntry: entryFixture({
          body: '<p>Original Note.</p><p><img data-attachment-id="attachment-1" src="qa-scribe-attachment://attachment-1" alt="Evidence"></p>',
        }),
      }))
      .mockResolvedValueOnce(sessionNoteStateFixture({
        noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }),
      }))
    tauriMock.updateEntry.mockRejectedValueOnce(new Error('Temporary image persistence failure'))

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await Promise.resolve() })

    expect(richEditorDocumentToHtml(result.current.noteBody)).toContain('qa-scribe-attachment://attachment-1')
    expect(result.current.sessionSaveState).toBe('unsaved')
    expect(result.current.error).toContain('Temporary image persistence failure')

    let retried = false
    await act(async () => { retried = await result.current.saveNoteNow() })
    expect(retried).toBe(true)
    expect(result.current.sessionSaveState).toBe('saved')
  })

  it('keeps recovery fail-closed across a transient status error', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus
      .mockRejectedValueOnce(new Error('Temporary status failure'))
      .mockResolvedValueOnce(generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }))
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }) }))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Canonical Summary.</p>' }) }))

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Startup Note.')
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Dirty during status retry')))
    expect(await result.current.saveNoteNow()).toBe(false)

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(tauriMock.getAiActionJobStatus).toHaveBeenCalledTimes(2)
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Canonical Summary.')
  })

  it('keeps a completed Summary blocked until a transient canonical reload succeeds', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }) }))
      .mockRejectedValueOnce(new Error('Temporary canonical reload failure'))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Canonical Summary.</p>' }) }))

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Dirty during canonical reload')))
    expect(await result.current.saveNoteNow()).toBe(false)
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Dirty during canonical reload')

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Canonical Summary.')
  })

  it('does not hydrate an editable Note until transient active-job discovery succeeds', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs
      .mockRejectedValueOnce(new Error('Temporary discovery failure'))
      .mockResolvedValueOnce([])

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.activeSession).toBeNull()
    expect(result.current.noteEntry).toBeNull()
    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(tauriMock.listActiveAiActionJobs).toHaveBeenCalledTimes(2)
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.noteEntry?.id).toBe('entry-1')
  })

  it('retains completed Summary protection while its Session is opening in flight', async () => {
    vi.useFakeTimers()
    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Other Session' })
    const staleOpen = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    let sessionTwoLoads = 0
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', sessionId: 'session-2', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', sessionId: 'session-2', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState.mockImplementation((sessionId: string) => {
      if (sessionId === 'session-1') return Promise.resolve(sessionNoteStateFixture())
      sessionTwoLoads += 1
      if (sessionTwoLoads === 1) return staleOpen.promise
      return Promise.resolve(sessionNoteStateFixture({
        session: sessionTwo,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2', body: '<p>Canonical Summary.</p>' }),
      }))
    })

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    let openPromise!: Promise<void>
    act(() => { openPromise = result.current.openSession(sessionTwo) })
    await act(async () => { await Promise.resolve() })

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.activeSession?.id).toBe('session-1')
    staleOpen.resolve(sessionNoteStateFixture({
      session: sessionTwo,
      noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2', body: '<p>Stale Note.</p>' }),
    }))
    await act(async () => { await openPromise })
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Canonical Summary.')
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Dirty stale Session two edit')))
    expect(await result.current.saveNoteNow()).toBe(true)
    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-2',
      expect.objectContaining({ body: expect.stringContaining('Dirty stale Session two edit') }),
    )
  })
})
