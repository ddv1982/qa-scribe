import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, generationStatusFixture } from '../test/fixtures'
import { richEditorDocumentFromHtml, richEditorDocumentFromPlainText, richEditorDocumentToPlainText } from '../editor/editorDocument'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController recovered Summary decisions', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)
  it('hydrates a stale Note only behind a recovered Summary block, then reloads the canonical completion', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Stale Note.</p>' }) }))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }) }))

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Stale Note.')
    expect(tauriMock.getAiActionJobStatus).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(tauriMock.openSessionNoteState).toHaveBeenCalledTimes(2)
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Generated Summary.')
  })

  it('waits for recovered-job capture before startup hydration when the Summary completes first', async () => {
    vi.useFakeTimers()
    const activeJobs = deferred<ReturnType<typeof generationStatusFixture>[]>()
    tauriMock.listActiveAiActionJobs.mockReturnValue(activeJobs.promise)
    tauriMock.openSessionNoteState.mockResolvedValue(
      sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Already generated Summary.</p>' }) }),
    )
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalled()

    await act(async () => {
      activeJobs.resolve([generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' })])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(tauriMock.openSessionNoteState).toHaveBeenCalledTimes(1)
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Already generated Summary.')

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(tauriMock.openSessionNoteState).toHaveBeenCalledTimes(2)
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Already generated Summary.')
  })

  it('preserves dirty local Note edits as the recovered Summary undo value', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Stale Note.</p>' }) }))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }) }))

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Dirty local edit')))

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Generated Summary.')
    expect(result.current.latestNoteGenerationUndo?.entryId).toBe('entry-1')
    expect(richEditorDocumentToPlainText(result.current.latestNoteGenerationUndo!.before)).toBe('Dirty local edit')
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
    expect(result.current.sessionSaveState).toBe('unsaved')
    expect(tauriMock.updateEntry).not.toHaveBeenCalled()
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Edited generated Summary')))
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
    expect(richEditorDocumentToPlainText(result.current.latestNoteGenerationUndo!.before)).toBe('Dirty local edit')
    expect(richEditorDocumentToPlainText(result.current.latestNoteGenerationUndo!.generated!)).toBe('Edited generated Summary')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
    expect(tauriMock.updateEntry).not.toHaveBeenCalled()
  })

  it('retries direct recovered Summary undo with the latest authored edit', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Stale Note.</p>' }) }))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }) }))
    tauriMock.updateEntry
      .mockRejectedValueOnce(new Error('undo offline'))
      .mockResolvedValueOnce(entryFixture({ body: '<p>Authored after failed undo</p>' }))

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored before recovery')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    await act(async () => { await result.current.handleUndoLatestNoteGeneration() })
    expect(result.current.latestNoteGenerationUndo?.pendingRecoveryChoice).toBe('authored')
    expect(result.current.error).toContain('undo offline')
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored after failed undo')))
    await act(async () => { await result.current.handleUndoLatestNoteGeneration() })

    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: '<p>Authored after failed undo</p>' }),
    )
    expect(result.current.pendingRecoveredSummaryDecision).toBe(false)
  })

  it('reuses materialized recovery images and cleans them when generated text wins', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'completed' }),
    )
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Stale Note.</p>' }) }))
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }) }))
    tauriMock.importClipboardScreenshot.mockResolvedValue({ id: 'attachment-recovery-retry', filename: 'retry.png' })
    tauriMock.updateEntry
      .mockRejectedValueOnce(new Error('first save offline'))
      .mockRejectedValueOnce(new Error('second save offline'))

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromHtml(
      '<p>Authored Evidence</p><img src="data:image/png;base64,AAAA" alt="Evidence">',
    )))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })

    await act(async () => { await result.current.handleUndoLatestNoteGeneration() })
    await act(async () => { await result.current.handleUndoLatestNoteGeneration() })
    expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1)
    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('attachment-recovery-retry') }),
    )

    await act(async () => { await result.current.discardPendingSessionEdits() })
    expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-recovery-retry')
    expect(result.current.pendingRecoveredSummaryDecision).toBe(false)
  })

  it('preserves edits from an earlier recovered Summary when a later Summary completes', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary-1', action: 'summary', state: 'running' }),
      generationStatusFixture({ jobId: 'job-summary-2', action: 'summary', state: 'running' }),
    ])
    let secondJobPolls = 0
    tauriMock.getAiActionJobStatus.mockImplementation(async (jobId: string) => {
      if (jobId === 'job-summary-2') secondJobPolls += 1
      return generationStatusFixture({
        jobId,
        action: 'summary',
        state: jobId === 'job-summary-2' && secondJobPolls === 1 ? 'running' : 'completed',
      })
    })
    const firstCompletion = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    const secondCompletion = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }) }))
      .mockReturnValueOnce(firstCompletion.promise)
      .mockReturnValueOnce(secondCompletion.promise)

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored before recoveries')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(tauriMock.openSessionNoteState).toHaveBeenCalledTimes(2)
    await act(async () => {
      firstCompletion.resolve(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>First recovered Summary.</p>' }) }))
      await firstCompletion.promise
      await Promise.resolve()
    })
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('First recovered Summary.')
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Edited first recovered Summary')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(tauriMock.openSessionNoteState).toHaveBeenCalledTimes(3)
    await act(async () => {
      secondCompletion.resolve(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Second recovered Summary.</p>' }) }))
      await secondCompletion.promise
      await Promise.resolve()
    })

    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Second recovered Summary.')
    expect(richEditorDocumentToPlainText(result.current.latestNoteGenerationUndo!.before)).toBe('Edited first recovered Summary')
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
  })

  it('ignores an older recovered Summary reload that resolves after a newer reload', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary-1', action: 'summary', state: 'running' }),
      generationStatusFixture({ jobId: 'job-summary-2', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockImplementation(async (jobId: string) => (
      generationStatusFixture({ jobId, action: 'summary', state: 'completed' })
    ))
    const olderReload = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    const newerReload = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    tauriMock.openSessionNoteState
      .mockResolvedValueOnce(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Startup Note.</p>' }) }))
      .mockReturnValueOnce(olderReload.promise)
      .mockReturnValueOnce(newerReload.promise)

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Authored before recoveries')))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(tauriMock.openSessionNoteState).toHaveBeenCalledTimes(3)

    await act(async () => {
      newerReload.resolve(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Newer recovered Summary.</p>' }) }))
      await newerReload.promise
      await Promise.resolve()
    })
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Newer recovered Summary.')

    await act(async () => {
      olderReload.resolve(sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Older recovered Summary.</p>' }) }))
      await olderReload.promise
      await Promise.resolve()
    })
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Newer recovered Summary.')
    expect(richEditorDocumentToPlainText(result.current.latestNoteGenerationUndo!.generated!)).toBe('Newer recovered Summary.')
  })

  it('keeps a recovered Summary decision pending when an older authored write resolves after a generated-side edit', async () => {
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

    const authoredWrite = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry.mockReturnValueOnce(authoredWrite.promise)
    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.saveNoteNow() })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Generated side edited later')))
    await act(async () => {
      authoredWrite.resolve(entryFixture({ body: '<p>Authored before recovery</p>' }))
      await savePromise
    })

    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)
    expect(result.current.pendingRecoveredSummaryDecision).toBe(true)
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Generated side edited later')
    expect(result.current.sessionSaveState).toBe('unsaved')
  })

  it('persists the authored pre-recovery Note when a recovered Summary decision is saved', async () => {
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

    let saved = false
    await act(async () => { saved = await result.current.saveNoteNow() })
    expect(saved).toBe(true)
    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('Authored before recovery') }),
    )
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Authored before recovery')
    expect(result.current.pendingRecoveredSummaryDecision).toBe(false)
    expect(result.current.sessionSaveState).toBe('saved')
  })

  it('keeps the generated Note when a recovered Summary decision is discarded', async () => {
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
    expect(result.current.pendingNavigationView).toBe('settings')
    await act(async () => {
      await result.current.discardPendingNavigationChanges()
      await Promise.resolve()
    })

    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Edited generated Summary')
    expect(result.current.pendingRecoveredSummaryDecision).toBe(false)
    expect(result.current.sessionSaveState).toBe('saved')
    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('Edited generated Summary') }),
    )
  })
})
