import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { draftFixture, entryFixture, findingFixture, generationStatusFixture } from '../test/fixtures'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController workflows and record hydration', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('restores the saved Draft after a single-record discard supersedes an in-flight save', async () => {
    const original = draftFixture({ body: '<p>Saved draft.</p>' })
    const pendingUpdate = deferred<ReturnType<typeof draftFixture>>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ testwareDraftCount: 1 }))
    tauriMock.listDrafts.mockResolvedValueOnce([original])
    tauriMock.updateDraft.mockReturnValueOnce(pendingUpdate.promise)

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))

    act(() => result.current.updateLocalDraft(original.id, { body: '<p>Discarded draft edit.</p>' }))
    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = result.current.handleSaveDraft(result.current.testwareDrafts[0])
    })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledWith(original.id, expect.objectContaining({ body: '<p>Discarded draft edit.</p>' })))

    act(() => {
      result.current.discardLocalDraft(original)
      result.current.updateLocalDraft(original.id, { body: '<p>Newer dirty draft edit.</p>' })
      pendingUpdate.resolve(draftFixture({ body: '<p>Discarded draft edit.</p>' }))
    })
    await act(async () => savePromise)

    expect(tauriMock.updateDraft).toHaveBeenCalledTimes(2)
    expect(tauriMock.updateDraft).toHaveBeenLastCalledWith(original.id, expect.objectContaining({ body: '<p>Saved draft.</p>' }))
    expect(result.current.testwareDrafts[0].body).toBe('<p>Newer dirty draft edit.</p>')
    act(() => result.current.discardAllDirtyRecords())
    expect(result.current.testwareDrafts[0].body).toBe('<p>Saved draft.</p>')
  })

  it('restores the saved Finding after a single-record discard supersedes an in-flight save', async () => {
    const original = findingFixture({ body: '<p>Saved finding.</p>' })
    const pendingUpdate = deferred<ReturnType<typeof findingFixture>>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ findingCount: 1 }))
    tauriMock.listFindings.mockResolvedValueOnce([original])
    tauriMock.updateFinding.mockReturnValueOnce(pendingUpdate.promise)

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([original]))

    act(() => result.current.updateLocalFinding(original.id, { body: '<p>Discarded finding edit.</p>' }))
    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = result.current.handleSaveFinding(result.current.findings[0])
    })
    await waitFor(() => expect(tauriMock.updateFinding).toHaveBeenCalledWith(original.id, expect.objectContaining({ body: '<p>Discarded finding edit.</p>' })))

    act(() => {
      result.current.discardLocalFinding(original)
      result.current.updateLocalFinding(original.id, { body: '<p>Newer dirty finding edit.</p>' })
      pendingUpdate.resolve(findingFixture({ body: '<p>Discarded finding edit.</p>' }))
    })
    await act(async () => savePromise)

    expect(tauriMock.updateFinding).toHaveBeenCalledTimes(2)
    expect(tauriMock.updateFinding).toHaveBeenLastCalledWith(original.id, expect.objectContaining({ body: '<p>Saved finding.</p>' }))
    expect(result.current.findings[0].body).toBe('<p>Newer dirty finding edit.</p>')
    act(() => result.current.discardAllDirtyRecords())
    expect(result.current.findings[0].body).toBe('<p>Saved finding.</p>')
  })

  it('retains Draft restoration when the save after discard fails', async () => {
    const original = draftFixture({ body: '<p>Saved draft.</p>' })
    const olderUpdate = deferred<ReturnType<typeof draftFixture>>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ testwareDraftCount: 1 }))
    tauriMock.listDrafts.mockResolvedValueOnce([original])
    tauriMock.updateDraft
      .mockReturnValueOnce(olderUpdate.promise)
      .mockRejectedValueOnce(new Error('newer save failed'))
      .mockRejectedValueOnce(new Error('restore failed'))

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))

    act(() => result.current.updateLocalDraft(original.id, { body: '<p>Discarded draft edit.</p>' }))
    let olderSave!: Promise<boolean>
    act(() => { olderSave = result.current.handleSaveDraft(result.current.testwareDrafts[0]) })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.discardLocalDraft(original)
      result.current.updateLocalDraft(original.id, { body: '<p>Newer draft edit.</p>' })
    })
    let newerSave!: Promise<boolean>
    act(() => { newerSave = result.current.handleSaveDraft(result.current.testwareDrafts[0]) })
    await act(async () => { await newerSave })
    expect(result.current.testwareDrafts[0].body).toBe('<p>Newer draft edit.</p>')
    act(() => result.current.discardLocalDraft(original))
    expect(result.current.testwareDrafts[0].body).toBe('<p>Saved draft.</p>')
    act(() => olderUpdate.resolve(draftFixture({ body: '<p>Discarded draft edit.</p>' })))
    await act(async () => { await olderSave })

    expect(tauriMock.updateDraft.mock.calls.slice(2)).toEqual(expect.arrayContaining([
      [original.id, expect.objectContaining({ body: '<p>Saved draft.</p>' })],
    ]))
    expect(result.current.testwareDrafts[0].body).toBe('<p>Saved draft.</p>')
  })

  it('retains Finding restoration when the save after discard fails', async () => {
    const original = findingFixture({ body: '<p>Saved finding.</p>' })
    const olderUpdate = deferred<ReturnType<typeof findingFixture>>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ findingCount: 1 }))
    tauriMock.listFindings.mockResolvedValueOnce([original])
    tauriMock.updateFinding
      .mockReturnValueOnce(olderUpdate.promise)
      .mockRejectedValueOnce(new Error('newer save failed'))
      .mockRejectedValueOnce(new Error('restore failed'))

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([original]))

    act(() => result.current.updateLocalFinding(original.id, { body: '<p>Discarded finding edit.</p>' }))
    let olderSave!: Promise<boolean>
    act(() => { olderSave = result.current.handleSaveFinding(result.current.findings[0]) })
    await waitFor(() => expect(tauriMock.updateFinding).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.discardLocalFinding(original)
      result.current.updateLocalFinding(original.id, { body: '<p>Newer finding edit.</p>' })
    })
    let newerSave!: Promise<boolean>
    act(() => { newerSave = result.current.handleSaveFinding(result.current.findings[0]) })
    await act(async () => { await newerSave })
    expect(result.current.findings[0].body).toBe('<p>Newer finding edit.</p>')
    act(() => result.current.discardLocalFinding(original))
    expect(result.current.findings[0].body).toBe('<p>Saved finding.</p>')
    act(() => olderUpdate.resolve(findingFixture({ body: '<p>Discarded finding edit.</p>' })))
    await act(async () => { await olderSave })

    expect(tauriMock.updateFinding.mock.calls.slice(2)).toEqual(expect.arrayContaining([
      [original.id, expect.objectContaining({ body: '<p>Saved finding.</p>' })],
    ]))
    expect(result.current.findings[0].body).toBe('<p>Saved finding.</p>')
  })

  it('restores the saved Draft after discard-all supersedes an in-flight save', async () => {
    const original = draftFixture({ body: '<p>Saved draft.</p>' })
    const pendingUpdate = deferred<ReturnType<typeof draftFixture>>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ testwareDraftCount: 1 }))
    tauriMock.listDrafts.mockResolvedValueOnce([original])
    tauriMock.updateDraft.mockReturnValueOnce(pendingUpdate.promise)

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))

    act(() => result.current.updateLocalDraft(original.id, { body: '<p>Discarded draft edit.</p>' }))
    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = result.current.handleSaveDraft(result.current.testwareDrafts[0])
    })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.discardAllDirtyRecords()
      pendingUpdate.resolve(draftFixture({ body: '<p>Discarded draft edit.</p>' }))
    })
    await act(async () => savePromise)

    expect(tauriMock.updateDraft).toHaveBeenCalledTimes(2)
    expect(tauriMock.updateDraft).toHaveBeenLastCalledWith(original.id, expect.objectContaining({ body: '<p>Saved draft.</p>' }))
    expect(result.current.testwareDrafts[0].body).toBe('<p>Saved draft.</p>')
  })

  it('restores the saved Finding after discard-all supersedes an in-flight save', async () => {
    const original = findingFixture({ body: '<p>Saved finding.</p>' })
    const pendingUpdate = deferred<ReturnType<typeof findingFixture>>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ findingCount: 1 }))
    tauriMock.listFindings.mockResolvedValueOnce([original])
    tauriMock.updateFinding.mockReturnValueOnce(pendingUpdate.promise)

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([original]))

    act(() => result.current.updateLocalFinding(original.id, { body: '<p>Discarded finding edit.</p>' }))
    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = result.current.handleSaveFinding(result.current.findings[0])
    })
    await waitFor(() => expect(tauriMock.updateFinding).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.discardAllDirtyRecords()
      pendingUpdate.resolve(findingFixture({ body: '<p>Discarded finding edit.</p>' }))
    })
    await act(async () => savePromise)

    expect(tauriMock.updateFinding).toHaveBeenCalledTimes(2)
    expect(tauriMock.updateFinding).toHaveBeenLastCalledWith(original.id, expect.objectContaining({ body: '<p>Saved finding.</p>' }))
    expect(result.current.findings[0].body).toBe('<p>Saved finding.</p>')
  })

  it('does not dispatch a stale Draft save when discard wins during image materialization', async () => {
    const original = draftFixture({ body: '<p>Saved draft.</p>' })
    const pendingImport = deferred<{ id: string; filename: string }>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ testwareDraftCount: 1 }))
    tauriMock.listDrafts.mockResolvedValueOnce([original])
    tauriMock.importClipboardScreenshot.mockReturnValueOnce(pendingImport.promise)

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))

    act(() => result.current.updateLocalDraft(original.id, { body: '<p><img src="data:image/png;base64,AAAA" alt="Evidence" /></p>' }))
    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = result.current.handleSaveDraft(result.current.testwareDrafts[0])
    })
    await waitFor(() => expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.discardLocalDraft(original)
      pendingImport.resolve({ id: 'attachment-stale-draft', filename: 'Evidence.png' })
    })
    await act(async () => savePromise)

    expect(tauriMock.updateDraft).not.toHaveBeenCalled()
    expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-stale-draft')
    expect(result.current.testwareDrafts[0].body).toBe('<p>Saved draft.</p>')
  })

  it('does not dispatch a stale Finding save when discard-all wins during image materialization', async () => {
    const original = findingFixture({ body: '<p>Saved finding.</p>' })
    const pendingImport = deferred<{ id: string; filename: string }>()
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ findingCount: 1 }))
    tauriMock.listFindings.mockResolvedValueOnce([original])
    tauriMock.importClipboardScreenshot.mockReturnValueOnce(pendingImport.promise)

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([original]))

    act(() => result.current.updateLocalFinding(original.id, { body: '<p><img src="data:image/png;base64,BBBB" alt="Evidence" /></p>' }))
    let savePromise!: Promise<boolean>
    act(() => {
      savePromise = result.current.handleSaveFinding(result.current.findings[0])
    })
    await waitFor(() => expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1))

    act(() => {
      result.current.discardAllDirtyRecords()
      pendingImport.resolve({ id: 'attachment-stale-finding', filename: 'Evidence.png' })
    })
    await act(async () => savePromise)

    expect(tauriMock.updateFinding).not.toHaveBeenCalled()
    expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-stale-finding')
    expect(result.current.findings[0].body).toBe('<p>Saved finding.</p>')
  })

  it('keeps an imported image retained by a newer Draft edit after the older write resolves', async () => {
    const original = draftFixture({ id: 'draft-retained', body: '<p>Saved draft.</p>' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ testwareDraftCount: 1 }))
    tauriMock.listDrafts.mockResolvedValueOnce([original])
    tauriMock.importClipboardScreenshot.mockResolvedValueOnce({ id: 'attachment-retained', filename: 'retained.png' })
    const olderWrite = deferred<ReturnType<typeof draftFixture>>()
    tauriMock.updateDraft.mockReturnValueOnce(olderWrite.promise)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))
    act(() => result.current.updateLocalDraft(original.id, {
      body: '<p>Older Draft</p><img src="data:image/png;base64,AAAA" alt="retained">',
    }))

    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.handleSaveDraft(result.current.testwareDrafts[0]) })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledTimes(1))
    act(() => result.current.updateLocalDraft(original.id, {
      body: '<p>Newer Draft</p><img data-attachment-id="attachment-retained" src="qa-scribe-attachment://attachment-retained" alt="retained">',
    }))
    await act(async () => {
      olderWrite.resolve(draftFixture({
        id: original.id,
        body: '<p>Older Draft</p><img data-attachment-id="attachment-retained" src="qa-scribe-attachment://attachment-retained" alt="retained">',
      }))
      await savePromise
    })

    expect(tauriMock.deleteAttachment).not.toHaveBeenCalledWith('attachment-retained')
    expect(result.current.testwareDrafts[0].body).toContain('attachment-retained')
  })

  it('compensates a late generation image write after a newer undo succeeds', async () => {
    const originalBody = '<p>Original Note.</p><p><img data-attachment-id="attachment-1" src="qa-scribe-attachment://attachment-1" alt="Evidence"></p>'
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({
      noteEntry: entryFixture({ body: originalBody }),
    }))
    const lateImageWrite = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry.mockReturnValueOnce(lateImageWrite.promise)
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent({
        type: 'completed',
        job_id: 'job-summary-race',
        status: generationStatusFixture({ jobId: 'job-summary-race', action: 'summary', state: 'completed' }),
        result: {
          generationContext: { id: 'context-summary-race', sessionId: 'session-1', createdAt: '2026-06-24T10:00:00.000Z' },
          aiRun: {
            id: 'run-summary-race', sessionId: 'session-1', generationContextId: 'context-summary-race',
            provider: 'codex_cli', model: 'default', reasoningEffort: null, promptVersion: 'summary-v1',
            status: 'completed', errorMessage: null, createdAt: '2026-06-24T10:00:00.000Z', completedAt: '2026-06-24T10:00:00.000Z',
          },
          draft: null,
          finding: null,
          noteEntry: entryFixture({ body: '<p>Generated Summary.</p>' }),
        },
      })
      return { jobId: 'job-summary-race', status: generationStatusFixture({ jobId: 'job-summary-race', action: 'summary', state: 'completed' }) }
    })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => { await result.current.handleAiAction('summary') })
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1))

    await act(async () => { await result.current.handleUndoLatestNoteGeneration() })
    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(2)

    await act(async () => {
      lateImageWrite.resolve(entryFixture({ body: '<p>Generated Summary.</p><p><img data-attachment-id="attachment-1" src="qa-scribe-attachment://attachment-1"></p>' }))
      await lateImageWrite.promise
    })
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledTimes(3))
    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith('entry-1', expect.objectContaining({
      body: expect.stringContaining('Original Note.'),
    }))
    expect(result.current.sessionSaveState).toBe('saved')
  })

  it('preserves a newer dirty Draft when generated canonicalization fails', async () => {
    const generated = draftFixture({ id: 'draft-canonical-failure', body: '<p>Generated Draft.</p>' })
    let rejectCanonicalization!: (cause?: unknown) => void
    tauriMock.updateDraft.mockReturnValueOnce(new Promise((_resolve, reject) => {
      rejectCanonicalization = reject
    }))
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent(completedRecordGenerationEvent({ draft: generated }))
      return { jobId: 'job-draft-canonical-failure', status: generationStatusFixture({ jobId: 'job-draft-canonical-failure', action: 'testware', state: 'completed' }) }
    })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => { await result.current.handleAiAction('testware') })
    act(() => result.current.updateLocalDraft(generated.id, { body: '<p>Newer dirty Draft.</p>' }))
    act(() => rejectCanonicalization(new Error('canonicalization failed')))

    await waitFor(() => expect(result.current.error).toContain('canonicalization failed'))
    expect(result.current.testwareDrafts[0].body).toBe('<p>Newer dirty Draft.</p>')
  })

  it('compensates late generated Draft canonicalization to a newer successful save', async () => {
    const canonicalization = deferred<ReturnType<typeof draftFixture>>()
    const generated = draftFixture({ id: 'draft-canonical-race', body: '<p>Generated Draft.</p>' })
    const newer = draftFixture({ id: generated.id, body: '<p>Newer saved Draft.</p>' })
    tauriMock.updateDraft
      .mockReturnValueOnce(canonicalization.promise)
      .mockResolvedValueOnce(newer)
      .mockRejectedValueOnce(new Error('Draft compensation offline'))
      .mockResolvedValueOnce(newer)
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent(completedRecordGenerationEvent({ draft: generated }))
      return { jobId: 'job-draft-race', status: generationStatusFixture({ jobId: 'job-draft-race', action: 'testware', state: 'completed' }) }
    })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => { await result.current.handleAiAction('testware') })
    act(() => result.current.updateLocalDraft(generated.id, { body: newer.body }))
    await act(async () => { await result.current.handleSaveDraft(result.current.testwareDrafts[0]) })

    await act(async () => {
      canonicalization.resolve(generated)
      await canonicalization.promise
    })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledTimes(3))
    expect(result.current.error).toContain('Draft compensation offline')
    await act(async () => { expect(await result.current.saveDirtyRecordsNow()).toBe(true) })
    expect(tauriMock.updateDraft).toHaveBeenCalledTimes(4)
    expect(tauriMock.updateDraft).toHaveBeenLastCalledWith(generated.id, expect.objectContaining({ body: newer.body }))
    expect(result.current.testwareDrafts[0].body).toBe(newer.body)
  })

  it('compensates late generated Finding canonicalization to a newer successful save', async () => {
    const canonicalization = deferred<ReturnType<typeof findingFixture>>()
    const generated = findingFixture({ id: 'finding-canonical-race', body: '<p>Generated Finding.</p>' })
    const newer = findingFixture({ id: generated.id, body: '<p>Newer saved Finding.</p>' })
    tauriMock.updateFinding
      .mockReturnValueOnce(canonicalization.promise)
      .mockResolvedValueOnce(newer)
      .mockRejectedValueOnce(new Error('Finding compensation offline'))
      .mockResolvedValueOnce(newer)
    tauriMock.startAiActionJob.mockImplementationOnce(async (_request: unknown, onEvent: (event: unknown) => void) => {
      onEvent(completedRecordGenerationEvent({ finding: generated }))
      return { jobId: 'job-finding-race', status: generationStatusFixture({ jobId: 'job-finding-race', action: 'finding', state: 'completed' }) }
    })

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => { await result.current.handleAiAction('finding') })
    act(() => result.current.updateLocalFinding(generated.id, { body: newer.body }))
    await act(async () => { await result.current.handleSaveFinding(result.current.findings[0]) })

    await act(async () => {
      canonicalization.resolve(generated)
      await canonicalization.promise
    })
    await waitFor(() => expect(tauriMock.updateFinding).toHaveBeenCalledTimes(3))
    expect(result.current.error).toContain('Finding compensation offline')
    await act(async () => { expect(await result.current.saveDirtyRecordsNow()).toBe(true) })
    expect(tauriMock.updateFinding).toHaveBeenCalledTimes(4)
    expect(tauriMock.updateFinding).toHaveBeenLastCalledWith(generated.id, expect.objectContaining({ body: newer.body }))
    expect(result.current.findings[0].body).toBe(newer.body)
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
