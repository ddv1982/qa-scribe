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
            modelSelection: { kind: 'recorded', requested: { kind: 'default' }, reported: null },
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
      }), expect.objectContaining({ expectedStoredBase: expect.any(String) }))
    expect(tauriMock.updateDraft).toHaveBeenCalledWith(
      'draft-inline',
      expect.objectContaining({
        body: expect.not.stringContaining('data:image/png'),
      }), expect.objectContaining({ expectedStoredBase: expect.any(String) }))
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
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledWith('draft-race', expect.objectContaining({ body: '<p>First unsaved edit.</p>' }), expect.objectContaining({ expectedStoredBase: expect.any(String) })))

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

    expect(tauriMock.updateDraft).toHaveBeenLastCalledWith('draft-race', expect.objectContaining({ body: '<p>Edit typed while saving.</p>' }), expect.objectContaining({ expectedStoredBase: expect.any(String) }))
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
    const insertImage = vi.fn((attachmentId: string | null) => {
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
    const insertImage = vi.fn((attachmentId: string | null) => {
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
    const insertImage = vi.fn((attachmentId: string | null) => {
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
    const insertImage = vi.fn((attachmentId: string | null) => {
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

  it.each(['prepare', 'commit', 'refresh'] as const)('settles Save during %s before continuing navigation', async (stage) => {
    const created = draftFixture({ id: 'durably-created' })
    const preparing = deferred<{ attemptId: string; images: []; outcome: { state: 'preparing' } }>()
    const committing = deferred<import('../tauri').CreationOutcome>()
    const refreshing = deferred<ReturnType<typeof draftFixture>[]>()
    tauriMock.listDrafts.mockResolvedValue([])
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => { await result.current.handleManualTestware() })
    await waitFor(() => expect(result.current.draftLoadState).toBe('ready'))
    expect(tauriMock.prepareCreationSave).not.toHaveBeenCalled()
    act(() => result.current.creation.update({ title: 'Durable result' }))
    if (stage === 'prepare') tauriMock.prepareCreationSave.mockReturnValueOnce(preparing.promise)
    if (stage === 'commit') tauriMock.commitCreationSave.mockReturnValueOnce(committing.promise)
    else tauriMock.commitCreationSave.mockResolvedValueOnce({ state: 'committed', record: { kind: 'testware', record: created } })
    if (stage === 'refresh') tauriMock.listDrafts.mockReturnValueOnce(refreshing.promise)
    else tauriMock.listDrafts.mockResolvedValue([created])
    let saved!: Promise<boolean>
    act(() => { saved = result.current.creation.save() })
    await waitFor(() => expect(stage === 'prepare' ? tauriMock.prepareCreationSave : tauriMock.commitCreationSave).toHaveBeenCalledOnce())
    act(() => result.current.setActiveView('sessions'))
    expect(result.current.activeView).toBe('testware')
    await act(async () => {
      const request = tauriMock.prepareCreationSave.mock.calls[0][0] as { attemptId: string }
      preparing.resolve({ attemptId: request.attemptId, images: [], outcome: { state: 'preparing' } })
      committing.resolve({ state: 'committed', record: { kind: 'testware', record: created } })
      refreshing.resolve([created])
    })
    await waitFor(() => expect(result.current.createdRecordEditTarget?.recordId).toBe(created.id))
    await act(async () => { result.current.consumeCreatedRecordEditTarget(result.current.createdRecordEditTarget!); expect(await saved).toBe(true) })
    await waitFor(() => expect(result.current.activeView).toBe('sessions'))
    expect(result.current.creationIntent).toBeNull()
    expect(tauriMock.commitCreationSave).toHaveBeenCalledOnce()
    expect(tauriMock.deleteDraft).not.toHaveBeenCalled()
  })

  it.each(['draft', 'finding'] as const)('rejects obsolete Session navigation around a delayed %s Save', async (kind) => {
    const created = kind === 'draft' ? draftFixture({ id: 'late-created' }) : findingFixture({ id: 'late-created' })
    const committing = deferred<import('../tauri').CreationOutcome>()
    const list = kind === 'draft' ? tauriMock.listDrafts : tauriMock.listFindings
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => { await (kind === 'draft' ? result.current.handleManualTestware() : result.current.handleManualFinding()) })
    act(() => result.current.creation.update({ title: 'Captured A' }))
    tauriMock.commitCreationSave.mockReturnValueOnce(committing.promise)
    list.mockResolvedValue([created])
    let saved!: Promise<boolean>
    act(() => { saved = result.current.creation.save() })
    await waitFor(() => expect(tauriMock.commitCreationSave).toHaveBeenCalledOnce())
    let navigate!: Promise<void>
    act(() => { navigate = result.current.openSession(sessionFixture({ id: 'session-2' })) })
    await act(async () => { await result.current.openSession(sessionFixture()) })
    await act(async () => { committing.resolve({ state: 'committed', record: kind === 'draft' ? { kind: 'testware', record: created as ReturnType<typeof draftFixture> } : { kind: 'finding', record: created as ReturnType<typeof findingFixture> } }) })
    await waitFor(() => expect(result.current.createdRecordEditTarget?.recordId).toBe(created.id))
    await act(async () => { result.current.consumeCreatedRecordEditTarget(result.current.createdRecordEditTarget!); await saved; await navigate })
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
    expect(tauriMock.deleteDraft).not.toHaveBeenCalled()
    expect(tauriMock.deleteFinding).not.toHaveBeenCalled()
  })

  it.each([['draft', false], ['finding', false], ['draft', true], ['finding', true]] as const)(
    'loads a saved %s without overwriting existing dirty=%s content', async (kind, dirty) => {
      const original = kind === 'draft' ? draftFixture({ id: 'existing', body: '<p>Saved original</p>' }) : findingFixture({ id: 'existing', body: '<p>Saved original</p>' })
      const created = kind === 'draft' ? draftFixture({ id: 'new-result' }) : findingFixture({ id: 'new-result' })
      const list = kind === 'draft' ? tauriMock.listDrafts : tauriMock.listFindings
      list.mockResolvedValue([original])
      const { result } = renderHook(() => useAppController())
      await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
      await act(async () => { await (kind === 'draft' ? result.current.handleManualTestware() : result.current.handleManualFinding()) })
      await waitFor(() => expect((kind === 'draft' ? result.current.testwareDrafts : result.current.findings).length).toBe(1))
      if (dirty) act(() => {
        if (kind === 'draft') result.current.updateLocalDraft(original.id, { body: '<p>Local edit</p>' })
        else result.current.updateLocalFinding(original.id, { body: '<p>Local edit</p>' })
      })
      act(() => result.current.creation.update({ title: 'New result' }))
      list.mockResolvedValue([original, created])
      tauriMock.commitCreationSave.mockResolvedValueOnce({ state: 'committed', record: { kind: kind === 'draft' ? 'testware' : 'finding', record: created } })
      let saved!: Promise<boolean>
      act(() => { saved = result.current.creation.save() })
      await waitFor(() => expect(result.current.createdRecordEditTarget?.recordId).toBe('new-result'))
      await act(async () => { result.current.consumeCreatedRecordEditTarget(result.current.createdRecordEditTarget!); expect(await saved).toBe(true) })
      const records = kind === 'draft' ? result.current.testwareDrafts : result.current.findings
      expect(records.find((record) => record.id === original.id)?.body).toBe(dirty ? '<p>Local edit</p>' : '<p>Saved original</p>')
      expect(records.map((record) => record.id)).toEqual(expect.arrayContaining(['existing', 'new-result']))
      expect(tauriMock.commitCreationSave).toHaveBeenCalledOnce()
    },
  )
})
