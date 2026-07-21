import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'
import { draftFixture, entryFixture, findingFixture, generationStatusFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import { registerRichEditor } from '../editor/richEditorRegistry'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController workflows and record hydration', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('finalizes Draft deletion before failed attachment cleanup settles', async () => {
    const original = draftFixture({ id: 'draft-delete-cleanup', body: '<p>Saved draft.</p>' })
    const cleanup = deferred<boolean>()
    const staleLoad = deferred<ReturnType<typeof draftFixture>[]>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ testwareDraftCount: 1 }))
    tauriMock.listDrafts
      .mockResolvedValueOnce([original])
      .mockReturnValueOnce(staleLoad.promise)
      .mockRejectedValueOnce(new Error('Draft refresh unavailable'))
    tauriMock.importClipboardScreenshot.mockResolvedValueOnce({ id: 'attachment-draft-delete', filename: 'draft.png' })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))

    const editorId = 'draft-delete-cleanup-editor'
    const insertImage = vi.fn((attachmentId: string) => {
      result.current.updateLocalDraft(original.id, {
        body: `<p>Edited draft.</p><img data-attachment-id="${attachmentId}" src="qa-scribe-attachment://${attachmentId}" alt="Evidence">`,
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
    let staleLoadPromise!: Promise<ReturnType<typeof draftFixture>[]>
    act(() => { staleLoadPromise = result.current.loadDraftsForSession('session-1', { force: true }) })
    await waitFor(() => expect(tauriMock.listDrafts).toHaveBeenCalledTimes(2))
    tauriMock.deleteAttachment.mockReturnValueOnce(cleanup.promise)
    act(() => result.current.requestDeleteDraft(result.current.testwareDrafts[0]))
    let deletePromise!: Promise<void>
    act(() => { deletePromise = result.current.confirmDelete() })
    await waitFor(() => expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-draft-delete'))

    expect(result.current.testwareDraftCount).toBe(0)
    await act(async () => {
      staleLoad.resolve([original])
      await staleLoadPromise
    })
    expect(result.current.testwareDrafts).toEqual([])
    expect(result.current.testwareDraftCount).toBe(0)
    await act(async () => { expect(await result.current.saveDirtyRecordsNow()).toBe(true) })
    expect(tauriMock.updateDraft).not.toHaveBeenCalled()
    await act(async () => {
      cleanup.resolve(false)
      await deletePromise
    })

    expect(result.current.testwareDrafts).toEqual([])
    expect(result.current.notice).toContain('image cleanup will retry')
    expect(result.current.error).toContain('Draft refresh unavailable')
    unregister()
  })

  it('finalizes Finding deletion before failed attachment cleanup settles', async () => {
    const original = findingFixture({ id: 'finding-delete-cleanup', body: '<p>Saved finding.</p>' })
    const cleanup = deferred<boolean>()
    const staleLoad = deferred<ReturnType<typeof findingFixture>[]>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ findingCount: 1 }))
    tauriMock.listFindings
      .mockResolvedValueOnce([original])
      .mockReturnValueOnce(staleLoad.promise)
      .mockRejectedValueOnce(new Error('Finding refresh unavailable'))
    tauriMock.importClipboardScreenshot.mockResolvedValueOnce({ id: 'attachment-finding-delete', filename: 'finding.png' })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([original]))

    const editorId = 'finding-delete-cleanup-editor'
    const insertImage = vi.fn((attachmentId: string) => {
      result.current.updateLocalFinding(original.id, {
        body: `<p>Edited finding.</p><img data-attachment-id="${attachmentId}" src="qa-scribe-attachment://${attachmentId}" alt="Evidence">`,
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
    let staleLoadPromise!: Promise<ReturnType<typeof findingFixture>[]>
    act(() => { staleLoadPromise = result.current.loadFindingsForSession('session-1', { force: true }) })
    await waitFor(() => expect(tauriMock.listFindings).toHaveBeenCalledTimes(2))
    tauriMock.deleteAttachment.mockReturnValueOnce(cleanup.promise)
    act(() => result.current.requestDeleteFinding(result.current.findings[0]))
    let deletePromise!: Promise<void>
    act(() => { deletePromise = result.current.confirmDelete() })
    await waitFor(() => expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-finding-delete'))

    expect(result.current.findingCount).toBe(0)
    await act(async () => {
      staleLoad.resolve([original])
      await staleLoadPromise
    })
    expect(result.current.findings).toEqual([])
    expect(result.current.findingCount).toBe(0)
    await act(async () => { expect(await result.current.saveDirtyRecordsNow()).toBe(true) })
    expect(tauriMock.updateFinding).not.toHaveBeenCalled()
    await act(async () => {
      cleanup.resolve(false)
      await deletePromise
    })

    expect(result.current.findings).toEqual([])
    expect(result.current.notice).toContain('image cleanup will retry')
    expect(result.current.error).toContain('Finding refresh unavailable')
    unregister()
  })

  it('does not resurrect a deleted Draft when generated canonicalization settles late', async () => {
    const canonicalization = deferred<ReturnType<typeof draftFixture>>()
    const generated = draftFixture({ id: 'draft-delete-canonicalization', body: '<p>Generated Draft.</p>' })
    tauriMock.updateDraft.mockReturnValueOnce(canonicalization.promise)
    tauriMock.listDrafts.mockResolvedValueOnce([])
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent(completedRecordGenerationEvent({ draft: generated }))
      return { jobId: 'job-draft-delete', status: generationStatusFixture({ jobId: 'job-draft-delete', action: 'testware', state: 'completed' }) }
    })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => { await result.current.handleAiAction('testware') })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual([generated.id]))

    act(() => result.current.requestDeleteDraft(result.current.testwareDrafts[0]))
    await act(async () => { await result.current.confirmDelete() })
    expect(result.current.testwareDrafts).toEqual([])

    await act(async () => {
      canonicalization.resolve(generated)
      await canonicalization.promise
    })

    expect(result.current.testwareDrafts).toEqual([])
    expect(tauriMock.updateDraft).toHaveBeenCalledTimes(1)
  })

  it('does not resurrect a deleted Finding when generated canonicalization settles late', async () => {
    const canonicalization = deferred<ReturnType<typeof findingFixture>>()
    const generated = findingFixture({ id: 'finding-delete-canonicalization', body: '<p>Generated Finding.</p>' })
    tauriMock.updateFinding.mockReturnValueOnce(canonicalization.promise)
    tauriMock.listFindings.mockResolvedValueOnce([])
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent(completedRecordGenerationEvent({ finding: generated }))
      return { jobId: 'job-finding-delete', status: generationStatusFixture({ jobId: 'job-finding-delete', action: 'finding', state: 'completed' }) }
    })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => { await result.current.handleAiAction('finding') })
    await waitFor(() => expect(result.current.findings.map((finding) => finding.id)).toEqual([generated.id]))

    act(() => result.current.requestDeleteFinding(result.current.findings[0]))
    await act(async () => { await result.current.confirmDelete() })
    expect(result.current.findings).toEqual([])

    await act(async () => {
      canonicalization.resolve(generated)
      await canonicalization.promise
    })

    expect(result.current.findings).toEqual([])
    expect(tauriMock.updateFinding).toHaveBeenCalledTimes(1)
  })

  it('rolls back a failed Draft delete intent so the Record can be saved and deleted again', async () => {
    const original = draftFixture({ body: '<p>Original Draft.</p>' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ testwareDraftCount: 1 }))
    tauriMock.listDrafts.mockResolvedValueOnce([original]).mockResolvedValueOnce([])
    tauriMock.deleteDraft.mockRejectedValueOnce(new Error('Draft delete failed')).mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))

    act(() => result.current.requestDeleteDraft(original))
    await act(async () => { await result.current.confirmDelete() })
    expect(result.current.testwareDrafts).toEqual([original])
    expect(result.current.testwareDraftCount).toBe(1)

    act(() => result.current.updateLocalDraft(original.id, { body: '<p>Saved after failed delete.</p>' }))
    await act(async () => { expect(await result.current.handleSaveDraft(result.current.testwareDrafts[0])).toBe(true) })
    act(() => result.current.requestDeleteDraft(result.current.testwareDrafts[0]))
    await act(async () => { await result.current.confirmDelete() })

    expect(tauriMock.deleteDraft).toHaveBeenCalledTimes(2)
    expect(tauriMock.updateDraft).toHaveBeenCalledWith(original.id, expect.objectContaining({ body: '<p>Saved after failed delete.</p>' }))
    expect(result.current.testwareDrafts).toEqual([])
    expect(result.current.testwareDraftCount).toBe(0)
  })

  it('rolls back a failed Finding delete intent so the Record can be saved and deleted again', async () => {
    const original = findingFixture({ body: '<p>Original Finding.</p>' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ findingCount: 1 }))
    tauriMock.listFindings.mockResolvedValueOnce([original]).mockResolvedValueOnce([])
    tauriMock.deleteFinding.mockRejectedValueOnce(new Error('Finding delete failed')).mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([original]))

    act(() => result.current.requestDeleteFinding(original))
    await act(async () => { await result.current.confirmDelete() })
    expect(result.current.findings).toEqual([original])
    expect(result.current.findingCount).toBe(1)

    act(() => result.current.updateLocalFinding(original.id, { body: '<p>Saved after failed delete.</p>' }))
    await act(async () => { expect(await result.current.handleSaveFinding(result.current.findings[0])).toBe(true) })
    act(() => result.current.requestDeleteFinding(result.current.findings[0]))
    await act(async () => { await result.current.confirmDelete() })

    expect(tauriMock.deleteFinding).toHaveBeenCalledTimes(2)
    expect(tauriMock.updateFinding).toHaveBeenCalledWith(original.id, expect.objectContaining({ body: '<p>Saved after failed delete.</p>' }))
    expect(result.current.findings).toEqual([])
    expect(result.current.findingCount).toBe(0)
  })

  it('does not resurrect a deleted Draft when an older manual save settles late', async () => {
    const original = draftFixture({ body: '<p>Original Draft.</p>' })
    const lateSave = deferred<ReturnType<typeof draftFixture>>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ testwareDraftCount: 1 }))
    tauriMock.listDrafts.mockResolvedValueOnce([original]).mockResolvedValueOnce([])
    tauriMock.updateDraft.mockReturnValueOnce(lateSave.promise)

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))
    act(() => result.current.updateLocalDraft(original.id, { body: '<p>Late Draft save.</p>' }))

    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.handleSaveDraft(result.current.testwareDrafts[0]) })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledTimes(1))
    act(() => result.current.requestDeleteDraft(result.current.testwareDrafts[0]))
    await act(async () => { await result.current.confirmDelete() })

    await act(async () => {
      lateSave.resolve(draftFixture({ body: '<p>Late Draft save.</p>' }))
      expect(await savePromise).toBe(false)
    })

    expect(result.current.testwareDrafts).toEqual([])
    expect(result.current.testwareDraftCount).toBe(0)
    expect(tauriMock.updateDraft).toHaveBeenCalledTimes(1)
  })

  it('does not resurrect a deleted Finding when an older manual save settles late', async () => {
    const original = findingFixture({ body: '<p>Original Finding.</p>' })
    const lateSave = deferred<ReturnType<typeof findingFixture>>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ findingCount: 1 }))
    tauriMock.listFindings.mockResolvedValueOnce([original]).mockResolvedValueOnce([])
    tauriMock.updateFinding.mockReturnValueOnce(lateSave.promise)

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([original]))
    act(() => result.current.updateLocalFinding(original.id, { body: '<p>Late Finding save.</p>' }))

    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.handleSaveFinding(result.current.findings[0]) })
    await waitFor(() => expect(tauriMock.updateFinding).toHaveBeenCalledTimes(1))
    act(() => result.current.requestDeleteFinding(result.current.findings[0]))
    await act(async () => { await result.current.confirmDelete() })

    await act(async () => {
      lateSave.resolve(findingFixture({ body: '<p>Late Finding save.</p>' }))
      expect(await savePromise).toBe(false)
    })

    expect(result.current.findings).toEqual([])
    expect(result.current.findingCount).toBe(0)
    expect(tauriMock.updateFinding).toHaveBeenCalledTimes(1)
  })

  it('keeps an unrelated Finding load live while deleting a Draft', async () => {
    const pendingFindings = deferred<ReturnType<typeof findingFixture>[]>()
    tauriMock.listFindings.mockReturnValueOnce(pendingFindings.promise)
    tauriMock.listDrafts.mockResolvedValueOnce([])

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    let loadPromise!: Promise<ReturnType<typeof findingFixture>[]>
    act(() => { loadPromise = result.current.loadFindingsForSession('session-1', { force: true }) })
    await waitFor(() => expect(result.current.findingLoadState).toBe('loading'))

    act(() => result.current.requestDeleteDraft(draftFixture()))
    await act(async () => { await result.current.confirmDelete() })
    await act(async () => {
      pendingFindings.resolve([])
      await loadPromise
    })

    expect(result.current.findingLoadState).toBe('ready')
  })

  it('keeps an unrelated Draft load live while deleting a Finding', async () => {
    const pendingDrafts = deferred<ReturnType<typeof draftFixture>[]>()
    tauriMock.listDrafts.mockReturnValueOnce(pendingDrafts.promise)
    tauriMock.listFindings.mockResolvedValueOnce([])

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    let loadPromise!: Promise<ReturnType<typeof draftFixture>[]>
    act(() => { loadPromise = result.current.loadDraftsForSession('session-1', { force: true }) })
    await waitFor(() => expect(result.current.draftLoadState).toBe('loading'))

    act(() => result.current.requestDeleteFinding(findingFixture()))
    await act(async () => { await result.current.confirmDelete() })
    await act(async () => {
      pendingDrafts.resolve([])
      await loadPromise
    })

    expect(result.current.draftLoadState).toBe('ready')
  })

  it('lets the current Draft load finish when New Session creation fails', async () => {
    const pendingDrafts = deferred<ReturnType<typeof draftFixture>[]>()
    const restoredDraft = draftFixture({ id: 'draft-after-create-failure' })
    tauriMock.listDrafts.mockReturnValueOnce(pendingDrafts.promise).mockResolvedValueOnce([restoredDraft])
    tauriMock.createSession.mockRejectedValueOnce(new Error('Session creation failed'))

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.draftLoadState).toBe('loading'))

    await act(async () => { await result.current.handleNewSession() })
    await act(async () => {
      pendingDrafts.resolve([draftFixture({ id: 'stale-draft' })])
      await pendingDrafts.promise
    })

    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.draftLoadState).toBe('ready')
    expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual([restoredDraft.id])
  })

  it('lets the current Finding load finish when Session opening is superseded', async () => {
    const pendingFindings = deferred<ReturnType<typeof findingFixture>[]>()
    const pendingOpen = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other Session' })
    const restoredFinding = findingFixture({ id: 'finding-after-open-superseded' })
    tauriMock.listFindings.mockReturnValueOnce(pendingFindings.promise).mockResolvedValueOnce([restoredFinding])

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findingLoadState).toBe('loading'))

    tauriMock.openSessionNoteState.mockReturnValueOnce(pendingOpen.promise)
    let openPromise!: Promise<void>
    act(() => { openPromise = result.current.openSession(otherSession) })
    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-2'))
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Superseding edit')))
    await act(async () => {
      pendingOpen.resolve(sessionNoteStateFixture({
        session: otherSession,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: otherSession.id }),
      }))
      await openPromise
      pendingFindings.resolve([findingFixture({ id: 'stale-finding' })])
      await pendingFindings.promise
    })

    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.findingLoadState).toBe('ready')
    expect(result.current.findings.map((finding) => finding.id)).toEqual([restoredFinding.id])
  })
})

function completedRecordGenerationEvent({
  draft = null,
  finding = null,
}: {
  draft?: ReturnType<typeof draftFixture> | null
  finding?: ReturnType<typeof findingFixture> | null
}) {
  const action: 'testware' | 'finding' = draft ? 'testware' : 'finding'
  return {
    type: 'completed',
    job_id: `job-${action}-race`,
    status: generationStatusFixture({ jobId: `job-${action}-race`, action, state: 'completed' }),
    result: {
      generationContext: { id: `context-${action}-race`, sessionId: 'session-1', createdAt: '2026-06-24T10:00:00.000Z' },
      aiRun: {
        id: `run-${action}-race`, sessionId: 'session-1', generationContextId: `context-${action}-race`,
        provider: 'codex_cli', model: 'default', reasoningEffort: null, promptVersion: `${action}-v1`,
        status: 'completed', errorMessage: null, createdAt: '2026-06-24T10:00:00.000Z', completedAt: '2026-06-24T10:00:00.000Z',
      },
      draft,
      finding,
      noteEntry: null,
    },
  }
}
