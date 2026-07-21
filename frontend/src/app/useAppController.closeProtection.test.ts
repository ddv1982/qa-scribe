import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { draftFixture, entryFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromHtml, richEditorDocumentFromPlainText, richEditorDocumentToPlainText } from '../editor/editorDocument'
import { registerRichEditor } from '../editor/richEditorRegistry'
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

  it('waits for a discarded in-flight Note write and its restoration before closing', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriWindowMock.closeRequestedHandler()).toBeTruthy())
    const staleWrite = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry
      .mockReturnValueOnce(staleWrite.promise)
      .mockResolvedValueOnce(entryFixture())

    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Discarded Note edit')))
    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1))
    await act(async () => { await result.current.discardPendingSessionEdits() })

    const closeEvent = { preventDefault: vi.fn() }
    let closePromise!: Promise<void>
    act(() => { closePromise = Promise.resolve(tauriWindowMock.closeRequestedHandler()?.(closeEvent)) })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriWindowMock.currentWindow.destroy).not.toHaveBeenCalled()
    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)

    await act(async () => {
      staleWrite.resolve(entryFixture({ body: '<p>Discarded Note edit</p>' }))
      await Promise.all([savePromise, closePromise])
    })

    expect(tauriMock.updateEntry.mock.calls.length).toBeGreaterThanOrEqual(2)
    for (const [entryId, patch] of tauriMock.updateEntry.mock.calls.slice(1)) {
      expect(entryId).toBe('entry-1')
      expect(patch).toEqual(expect.objectContaining({ body: '<p>Checkout fails after payment.</p>' }))
    }
    expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1)
  })

  it('waits for a discarded in-flight Draft write and its restoration before closing', async () => {
    const draft = draftFixture({ id: 'draft-1', body: '<p>Saved Draft</p>' })
    tauriMock.listDrafts.mockResolvedValueOnce([draft])
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriWindowMock.closeRequestedHandler()).toBeTruthy())
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([draft]))
    const staleWrite = deferred<ReturnType<typeof draftFixture>>()
    tauriMock.updateDraft
      .mockReturnValueOnce(staleWrite.promise)
      .mockResolvedValueOnce(draft)

    act(() => result.current.updateLocalDraft(draft.id, { body: '<p>Discarded Draft edit</p>' }))
    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.handleSaveDraft(result.current.testwareDrafts[0]) })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledTimes(1))
    act(() => result.current.discardLocalDraft(draft))

    const closeEvent = { preventDefault: vi.fn() }
    let closePromise!: Promise<void>
    act(() => { closePromise = Promise.resolve(tauriWindowMock.closeRequestedHandler()?.(closeEvent)) })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriWindowMock.currentWindow.destroy).not.toHaveBeenCalled()
    expect(tauriMock.updateDraft).toHaveBeenCalledTimes(1)

    await act(async () => {
      staleWrite.resolve(draftFixture({ id: draft.id, body: '<p>Discarded Draft edit</p>' }))
      await Promise.all([savePromise, closePromise])
    })

    expect(tauriMock.updateDraft).toHaveBeenCalledTimes(2)
    expect(tauriMock.updateDraft).toHaveBeenLastCalledWith(
      draft.id,
      expect.objectContaining({ body: '<p>Saved Draft</p>' }),
    )
    expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1)
  })

  it('waits for and removes an inline-image import superseded by Note discard before closing', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriWindowMock.closeRequestedHandler()).toBeTruthy())
    const pendingImport = deferred<{ id: string; filename: string }>()
    tauriMock.importClipboardScreenshot.mockReturnValueOnce(pendingImport.promise)

    act(() => result.current.setNoteBody(richEditorDocumentFromHtml(
      '<p><img src="data:image/png;base64,AAAA" alt="Evidence" /></p>',
    )))
    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1))
    await act(async () => { await result.current.discardPendingSessionEdits() })

    const closeEvent = { preventDefault: vi.fn() }
    let closePromise!: Promise<void>
    act(() => { closePromise = Promise.resolve(tauriWindowMock.closeRequestedHandler()?.(closeEvent)) })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriWindowMock.currentWindow.destroy).not.toHaveBeenCalled()
    expect(tauriMock.deleteAttachment).not.toHaveBeenCalled()

    await act(async () => {
      pendingImport.resolve({ id: 'attachment-stale-note', filename: 'Evidence.png' })
      await Promise.all([savePromise, closePromise])
    })

    expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-stale-note')
    expect(tauriMock.updateEntry).not.toHaveBeenCalled()
    expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1)
  })

  it('waits for a direct upload insertion and saves the resulting Note before closing', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriWindowMock.closeRequestedHandler()).toBeTruthy())
    const pendingImport = deferred<{ id: string; filename: string }>()
    tauriMock.importClipboardScreenshot.mockReturnValueOnce(pendingImport.promise)
    const editorId = 'close-upload-editor'
    const insertImage = vi.fn(() => {
      result.current.setNoteBody(richEditorDocumentFromHtml(
        '<p>Uploaded before close</p><img data-attachment-id="attachment-close-upload" src="qa-scribe-attachment://attachment-close-upload" alt="close.png">',
      ))
      return true
    })
    const unregister = registerRichEditor(editorId, {
      editor: {} as Editor,
      insertImage,
      readOnly: false,
    })
    const uploadPromise = result.current.uploadEditorImage({
      editorId,
      file: new File(['image'], 'close.png', { type: 'image/png' }),
      insertImage,
    }, { kind: 'note', id: result.current.noteEntry!.id })
    await waitFor(() => expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1))

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
      pendingImport.resolve({ id: 'attachment-close-upload', filename: 'close.png' })
      await Promise.all([uploadPromise, closePromise])
    })

    expect(insertImage).toHaveBeenCalledTimes(1)
    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('attachment-close-upload') }),
    )
    expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1)
    unregister()
  })

  it('returns from close without destroying when stale attachment cleanup remains blocked', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriWindowMock.closeRequestedHandler()).toBeTruthy())
    tauriMock.deleteAttachment.mockResolvedValue(false)
    const editorId = 'declined-close-upload-editor'
    const insertImage = vi.fn(() => false)
    const unregister = registerRichEditor(editorId, {
      editor: {} as Editor,
      insertImage,
      readOnly: false,
    })
    await act(async () => {
      await result.current.uploadEditorImage({
        editorId,
        file: new File(['image'], 'declined.png', { type: 'image/png' }),
        insertImage,
      }, { kind: 'note', id: result.current.noteEntry!.id })
    })

    const closeEvent = { preventDefault: vi.fn() }
    await act(async () => { await tauriWindowMock.closeRequestedHandler()?.(closeEvent) })

    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriMock.deleteAttachment.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(tauriWindowMock.currentWindow.destroy).not.toHaveBeenCalled()
    unregister()
  })

  it('rechecks edits made while final attachment cleanup is in flight before closing', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriWindowMock.closeRequestedHandler()).toBeTruthy())
    const cleanup = deferred<boolean>()
    const imported = deferred<{ id: string; filename: string }>()
    tauriMock.importClipboardScreenshot.mockReturnValueOnce(imported.promise)
    const editorId = 'cleanup-close-editor'
    const insertImage = vi.fn(() => true)
    const unregister = registerRichEditor(editorId, {
      editor: {} as Editor,
      insertImage,
      readOnly: false,
    })
    let uploadPromise!: Promise<void>
    act(() => {
      uploadPromise = result.current.uploadEditorImage({
        editorId,
        file: new File(['image'], 'cleanup.png', { type: 'image/png' }),
        insertImage,
      }, { kind: 'note', id: result.current.noteEntry!.id })
    })
    await waitFor(() => expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1))
    unregister()
    tauriMock.deleteAttachment.mockResolvedValueOnce(false)
    await act(async () => {
      imported.resolve({ id: 'attachment-cleanup-close', filename: 'cleanup.png' })
      await uploadPromise
    })
    tauriMock.deleteAttachment.mockReturnValueOnce(cleanup.promise)

    const closeEvent = { preventDefault: vi.fn() }
    let closePromise!: Promise<void>
    act(() => { closePromise = Promise.resolve(tauriWindowMock.closeRequestedHandler()!(closeEvent)) })
    await waitFor(() => expect(tauriMock.deleteAttachment).toHaveBeenCalledTimes(2))
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Edit during final cleanup')))
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Edit during final cleanup')
    await act(async () => { cleanup.resolve(true) })

    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: '<p>Edit during final cleanup</p>' }),
    ))
    await waitFor(() => expect(tauriWindowMock.currentWindow.destroy).toHaveBeenCalledTimes(1))
    await closePromise
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

})
