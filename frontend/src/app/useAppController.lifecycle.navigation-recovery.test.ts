import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, generationStatusFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController recovery-gated navigation', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)
  it('persists authored pre-recovery text before completing requested navigation', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }) }))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }) }))

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored before navigation')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => result.current.setActiveView('settings'))
    expect(result.current.pendingNavigationView).toBe('settings')

    await act(async () => { await result.current.savePendingNavigationChanges() })

    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('Authored before navigation') }),
    )
    expect(result.current.activeView).toBe('settings')
    expect(result.current.pendingNavigationView).toBeNull()
    expect(result.current.pendingRecoveredSummaryDecision).toBe(false)
  })

  it('does not complete a pending navigation after its in-flight save is cancelled', async () => {
    const titleSave = deferred<ReturnType<typeof sessionFixture>>()
    tauriMock.updateSession.mockReturnValueOnce(titleSave.promise)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => result.current.setSessionTitle('Title saved after cancellation'))
    act(() => result.current.setActiveView('settings'))
    expect(result.current.pendingNavigationView).toBe('settings')

    let savePromise!: Promise<void>
    act(() => { savePromise = result.current.savePendingNavigationChanges() })
    await waitFor(() => expect(tauriMock.updateSession).toHaveBeenCalledTimes(1))
    act(() => result.current.cancelPendingNavigation())
    act(() => titleSave.resolve(sessionFixture({ title: 'Title saved after cancellation' })))
    await act(async () => savePromise)

    expect(result.current.activeView).toBe('sessions')
    expect(result.current.pendingNavigationView).toBeNull()
  })

  it('does not complete a pending navigation after its in-flight discard is cancelled', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }) }))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }) }))

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored before recovery')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Edited generated Summary')))
    act(() => result.current.setActiveView('settings'))

    const discardWrite = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry.mockReturnValueOnce(discardWrite.promise)
    let discardPromise!: Promise<void>
    act(() => { discardPromise = Promise.resolve(result.current.discardPendingNavigationChanges()) })
    await act(async () => { await Promise.resolve() })
    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)

    act(() => result.current.cancelPendingNavigation())
    await act(async () => {
      discardWrite.resolve(entryFixture({ body: '<p>Edited generated Summary</p>' }))
      await discardPromise
    })

    expect(result.current.activeView).toBe('sessions')
    expect(result.current.pendingNavigationView).toBeNull()
  })

  it('queues every cross-Session entry point behind the recovered Summary decision seam', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }) }))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }) }))

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored before recovery')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)

    const otherSession = sessionFixture({ id: 'session-2', title: 'Other Session' })
    const otherState = sessionNoteStateFixture({
      session: otherSession,
      noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
    })
    tauriMock.openSessionNoteState.mockClear()
    tauriMock.openSessionNoteState.mockResolvedValue(otherState)
    tauriMock.reopenSession.mockResolvedValue(otherSession)

    await act(async () => { await result.current.openSessionInCurrentView(otherSession) })
    expect(result.current.pendingNavigationView).toBe('sessions')
    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalled()
    act(() => result.current.cancelPendingNavigation())

    await act(async () => { await result.current.openSession(otherSession) })
    expect(result.current.pendingNavigationView).toBe('sessions')
    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalled()
    act(() => result.current.cancelPendingNavigation())

    await act(async () => { await result.current.handleNewSession() })
    expect(result.current.pendingNavigationView).toBe('sessions')
    expect(tauriMock.createSession).not.toHaveBeenCalled()
    act(() => result.current.cancelPendingNavigation())

    await act(async () => { await result.current.openLibraryRecord('session-2', 'testware', 'draft-2') })
    expect(result.current.pendingNavigationView).toBe('testware')
    expect(tauriMock.reopenSession).not.toHaveBeenCalled()
    act(() => result.current.cancelPendingNavigation())

    await act(async () => {
      window.location.hash = '#/sessions/session-2/findings/finding-2'
      window.dispatchEvent(new Event('hashchange'))
      await Promise.resolve()
    })
    expect(result.current.pendingNavigationView).toBe('findings')
    expect(tauriMock.reopenSession).not.toHaveBeenCalled()
    expect(result.current.activeSession?.id).toBe('session-1')
    act(() => result.current.cancelPendingNavigation())
    expect(result.current.activeSession?.id).toBe('session-1')

    await act(async () => { await result.current.openSessionInCurrentView(otherSession) })
    expect(result.current.pendingNavigationView).toBe('sessions')
    await act(async () => { await result.current.discardPendingNavigationChanges() })
    expect(result.current.activeSession?.id).toBe('session-2')
    expect(result.current.pendingRecoveredSummaryDecision).toBe(false)
  })
})
