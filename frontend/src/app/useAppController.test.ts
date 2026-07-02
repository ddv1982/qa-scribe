import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftFixture, entryFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'

const tauriMock = vi.hoisted(() => ({
  cancelAiActionJob: vi.fn(),
  createDraft: vi.fn(),
  createEntry: vi.fn(),
  createFinding: vi.fn(),
  createSession: vi.fn(),
  deleteDraft: vi.fn(),
  deleteFinding: vi.fn(),
  deleteSession: vi.fn(),
  getProviderStatus: vi.fn(),
  getSettings: vi.fn(),
  listDrafts: vi.fn(),
  listEntries: vi.fn(),
  listFindings: vi.fn(),
  listSessions: vi.fn(),
  reopenSession: vi.fn(),
  refreshProviderStatus: vi.fn(),
  startAiActionJob: vi.fn(),
  updateDraft: vi.fn(),
  updateEntry: vi.fn(),
  updateFinding: vi.fn(),
  updateSession: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock('../tauri', () => tauriMock)

import { useAppController } from './useAppController'
import { settingsFixture, providerStatusFixture } from '../test/fixtures'

describe('useAppController autosave flush', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureTestLocalStorage()
    window.localStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })

    tauriMock.getSettings.mockResolvedValue(settingsFixture())
    tauriMock.getProviderStatus.mockResolvedValue(providerStatusFixture())
    tauriMock.refreshProviderStatus.mockResolvedValue(providerStatusFixture())
    tauriMock.listSessions.mockResolvedValue([sessionFixture()])
    tauriMock.reopenSession.mockResolvedValue(sessionFixture())
    tauriMock.listEntries.mockResolvedValue([entryFixture()])
    tauriMock.listDrafts.mockResolvedValue([])
    tauriMock.listFindings.mockResolvedValue([])
    tauriMock.createEntry.mockResolvedValue(entryFixture())
    tauriMock.createSession.mockResolvedValue(sessionFixture({ id: 'session-2', title: 'Untitled note 2' }))
    tauriMock.updateSession.mockImplementation(async (_id: string, patch: { title?: string | null }) => sessionFixture({ title: patch.title ?? 'Checkout note' }))
    tauriMock.updateEntry.mockImplementation(async (_id: string, patch: { body?: string | null; bodyJson?: string | null; bodyFormat?: string | null }) =>
      entryFixture({
        body: patch.body ?? '<p>Checkout fails after payment.</p>',
        bodyJson: patch.bodyJson ?? null,
        bodyFormat: patch.bodyFormat ?? 'html',
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps busy state truthy for the full outer action even though the inner save resolves first', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('unsaved before manual testware'))
    })

    let resolveCreateDraft: (draft: ReturnType<typeof draftFixture>) => void = () => {}
    tauriMock.createDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreateDraft = resolve
      }),
    )

    let actionPromise!: Promise<void>
    act(() => {
      actionPromise = result.current.handleManualTestware()
    })

    // Let the inner saveNoteNow (saveTitle/saveBody) resolve while createDraft is still pending.
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalled())
    expect(result.current.isBusy).toBe(true)
    expect(result.current.busyAction).toBe('manual-testware')

    act(() => {
      resolveCreateDraft(draftFixture({ id: 'draft-1' }))
    })
    await act(async () => {
      await actionPromise
    })

    expect(result.current.isBusy).toBe(false)
  })

  it('flushes a pending body edit before switching to another note', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('typed but not yet saved'))
    })

    // Switch before the 850ms body debounce would have fired.
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other note' })
    tauriMock.reopenSession.mockResolvedValueOnce(otherSession)
    tauriMock.listEntries.mockResolvedValueOnce([entryFixture({ id: 'entry-2', sessionId: 'session-2' })])

    await act(async () => {
      await result.current.openNote(otherSession)
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
      await result.current.openNote(otherSession)
    })

    expect(tauriMock.reopenSession).not.toHaveBeenCalledWith('session-2')
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.error).toBeTruthy()
  })

  it('flushes a pending body edit before creating a new note', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteBody(richEditorDocumentFromPlainText('typed before new note'))
    })

    await act(async () => {
      await result.current.handleNewNote()
    })

    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('typed before new note') }),
    )
  })

  it('flushes a pending title edit before switching to another note', async () => {
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))

    act(() => {
      result.current.setNoteTitle('Renamed before switch')
    })

    const otherSession = sessionFixture({ id: 'session-2', title: 'Other note' })
    tauriMock.reopenSession.mockResolvedValueOnce(otherSession)
    tauriMock.listEntries.mockResolvedValueOnce([entryFixture({ id: 'entry-2', sessionId: 'session-2' })])

    await act(async () => {
      await result.current.openNote(otherSession)
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
        await result.current.handleDeleteNote(sessionToDelete)
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
      // promise chain (openNote etc.) settle before proceeding.
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

      await act(async () => {
        window.dispatchEvent(new Event('beforeunload'))
        // Flush the microtask queue triggered by the listener without advancing fake timers.
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(tauriMock.updateEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({ body: expect.stringContaining('typed before quit') }),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

function ensureTestLocalStorage() {
  if (typeof window.localStorage.clear === 'function') return

  const storage = new Map<string, string>()
  const localStorage = {
    get length() {
      return storage.size
    },
    clear() {
      storage.clear()
    },
    getItem(key: string) {
      return storage.get(key) ?? null
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null
    },
    removeItem(key: string) {
      storage.delete(key)
    },
    setItem(key: string, value: string) {
      storage.set(key, value)
    },
  } satisfies Storage

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorage,
  })
}
