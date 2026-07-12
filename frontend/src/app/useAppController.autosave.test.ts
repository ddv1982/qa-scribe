import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftFixture, entryFixture, findingFixture, generationStatusFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import { cleanupControllerTest, getTauriMock, getTauriWindowMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()
const tauriWindowMock = getTauriWindowMock()

describe('useAppController autosave and close protection', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)
  it('flushes a pending body edit before switching to another note', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('typed but not yet saved'))
    })

    // Switch before the 850ms body debounce would have fired.
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

    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('typed but not yet saved') }),
    )
  })

  it('does not switch notes when the flush of a pending edit fails', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('typed but flush will fail'))
    })

    tauriMock.updateEntry.mockRejectedValueOnce(new Error('offline'))
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other note' })

    await act(async () => {
      await result.current.openSession(otherSession)
    })

    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.error).toBeTruthy()
  })

  it('does not let a queued body debounce make a failed forced switch flush look successful', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useAppController())

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.activeSession?.id).toBe('session-1')

      act(() => {
        result.current.setNoteBody(richEditorDocumentFromPlainText('typed before overlapping saves'))
      })

      let rejectForcedSave: (error: Error) => void = () => {}
      tauriMock.updateEntry.mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectForcedSave = reject
        }),
      )
      const otherSession = sessionFixture({ id: 'session-2', title: 'Other note' })

      let openPromise!: Promise<void>
      act(() => {
        openPromise = result.current.openSession(otherSession)
      })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)

      await act(async () => {
        rejectForcedSave(new Error('offline'))
        await openPromise
      })

      expect(tauriMock.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
      expect(result.current.activeSession?.id).toBe('session-1')
      expect(result.current.error).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes a pending body edit before creating a new note', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('typed before new note'))
    })

    await act(async () => {
      await result.current.handleNewSession()
    })

    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('typed before new note') }),
    )
  })

  it('flushes dirty Draft and Finding edits before switching to another note', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        testwareDraftCount: 1,
        findingCount: 1,
      }),
    )
    tauriMock.listDrafts.mockResolvedValueOnce([draftFixture({ id: 'draft-dirty', sessionId: 'session-1', body: '<p>Persisted draft.</p>' })])
    tauriMock.listFindings.mockResolvedValueOnce([findingFixture({ id: 'finding-dirty', sessionId: 'session-1', body: '<p>Persisted finding.</p>' })])

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-dirty']))
    act(() => {
      result.current.setActiveView('findings')
    })
    await waitFor(() => expect(result.current.findings.map((finding) => finding.id)).toEqual(['finding-dirty']))

    act(() => {
      result.current.updateLocalDraft('draft-dirty', { body: '<p>Unsaved draft edit.</p>' })
      result.current.updateLocalFinding('finding-dirty', { body: '<p>Unsaved finding edit.</p>' })
    })

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

    expect(tauriMock.updateDraft).toHaveBeenCalledWith('draft-dirty', expect.objectContaining({ body: '<p>Unsaved draft edit.</p>' }))
    expect(tauriMock.updateFinding).toHaveBeenCalledWith('finding-dirty', expect.objectContaining({ body: '<p>Unsaved finding edit.</p>' }))
    expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-2')
    expect(result.current.activeSession?.id).toBe('session-2')
  })

  it('does not switch notes when a dirty record flush fails', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        testwareDraftCount: 1,
      }),
    )
    tauriMock.listDrafts.mockResolvedValueOnce([draftFixture({ id: 'draft-dirty', sessionId: 'session-1' })])

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-dirty']))

    act(() => {
      result.current.updateLocalDraft('draft-dirty', { body: '<p>Flush will fail.</p>' })
    })
    tauriMock.updateDraft.mockRejectedValueOnce(new Error('offline'))

    const otherSession = sessionFixture({ id: 'session-2', title: 'Other note' })
    await act(async () => {
      await result.current.openSession(otherSession)
    })

    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.error).toBeTruthy()
  })

  it('flushes a pending title edit before switching to another note', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteTitle('Renamed before switch')
    })

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

    expect(tauriMock.updateSession).toHaveBeenCalledWith('session-1', { title: 'Renamed before switch' })
  })

  it('keeps the delete guard protecting the deleted session when the follow-up listSessions call rejects', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useAppController())

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.activeSession?.id).toBe('session-1')

      tauriMock.deleteSession.mockResolvedValueOnce(undefined)
      tauriMock.listSessions.mockRejectedValueOnce(new Error('listSessions unavailable'))

      const sessionToDelete = sessionFixture({ id: 'session-1' })
      await act(async () => {
        await result.current.handleDeleteSession(sessionToDelete)
      })

      expect(tauriMock.deleteSession).toHaveBeenCalledWith('session-1')

      // If active-note state (or the guard) were cleared incorrectly, a leftover
      // title/body debounce could still fire an autosave against the deleted session.
      act(() => {
        result.current.setNoteTitle('Edit after failed refresh')
        result.current.setNoteBody(richEditorDocumentFromPlainText('Body edit after failed refresh'))
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      expect(tauriMock.updateSession).not.toHaveBeenCalledWith('session-1', expect.anything())
      expect(tauriMock.updateEntry).not.toHaveBeenCalledWith('entry-1', expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes pending edits on window beforeunload, ahead of the debounce timer', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useAppController())

      // Boot runs on a zero-delay timeout; advance it and let the resulting
      // promise chain (openSession etc.) settle before proceeding.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.activeSession?.id).toBe('session-1')

      act(() => {
        result.current.setNoteBody(richEditorDocumentFromPlainText('typed before quit'))
      })

      // Advance well short of the 850ms body debounce so only the beforeunload
      // flush (not the ambient timer) can be responsible for the save.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(tauriMock.updateEntry).not.toHaveBeenCalledWith('entry-1', expect.objectContaining({ body: expect.stringContaining('typed before quit') }))

      const event = new Event('beforeunload', { cancelable: true })
      await act(async () => {
        window.dispatchEvent(event)
        // Flush the microtask queue triggered by the listener without advancing fake timers.
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(event.defaultPrevented).toBe(true)
      expect(tauriMock.updateEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({ body: expect.stringContaining('typed before quit') }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('prevents Tauri window close until pending edits flush, then closes explicitly', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriWindowMock.closeRequestedHandler()).toBeTruthy())

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('typed before desktop close'))
    })

    const closeEvent = { preventDefault: vi.fn() }
    await act(async () => {
      await tauriWindowMock.closeRequestedHandler()?.(closeEvent)
    })

    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('typed before desktop close') }),
    )
    expect(tauriWindowMock.currentWindow.close).toHaveBeenCalledTimes(1)
  })

  it('shares one forced flush when Session switch and Tauri close overlap', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriWindowMock.closeRequestedHandler()).toBeTruthy())

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('typed before overlapping forced saves'))
    })

    let rejectForcedSave: (error: Error) => void = () => {}
    tauriMock.updateEntry.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectForcedSave = reject
      }),
    )
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other note' })

    let openPromise!: Promise<void>
    act(() => {
      openPromise = result.current.openSession(otherSession)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)

    const closeEvent = { preventDefault: vi.fn() }
    let closePromise!: Promise<void>
    act(() => {
      closePromise = Promise.resolve(tauriWindowMock.closeRequestedHandler()?.(closeEvent))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)

    await act(async () => {
      rejectForcedSave(new Error('offline'))
      await Promise.all([openPromise, closePromise])
    })

    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(tauriWindowMock.currentWindow.close).not.toHaveBeenCalled()
  })

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
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledWith('entry-1', expect.objectContaining({ body: expect.stringContaining('Generated summary') })))

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

})
