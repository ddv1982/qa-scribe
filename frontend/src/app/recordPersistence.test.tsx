import { useLayoutEffect } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftFixture } from '../test/fixtures'
import { richEditorDocumentFromStoredBody } from '../editor/editorDocument'
import { cleanupControllerTest, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { useImportedAttachments } from './importedAttachments'
import { useRecordPersistence, type RecordPersistenceContext } from './recordPersistence'

const api = getTauriMock()

function context(importedAttachments: RecordPersistenceContext['importedAttachments'], dirty = true): RecordPersistenceContext {
  const draft = draftFixture({ title: 'Latest Testware', body: '<p>Persist this edit</p>' })
  return {
    importedAttachments,
    session: { activeSessionIdRef: { current: 'session-1' } },
    records: {
      dirtyDraftIdsRef: { current: new Set(dirty ? [draft.id] : []) }, dirtyFindingIdsRef: { current: new Set() },
      draftsRef: { current: [draft] }, findingsRef: { current: [] }, savedDraftsRef: { current: [] }, savedFindingsRef: { current: [] },
      setDrafts: vi.fn(), setFindings: vi.fn(), setTestwareDraftCount: vi.fn(), setFindingCount: vi.fn(),
    },
    feedback: { setError: vi.fn(), setBusyAction: vi.fn(), setNotice: vi.fn() },
    materializeInlineImages: async () => ({ document: richEditorDocumentFromStoredBody(draft), importedAttachmentIds: [] }),
    cleanupMaterializedAttachments: async () => true,
  }
}

describe('Record persistence construction', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it.each([true, false])('settles a layout-time save with backend success %s before Session and Record UI exist', async (succeeds) => {
    const stored = draftFixture({ title: 'Latest Testware', body: '<p>Persist this edit</p>' })
    if (succeeds) api.updateDraft.mockResolvedValue(stored)
    else api.updateDraft.mockRejectedValue(new Error('backend write failed'))
    let completion: Promise<boolean> | null = null
    let records: RecordPersistenceContext['records'] | null = null
    renderHook(() => {
      const importedAttachments = useImportedAttachments()
      const ctx = context(importedAttachments)
      records = ctx.records
      const persistence = useRecordPersistence(ctx)
      useLayoutEffect(() => { completion = persistence.saveDirtyRecordsNow() }, [persistence])
    })
    await waitFor(() => expect(api.updateDraft).toHaveBeenCalledOnce())
    let saved: boolean | null = null
    await act(async () => { saved = await completion })
    expect(saved).toBe(succeeds)
    expect(api.updateDraft).toHaveBeenCalledWith(stored.id, expect.objectContaining({ title: 'Latest Testware', body: '<p>Persist this edit</p>' }), expect.objectContaining({ expectedStoredBase: expect.any(String) }))
    expect(records!.dirtyDraftIdsRef.current.has(stored.id)).toBe(!succeeds)
    expect(records!.savedDraftsRef.current).toEqual(succeeds ? [stored] : [])
  })

  // A pass runs on every launch and navigation; only one that saved something reports it.
  it.each([['one dirty record', true, 1], ['nothing dirty', false, 0]])('%s: saves and reports pending edits %i times', async (_case, dirty, notices) => {
    api.updateDraft.mockResolvedValue(draftFixture({ title: 'Latest Testware', body: '<p>Persist this edit</p>' }))
    let completion: Promise<boolean> | null = null
    let feedback: RecordPersistenceContext['feedback'] | null = null
    renderHook(() => {
      const ctx = context(useImportedAttachments(), dirty)
      feedback = ctx.feedback
      const persistence = useRecordPersistence(ctx)
      useLayoutEffect(() => { completion = persistence.saveDirtyRecordsNow() }, [persistence])
    })
    await act(async () => { expect(await completion).toBe(true) })
    expect(api.updateDraft).toHaveBeenCalledTimes(notices)
    expect(feedback!.setNotice).toHaveBeenCalledTimes(notices)
    if (notices) expect(feedback!.setNotice).toHaveBeenCalledWith('Pending record edits saved')
  })
})
