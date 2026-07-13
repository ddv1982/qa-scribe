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

describe('useAppController close protection', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('flushes pending edits on window beforeunload, ahead of the debounce timer', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useAppController())

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.activeSession?.id).toBe('session-1')

      act(() => {
        result.current.setNoteBody(richEditorDocumentFromPlainText('typed before quit'))
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(tauriMock.updateEntry).not.toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({ body: expect.stringContaining('typed before quit') }),
      )

      const event = new Event('beforeunload', { cancelable: true })
      await act(async () => {
        window.dispatchEvent(event)
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

  it('does not keep beforeunload blocked after an edit has autosaved', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useAppController())

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.activeSession?.id).toBe('session-1')

      act(() => {
        result.current.setNoteBody(richEditorDocumentFromPlainText('autosaved before quit'))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(tauriMock.updateEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({ body: expect.stringContaining('autosaved before quit') }),
      )

      const event = new Event('beforeunload', { cancelable: true })
      await act(async () => {
        window.dispatchEvent(event)
      })

      expect(event.defaultPrevented).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('prevents Tauri window close until pending edits flush, then force-destroys the window', async () => {
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
    expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1)
    expect(tauriWindowMock.currentWindow.close).not.toHaveBeenCalled()
  })

  it('coalesces repeated Tauri close requests while the pending save is in flight', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriWindowMock.closeRequestedHandler()).toBeTruthy())

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('typed before repeated desktop close'))
    })

    const save = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry.mockReturnValueOnce(save.promise)
    const firstCloseEvent = { preventDefault: vi.fn() }
    const repeatedCloseEvent = { preventDefault: vi.fn() }
    let firstClosePromise!: Promise<void>

    act(() => {
      firstClosePromise = Promise.resolve(tauriWindowMock.closeRequestedHandler()?.(firstCloseEvent))
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(firstCloseEvent.preventDefault).toHaveBeenCalled()
    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)
    expect(tauriWindowMock.currentWindow.destroy).not.toHaveBeenCalled()

    await act(async () => {
      await tauriWindowMock.closeRequestedHandler()?.(repeatedCloseEvent)
    })

    expect(repeatedCloseEvent.preventDefault).toHaveBeenCalled()
    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)

    await act(async () => {
      save.resolve(entryFixture({ body: '<p>typed before repeated desktop close</p>' }))
      await firstClosePromise
    })

    expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1)
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
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })

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
    expect(tauriWindowMock.currentWindow.destroy).not.toHaveBeenCalled()
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
