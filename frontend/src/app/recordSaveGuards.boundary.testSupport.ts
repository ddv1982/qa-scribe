import { vi } from 'vitest'
import { draftFixture, findingFixture } from '../test/fixtures'
import { getTauriMock } from './useAppController.testHarness'
import { createRecordPersistence, type RecordPersistenceContext } from './recordPersistence'
import { recordStorage, type RecordKind } from './recordSaveGuards.storage.testSupport'

export function createOwnerBoundary(kind: RecordKind) {
  const record = kind === 'draft' ? draftFixture() : findingFixture()
  const second = kind === 'draft' ? draftFixture({ id: 'draft-Y', title: 'Y0' }) : findingFixture({ id: 'finding-Y', title: 'Y0' })
  const storage = recordStorage(record, kind, [second])
  const api = getTauriMock()
  const ctx: RecordPersistenceContext = {
    session: { activeSessionIdRef: { current: record.sessionId } },
    records: {
      draftsRef: { current: 'aiRunId' in record && 'aiRunId' in second ? [record, second] : [] }, findingsRef: { current: !('aiRunId' in record) && !('aiRunId' in second) ? [record, second] : [] },
      savedDraftsRef: { current: 'aiRunId' in record && 'aiRunId' in second ? [record, second] : [] }, savedFindingsRef: { current: !('aiRunId' in record) && !('aiRunId' in second) ? [record, second] : [] },
      dirtyDraftIdsRef: { current: new Set(kind === 'draft' ? [record.id] : []) }, dirtyFindingIdsRef: { current: new Set(kind === 'finding' ? [record.id] : []) },
      setDrafts: next => { ctx.records.draftsRef.current = typeof next === 'function' ? next(ctx.records.draftsRef.current) : next },
      setFindings: next => { ctx.records.findingsRef.current = typeof next === 'function' ? next(ctx.records.findingsRef.current) : next },
      setTestwareDraftCount: vi.fn(), setFindingCount: vi.fn(),
    },
    importedAttachments: { pending: () => [], register: vi.fn(), remember: vi.fn(), forget: vi.fn(), clear: vi.fn() },
    materializeInlineImages: document => Promise.resolve({ document, importedAttachmentIds: [] }),
    cleanupMaterializedAttachments: () => Promise.resolve(true),
    feedback: { setError: vi.fn(), setNotice: vi.fn(), setBusyAction: vi.fn() },
  }
  api.updateDraft.mockImplementation(storage.write); api.updateFinding.mockImplementation(storage.write)
  const persistence = createRecordPersistence(ctx)
  return { record, second, ctx, persistence, storage, api }
}
