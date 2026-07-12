import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { draftFixture, entryFixture, generationStatusFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import { cleanupControllerTest, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController lifecycle and memoization', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)
  it('does not merge a generated draft canonicalization after switching notes', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    let resolveUpdateDraft: (draft: ReturnType<typeof draftFixture>) => void = () => {}
    tauriMock.updateDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdateDraft = resolve
      }),
    )
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent({
        type: 'completed',
        job_id: 'job-1',
        status: generationStatusFixture({ state: 'completed' }),
        result: {
          generationContext: { id: 'context-1', sessionId: 'session-1', createdAt: '2026-06-24T10:00:00.000Z' },
          aiRun: {
            id: 'run-1',
            sessionId: 'session-1',
            generationContextId: 'context-1',
            provider: 'codex_cli',
            model: 'default',
            reasoningEffort: null,
            promptVersion: 'testware-v4',
            status: 'completed',
            errorMessage: null,
            createdAt: '2026-06-24T10:00:00.000Z',
            completedAt: '2026-06-24T10:00:00.000Z',
          },
          draft: draftFixture({ id: 'draft-from-session-1', sessionId: 'session-1' }),
          finding: null,
          noteEntry: null,
        },
      })
      return { jobId: 'job-1', status: generationStatusFixture({ jobId: 'job-1', state: 'completed' }) }
    })

    await act(async () => {
      await result.current.handleAiAction('testware')
    })
    expect(result.current.testwareDrafts.map((draft) => draft.id)).toContain('draft-from-session-1')

    const otherSession = sessionFixture({ id: 'session-2', title: 'Other note' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        session: otherSession,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }),
    )
    await act(async () => {
      await result.current.openSession(otherSession)
    })

    act(() => {
      resolveUpdateDraft(draftFixture({ id: 'draft-from-session-1', sessionId: 'session-1' }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.activeSession?.id).toBe('session-2')
    expect(result.current.testwareDrafts).toEqual([])
  })

  it('keeps testwareDrafts and draftScreenshotCounts referentially stable across a keystroke after Drafts load', async () => {
    tauriMock.listDrafts.mockResolvedValue([draftFixture({ id: 'draft-1' })])
    tauriMock.createDraft.mockResolvedValue(draftFixture({ id: 'draft-1' }))
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => {
      await result.current.handleManualTestware()
    })
    await waitFor(() => expect(result.current.testwareDrafts.length).toBe(1))

    // Capture the memoized references, then re-render via a note-body change
    // (a keystroke). Because `drafts` is unchanged, both memos must reuse their
    // prior value — an inline `drafts.filter(...)` would break this and re-run
    // the DOMParser-backed `draftScreenshotCounts` computation every keystroke.
    const draftsBefore = result.current.testwareDrafts
    const countsBefore = result.current.draftScreenshotCounts

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('a keystroke unrelated to drafts'))
    })

    expect(result.current.testwareDrafts).toBe(draftsBefore)
    expect(result.current.draftScreenshotCounts).toBe(countsBefore)
  })

  it('recovers an active job on boot and drives it to terminal by polling', async () => {
    // Backend still has a running testware job from before the webview reload.
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-boot', action: 'testware', state: 'running' }),
    ])
    // First poll: still running. Second poll: completed.
    tauriMock.getAiActionJobStatus
      .mockResolvedValueOnce(generationStatusFixture({ jobId: 'job-boot', action: 'testware', state: 'running' }))
      .mockResolvedValueOnce(generationStatusFixture({ jobId: 'job-boot', action: 'testware', state: 'completed', progressMessage: 'Generation completed' }))

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    // The recovered job restores the pending/busy affordance for its action.
    await waitFor(() => expect(result.current.pendingAiActions.testware).toBe(true))
    expect(result.current.activeTestwareJob?.jobId).toBe('job-boot')

    // Polling eventually observes the terminal state and clears the pending UI.
    // The first poll fires only after RECONCILE_POLL_INTERVAL_MS (1s), which
    // dead-heats waitFor's default 1s timeout on slow runners.
    await waitFor(() => expect(tauriMock.getAiActionJobStatus).toHaveBeenCalledWith('job-boot'), { timeout: 4000 })
    await waitFor(() => expect(result.current.pendingAiActions.testware).toBeUndefined(), { timeout: 4000 })
    expect(result.current.activeTestwareJob).toBeNull()
  })

  it('does not reconcile when the backend reports no active jobs', async () => {
    tauriMock.listActiveAiActionJobs.mockResolvedValue([])

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriMock.listActiveAiActionJobs).toHaveBeenCalled())
    expect(tauriMock.getAiActionJobStatus).not.toHaveBeenCalled()
    expect(result.current.pendingAiActions.testware).toBeUndefined()
  })
})
