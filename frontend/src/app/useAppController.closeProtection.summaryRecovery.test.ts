import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, generationStatusFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import {
  cleanupControllerTest,
  deferred,
  getTauriMock,
  getTauriWindowMock,
  setupControllerTest,
  useAppController,
} from './useAppController.testHarness'

const tauriMock = getTauriMock()
const tauriWindowMock = getTauriWindowMock()

describe('useAppController close protection: Summary recovery', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('keeps failed generation undo dirty so beforeunload can retry the save', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent({
        type: 'completed',
        job_id: 'job-summary',
        status: generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
        result: {
          generationContext: { id: 'context-1', sessionId: 'session-1', createdAt: '2026-06-24T10:00:00.000Z' },
          aiRun: {
            id: 'run-1',
            sessionId: 'session-1',
            generationContextId: 'context-1',
            provider: 'codex_cli',
            model: 'default',
            reasoningEffort: null,
            promptVersion: 'summary-v1',
            status: 'completed',
            errorMessage: null,
            createdAt: '2026-06-24T10:00:00.000Z',
            completedAt: '2026-06-24T10:00:00.000Z',
          },
          draft: null,
          finding: null,
          noteEntry: entryFixture({ body: '<p>Generated summary.</p>' }),
        },
      })
      return { jobId: 'job-summary', status: generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }) }
    })

    await act(async () => {
      await result.current.handleAiAction('summary')
    })
    await waitFor(() => expect(result.current.notice).toBe('Summarizing note'))
    expect(result.current.pendingRecoveredSummaryDecision).toBe(false)
    expect(result.current.sessionSaveState).toBe('saved')
    // The backend already persisted the generated Summary. With no images to
    // preserve, the frontend does not issue a redundant compensating write.
    expect(tauriMock.updateEntry).not.toHaveBeenCalled()

    tauriMock.updateEntry.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      await result.current.handleUndoLatestNoteGeneration()
    })
    await waitFor(() => expect(result.current.error).toBeTruthy())

    const event = new Event('beforeunload', { cancelable: true })
    await act(async () => {
      window.dispatchEvent(event)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(event.defaultPrevented).toBe(true)
    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('Checkout fails after payment') }),
    )
  })

  it('persists authored pre-recovery text before allowing native close', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce({
        session: sessionFixture(),
        noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }),
        testwareDraftCount: 0,
        findingCount: 0,
      })
      .mockResolvedValueOnce({
        session: sessionFixture(),
        noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }),
        testwareDraftCount: 0,
        findingCount: 0,
      })

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored before recovered close')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)

    const closeEvent = { preventDefault: vi.fn() }
    await act(async () => { await tauriWindowMock.closeRequestedHandler()?.(closeEvent) })

    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('Authored before recovered close') }),
    )
    expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1)
  })

  it('persists an edited recovered Summary before allowing native close', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce({
        session: sessionFixture(),
        noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }),
        testwareDraftCount: 0,
        findingCount: 0,
      })
      .mockResolvedValueOnce({
        session: sessionFixture(),
        noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }),
        testwareDraftCount: 0,
        findingCount: 0,
      })

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored before recovery')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Edited recovered Summary')))

    const closeEvent = { preventDefault: vi.fn() }
    await act(async () => { await tauriWindowMock.closeRequestedHandler()?.(closeEvent) })

    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: '<p>Edited recovered Summary</p>' }),
    )
    expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1)
  })

  it('retries a failed Keep generated Summary choice on native close', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce({
        session: sessionFixture(),
        noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }),
        testwareDraftCount: 0,
        findingCount: 0,
      })
      .mockResolvedValueOnce({
        session: sessionFixture(),
        noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }),
        testwareDraftCount: 0,
        findingCount: 0,
      })
    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored before recovery')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('Edited generated Summary'))
      result.current.setActiveView('settings')
    })
    tauriMock.updateEntry
      .mockRejectedValueOnce(new Error('generated choice offline'))
      .mockResolvedValueOnce(entryFixture({ body: '<p>Edited generated Summary</p>' }))

    await act(async () => { await result.current.discardPendingNavigationChanges() })
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
    expect(result.current.error).toContain('generated choice offline')

    const closeEvent = { preventDefault: vi.fn() }
    await act(async () => { await tauriWindowMock.closeRequestedHandler()?.(closeEvent) })

    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: '<p>Edited generated Summary</p>' }),
    )
    expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1)
  })

  it('allows Restore authored text to supersede a failed Keep generated Summary choice', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce({
        session: sessionFixture(),
        noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }),
        testwareDraftCount: 0,
        findingCount: 0,
      })
      .mockResolvedValueOnce({
        session: sessionFixture(),
        noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }),
        testwareDraftCount: 0,
        findingCount: 0,
      })
    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored before recovery')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('Edited generated Summary'))
      result.current.setActiveView('settings')
    })
    tauriMock.updateEntry
      .mockRejectedValueOnce(new Error('generated choice offline'))
      .mockRejectedValueOnce(new Error('authored choice offline'))
      .mockResolvedValueOnce(entryFixture({ body: '<p>Authored after failed restore</p>' }))

    await act(async () => { await result.current.discardPendingNavigationChanges() })
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
    await act(async () => { await result.current.savePendingNavigationChanges() })
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
    expect(result.current.error).toContain('authored choice offline')
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored after failed restore')))
    await act(async () => { await result.current.savePendingNavigationChanges() })

    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: '<p>Authored after failed restore</p>' }),
    )
    expect(result.current.pendingRecoveredSummaryDecision).toBe(false)
    expect(result.current.activeView).toBe('settings')
  })

  it('blocks beforeunload and native close while an equal-body recovered Summary decision is pending', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce({
        session: sessionFixture(),
        noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }),
        testwareDraftCount: 0,
        findingCount: 0,
      })
      .mockResolvedValueOnce({
        session: sessionFixture(),
        noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }),
        testwareDraftCount: 0,
        findingCount: 0,
      })

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored baseline.')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
    expect(result.current.sessionSaveState).toBe('unsaved')
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored baseline.')))

    const save = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry.mockReturnValueOnce(save.promise)
    const unload = new Event('beforeunload', { cancelable: true })
    await act(async () => {
      window.dispatchEvent(unload)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(unload.defaultPrevented).toBe(true)

    const closeEvent = { preventDefault: vi.fn() }
    let closePromise!: Promise<void>
    act(() => { closePromise = Promise.resolve(tauriWindowMock.closeRequestedHandler()?.(closeEvent)) })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriWindowMock.currentWindow.destroy).not.toHaveBeenCalled()

    await act(async () => {
      save.resolve(entryFixture({ body: '<p>Authored baseline.</p>' }))
      await closePromise
    })
    expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1)
  })
})
