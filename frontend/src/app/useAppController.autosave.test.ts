import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToPlainText } from '../editor/editorDocument'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

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
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })
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

  it('does not switch sessions when the flush of a pending edit fails', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('typed but flush will fail'))
    })

    tauriMock.updateEntry.mockRejectedValueOnce(new Error('offline'))
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })

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

  it('flushes an edit typed while a forced Session save is in flight before switching', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    const firstBody = richEditorDocumentFromPlainText('first edit')
    const secondBody = richEditorDocumentFromPlainText('edit typed while saving')
    act(() => result.current.setNoteBody(firstBody))

    const firstSave = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry.mockReturnValueOnce(firstSave.promise)
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })
    let openPromise!: Promise<void>
    act(() => {
      openPromise = result.current.openSession(otherSession)
    })
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.setNoteBody(secondBody)
      firstSave.resolve(entryFixture({ body: '<p>first edit</p>' }))
    })

    await act(async () => openPromise)
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('edit typed while saving')
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        session: otherSession,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }),
    )
    await act(async () => { await result.current.openSession(otherSession) })
    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('edit typed while saving') }),
    )
    expect(result.current.activeSession?.id).toBe('session-2')
  })

  it('flushes a pending body edit before creating a new session', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('typed before new session'))
    })

    await act(async () => {
      await result.current.handleNewSession()
    })

    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('typed before new session') }),
    )
  })

  it('flushes a pending title edit before switching to another note', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setSessionTitle('Renamed before switch')
    })

    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })
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
      expect(result.current.sessions.map((session) => session.id)).not.toContain('session-1')

      // If active-Session state (or the guard) were cleared incorrectly, a leftover
      // title/body debounce could still fire an autosave against the deleted session.
      act(() => {
        result.current.setSessionTitle('Edit after failed refresh')
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

})
