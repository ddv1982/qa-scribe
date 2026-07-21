import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { draftFixture, entryFixture, findingFixture, generationStatusFixture, sessionFixture } from '../test/fixtures'
import { registerRichEditor } from '../editor/richEditorRegistry'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController workflows and record hydration', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('does not let generated Draft canonicalization overwrite a dirty local edit', async () => {
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
        status: generationStatusFixture({ jobId: 'job-1', action: 'testware', state: 'completed' }),
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
          draft: draftFixture({ id: 'draft-generated', sessionId: 'session-1', body: '<p>Generated body.</p>' }),
          finding: null,
          noteEntry: null,
        },
      })
      return { jobId: 'job-1', status: generationStatusFixture({ jobId: 'job-1', action: 'testware', state: 'completed' }) }
    })

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => {
      await result.current.handleAiAction('testware')
    })

    act(() => {
      result.current.updateLocalDraft('draft-generated', { body: '<p>Unsaved edit after generation.</p>' })
      resolveUpdateDraft(draftFixture({ id: 'draft-generated', sessionId: 'session-1', body: '<p>Canonical server body.</p>' }))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.testwareDrafts.find((draft) => draft.id === 'draft-generated')?.body).toBe('<p>Unsaved edit after generation.</p>')
  })

  it('materializes inline data images before saving a dirty Draft', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        testwareDraftCount: 1,
      }),
    )
    tauriMock.listDrafts.mockResolvedValueOnce([draftFixture({ id: 'draft-inline', sessionId: 'session-1', body: '<p>Persisted draft.</p>' })])

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-inline']))

    act(() => {
      result.current.updateLocalDraft('draft-inline', { body: '<p><img src="data:image/png;base64,AAAA" alt="Evidence" /></p>' })
    })
    await act(async () => {
      await result.current.handleSaveDraft(result.current.testwareDrafts[0])
    })

    expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledWith({
      sessionId: 'session-1',
      entryId: null,
      filename: 'Evidence.png',
      dataUrl: 'data:image/png;base64,AAAA',
    })
    expect(tauriMock.updateDraft).toHaveBeenCalledWith(
      'draft-inline',
      expect.objectContaining({
        body: expect.stringContaining('qa-scribe-attachment://attachment-1'),
      }),
    )
    expect(tauriMock.updateDraft).toHaveBeenCalledWith(
      'draft-inline',
      expect.objectContaining({
        body: expect.not.stringContaining('data:image/png'),
      }),
    )
  })

  it('keeps a Draft dirty when another edit happens while save is in flight', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        testwareDraftCount: 1,
      }),
    )
    tauriMock.listDrafts.mockResolvedValueOnce([draftFixture({ id: 'draft-race', sessionId: 'session-1', body: '<p>Persisted draft.</p>' })])
    let resolveUpdateDraft: (draft: ReturnType<typeof draftFixture>) => void = () => {}
    tauriMock.updateDraft.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdateDraft = resolve
      }),
    )

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-race']))

    act(() => {
      result.current.updateLocalDraft('draft-race', { body: '<p>First unsaved edit.</p>' })
    })
    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = result.current.handleSaveDraft(result.current.testwareDrafts[0])
    })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledWith('draft-race', expect.objectContaining({ body: '<p>First unsaved edit.</p>' })))

    act(() => {
      result.current.updateLocalDraft('draft-race', { body: '<p>Edit typed while saving.</p>' })
      resolveUpdateDraft(draftFixture({ id: 'draft-race', sessionId: 'session-1', body: '<p>First unsaved edit.</p>' }))
    })
    await act(async () => {
      await savePromise
    })

    expect(result.current.testwareDrafts.find((draft) => draft.id === 'draft-race')?.body).toBe('<p>Edit typed while saving.</p>')

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

    expect(tauriMock.updateDraft).toHaveBeenLastCalledWith('draft-race', expect.objectContaining({ body: '<p>Edit typed while saving.</p>' }))
    expect(result.current.activeSession?.id).toBe('session-2')
  })

  it('deletes a direct Draft image import when the edit is discarded', async () => {
    const original = draftFixture({ id: 'draft-direct-image', body: '<p>Saved draft.</p>' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ testwareDraftCount: 1 }))
    tauriMock.listDrafts.mockResolvedValueOnce([original])
    tauriMock.importClipboardScreenshot.mockResolvedValueOnce({ id: 'attachment-draft-direct', filename: 'draft.png' })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))

    const editorId = 'draft-direct-image-editor'
    const insertImage = vi.fn((attachmentId: string) => {
      result.current.updateLocalDraft(original.id, {
        body: `<p>Edited draft.</p><img data-attachment-id="${attachmentId}" src="qa-scribe-attachment://${attachmentId}" alt="Draft evidence">`,
        bodyJson: null,
        bodyFormat: 'html',
      })
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
        file: new File(['image'], 'draft.png', { type: 'image/png' }),
        insertImage,
      }, { kind: 'draft', id: original.id })
    })
    act(() => result.current.discardLocalDraft(original))

    await waitFor(() => expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-draft-direct'))
    expect(result.current.testwareDrafts[0].body).toBe('<p>Saved draft.</p>')
    expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledWith(expect.objectContaining({ entryId: null }))
    unregister()
  })

  it('preserves a newer direct Draft upload while stale-image cleanup is in flight', async () => {
    const original = draftFixture({ body: '<p>Saved draft.</p>' })
    const staleCleanup = deferred<boolean>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ testwareDraftCount: 1 }))
    tauriMock.listDrafts.mockResolvedValueOnce([original])
    tauriMock.importClipboardScreenshot
      .mockResolvedValueOnce({ id: 'attachment-stale-direct', filename: 'stale.png' })
      .mockResolvedValueOnce({ id: 'attachment-newer-direct', filename: 'newer.png' })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))

    const editorId = 'draft-settlement-race-editor'
    const insertImage = vi.fn((attachmentId: string) => {
      result.current.updateLocalDraft(original.id, {
        body: `<p>Draft edit.</p><img data-attachment-id="${attachmentId}" src="qa-scribe-attachment://${attachmentId}" alt="Evidence">`,
        bodyJson: null,
        bodyFormat: 'html',
      })
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
        file: new File(['stale'], 'stale.png', { type: 'image/png' }),
        insertImage,
      }, { kind: 'draft', id: original.id })
    })
    act(() => result.current.updateLocalDraft(original.id, { body: '<p>Save without image.</p>', bodyJson: null, bodyFormat: 'html' }))
    tauriMock.deleteAttachment.mockReturnValueOnce(staleCleanup.promise)

    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.handleSaveDraft(result.current.testwareDrafts[0]) })
    await waitFor(() => expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-stale-direct'))
    await act(async () => {
      await result.current.uploadEditorImage({
        editorId,
        file: new File(['newer'], 'newer.png', { type: 'image/png' }),
        insertImage,
      }, { kind: 'draft', id: original.id })
    })
    await act(async () => {
      staleCleanup.resolve(true)
      expect(await savePromise).toBe(false)
    })

    expect(result.current.testwareDrafts[0].body).toContain('attachment-newer-direct')
    act(() => result.current.discardLocalDraft(original))
    await waitFor(() => expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-newer-direct'))
    unregister()
  })

  it('deletes a direct Finding image import when the edit is discarded', async () => {
    const original = findingFixture({ id: 'finding-direct-image', body: '<p>Saved finding.</p>' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ findingCount: 1 }))
    tauriMock.listFindings.mockResolvedValueOnce([original])
    tauriMock.importClipboardScreenshot.mockResolvedValueOnce({ id: 'attachment-finding-direct', filename: 'finding.png' })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([original]))

    const editorId = 'finding-direct-image-editor'
    const insertImage = vi.fn((attachmentId: string) => {
      result.current.updateLocalFinding(original.id, {
        body: `<p>Edited finding.</p><img data-attachment-id="${attachmentId}" src="qa-scribe-attachment://${attachmentId}" alt="Finding evidence">`,
        bodyJson: null,
        bodyFormat: 'html',
      })
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
        file: new File(['image'], 'finding.png', { type: 'image/png' }),
        insertImage,
      }, { kind: 'finding', id: original.id })
    })
    act(() => result.current.discardLocalFinding(original))

    await waitFor(() => expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-finding-direct'))
    expect(result.current.findings[0].body).toBe('<p>Saved finding.</p>')
    unregister()
  })

  it('preserves a newer direct Finding upload while stale-image cleanup is in flight', async () => {
    const original = findingFixture({ body: '<p>Saved finding.</p>' })
    const staleCleanup = deferred<boolean>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ findingCount: 1 }))
    tauriMock.listFindings.mockResolvedValueOnce([original])
    tauriMock.importClipboardScreenshot
      .mockResolvedValueOnce({ id: 'attachment-stale-finding-direct', filename: 'stale.png' })
      .mockResolvedValueOnce({ id: 'attachment-newer-finding-direct', filename: 'newer.png' })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([original]))

    const editorId = 'finding-settlement-race-editor'
    const insertImage = vi.fn((attachmentId: string) => {
      result.current.updateLocalFinding(original.id, {
        body: `<p>Finding edit.</p><img data-attachment-id="${attachmentId}" src="qa-scribe-attachment://${attachmentId}" alt="Evidence">`,
        bodyJson: null,
        bodyFormat: 'html',
      })
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
        file: new File(['stale'], 'stale.png', { type: 'image/png' }),
        insertImage,
      }, { kind: 'finding', id: original.id })
    })
    act(() => result.current.updateLocalFinding(original.id, { body: '<p>Save without image.</p>', bodyJson: null, bodyFormat: 'html' }))
    tauriMock.deleteAttachment.mockReturnValueOnce(staleCleanup.promise)

    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.handleSaveFinding(result.current.findings[0]) })
    await waitFor(() => expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-stale-finding-direct'))
    await act(async () => {
      await result.current.uploadEditorImage({
        editorId,
        file: new File(['newer'], 'newer.png', { type: 'image/png' }),
        insertImage,
      }, { kind: 'finding', id: original.id })
    })
    await act(async () => {
      staleCleanup.resolve(true)
      expect(await savePromise).toBe(false)
    })

    expect(result.current.findings[0].body).toContain('attachment-newer-finding-direct')
    act(() => result.current.discardLocalFinding(original))
    await waitFor(() => expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-newer-finding-direct'))
    unregister()
  })
})
