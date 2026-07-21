import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { entryFixture } from '../test/fixtures'
import { richEditorDocumentFromHtml, richEditorDocumentFromPlainText, richEditorDocumentToHtml, richEditorDocumentToPlainText } from '../editor/editorDocument'
import { registerRichEditor } from '../editor/richEditorRegistry'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController Note autosave writes', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('rejects stale inline-image materialization after the Note edit is discarded', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const imageImport = deferred<{ id: string; filename: string }>()
    tauriMock.importClipboardScreenshot.mockReturnValueOnce(imageImport.promise)
    act(() => result.current.setNoteBody(richEditorDocumentFromHtml(
      '<p>Transient image</p><img src="data:image/png;base64,AAAA" alt="inline">',
    )))

    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1))
    expect(result.current.busyAction).toBe('save-body')
    expect(result.current.sessionSaveState).toBe('saving')
    await act(async () => { await result.current.discardPendingSessionEdits() })
    await act(async () => {
      imageImport.resolve({ id: 'attachment-late', filename: 'late.png' })
      await savePromise
    })

    expect(tauriMock.updateEntry).not.toHaveBeenCalled()
    expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-late')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toContain('Checkout fails after payment')
    expect(result.current.sessionSaveState).toBe('saved')
    expect(result.current.busyAction).toBeNull()
  })

  it('rejects older inline-image materialization after a newer Note save intent', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const imageImport = deferred<{ id: string; filename: string }>()
    tauriMock.importClipboardScreenshot.mockReturnValueOnce(imageImport.promise)
    act(() => result.current.setNoteBody(richEditorDocumentFromHtml(
      '<p>Older image intent</p><img src="data:image/png;base64,AAAA">',
    )))
    let olderSave!: Promise<boolean>
    act(() => { olderSave = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1))

    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Newest authored intent')))
    await act(async () => { await result.current.saveNoteNow() })
    await act(async () => {
      imageImport.resolve({ id: 'attachment-stale', filename: 'stale.png' })
      await olderSave
    })

    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1)
    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('Newest authored intent') }),
    )
    expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-stale')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Newest authored intent')
  })

  it('keeps an imported image retained by a newer Note edit after the older write resolves', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    tauriMock.importClipboardScreenshot.mockResolvedValueOnce({ id: 'attachment-retained', filename: 'retained.png' })
    const olderWrite = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry.mockReturnValueOnce(olderWrite.promise)
    act(() => result.current.setNoteBody(richEditorDocumentFromHtml(
      '<p>Older body</p><img src="data:image/png;base64,AAAA" alt="retained">',
    )))

    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1))
    act(() => result.current.setNoteBody(richEditorDocumentFromHtml(
      '<p>Newer body</p><img data-attachment-id="attachment-retained" src="qa-scribe-attachment://attachment-retained" alt="retained">',
    )))
    await act(async () => {
      olderWrite.resolve(entryFixture({
        body: '<p>Older body</p><img data-attachment-id="attachment-retained" src="qa-scribe-attachment://attachment-retained" alt="retained">',
      }))
      await savePromise
    })

    expect(tauriMock.deleteAttachment).not.toHaveBeenCalledWith('attachment-retained')
    expect(richEditorDocumentToHtml(result.current.noteBody)).toContain('attachment-retained')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Newer body')
  })

  it('reuses an ordinary Note image after save failure and cleans it on discard', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    tauriMock.importClipboardScreenshot.mockResolvedValue({ id: 'attachment-note-retry', filename: 'retry.png' })
    tauriMock.updateEntry
      .mockRejectedValueOnce(new Error('first save offline'))
      .mockRejectedValueOnce(new Error('second save offline'))
    act(() => result.current.setNoteBody(richEditorDocumentFromHtml(
      '<p>Retry image</p><img src="data:image/png;base64,AAAA" alt="Evidence">',
    )))

    await act(async () => { expect(await result.current.saveNoteNow()).toBe(false) })
    await act(async () => { expect(await result.current.saveNoteNow()).toBe(false) })
    expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1)
    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('attachment-note-retry') }),
    )

    await act(async () => { await result.current.discardPendingSessionEdits() })
    expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-note-retry')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toContain('Checkout fails after payment')
  })

  it('cleans a direct Note upload when its save fails and the edit is discarded', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    tauriMock.importClipboardScreenshot.mockResolvedValueOnce({ id: 'attachment-direct-discard', filename: 'direct.png' })
    tauriMock.updateEntry.mockRejectedValueOnce(new Error('save offline'))
    const editorId = 'direct-discard-editor'
    const insertImage = vi.fn((attachmentId: string) => {
      result.current.setNoteBody(richEditorDocumentFromHtml(
        `<p>Direct image</p><img data-attachment-id="${attachmentId}" src="qa-scribe-attachment://${attachmentId}" alt="Evidence">`,
      ))
      return true
    })
    const unregister = registerRichEditor(editorId, {
      editor: {} as Editor,
      insertImage,
      readOnly: false,
    })

    await act(async () => {
      await result.current.uploadEditorImage({
        editorId,
        file: new File(['image'], 'direct.png', { type: 'image/png' }),
        insertImage,
      }, { kind: 'note', id: result.current.noteEntry!.id })
    })
    await act(async () => { expect(await result.current.saveNoteNow()).toBe(false) })
    await act(async () => { await result.current.discardPendingSessionEdits() })

    expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-direct-discard')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toContain('Checkout fails after payment')
    unregister()
  })

  it('does not let a stale Note save response undo a later discard', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const save = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry.mockReturnValueOnce(save.promise)
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Save that will become stale')))
    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1))

    await act(async () => { await result.current.discardPendingSessionEdits() })
    await act(async () => {
      save.resolve(entryFixture({ body: '<p>Save that will become stale</p>' }))
      await savePromise
    })

    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(2)
    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('Checkout fails after payment') }),
    )
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toContain('Checkout fails after payment')
    expect(result.current.sessionSaveState).toBe('saved')
    expect(result.current.busyAction).toBeNull()
  })

  it('rejects an older Note save response after a newer authored intent', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const olderSave = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry.mockReturnValueOnce(olderSave.promise)
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Older save intent')))
    let olderSavePromise!: Promise<boolean>
    act(() => { olderSavePromise = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1))

    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Newer authored intent')))
    await act(async () => {
      olderSave.resolve(entryFixture({ body: '<p>Older save intent</p>' }))
      await olderSavePromise
    })

    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Newer authored intent')
    expect(result.current.sessionSaveState).toBe('unsaved')
    await act(async () => { await result.current.saveNoteNow() })
    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('Newer authored intent') }),
    )
    expect(result.current.sessionSaveState).toBe('saved')
  })
})
