import type { RecordWorkspace, SessionWorkspace, WorkflowFeedback } from './types'
import type { ImportedAttachments } from './importedAttachments'
import type { InlineImageMaterialization } from './attachmentActions'
import type { RichEditorDocument } from '../editor/editorDocument'
import { createRecordActionCoordination } from './recordActions.coordination'
import { createDraftPersistence } from './recordPersistence.drafts'
import { createFindingPersistence } from './recordPersistence.findings'
import { useStableCapability } from './useStableCapability'

export type RecordPersistenceContext = {
  importedAttachments: ImportedAttachments
  session: Pick<SessionWorkspace, 'activeSessionIdRef'>
  records: Pick<RecordWorkspace, 'dirtyDraftIdsRef' | 'dirtyFindingIdsRef' | 'draftsRef' | 'findingsRef' | 'savedDraftsRef' | 'savedFindingsRef' | 'setDrafts' | 'setFindings' | 'setTestwareDraftCount' | 'setFindingCount'>
  feedback: WorkflowFeedback
  materializeInlineImages: (document: RichEditorDocument, options?: { entryId?: string | null; isCurrent?: () => boolean }) => Promise<InlineImageMaterialization>
  cleanupMaterializedAttachments: (attachmentIds: string[]) => Promise<boolean>
}

export function createRecordPersistence(ctx: RecordPersistenceContext) {
  const coordination = createRecordActionCoordination(ctx)
  const draftActions = createDraftPersistence(ctx, coordination)
  const findingActions = createFindingPersistence(ctx, coordination)

  async function saveDirtyRecordsNow(): Promise<boolean> {
    const dirtyDrafts = ctx.records.draftsRef.current.filter((draft) => ctx.records.dirtyDraftIdsRef.current.has(draft.id))
    const dirtyFindings = ctx.records.findingsRef.current.filter((finding) => ctx.records.dirtyFindingIdsRef.current.has(finding.id))
    if (dirtyDrafts.length === 0 && dirtyFindings.length === 0) return true

    let failed = false
    let allSaved = true
    for (const draft of dirtyDrafts) {
      const result = await draftActions.persistDraft(draft)
      failed = result === 'failed' || failed
      allSaved = result === 'saved' && allSaved
    }
    for (const finding of dirtyFindings) {
      const result = await findingActions.persistFinding(finding)
      failed = result === 'failed' || failed
      allSaved = result === 'saved' && allSaved
    }
    if (failed) return false
    if (allSaved) ctx.feedback.setNotice('Pending record edits saved')
    return true
  }

  return { coordination, drafts: draftActions, findings: findingActions, saveDirtyRecordsNow,
    retryPendingRecordCompensations: coordination.retryPendingRecordCompensations }
}

export type RecordPersistence = ReturnType<typeof createRecordPersistence>

export function useRecordPersistence(ctx: RecordPersistenceContext) {
  return useStableCapability(ctx, createRecordPersistence)
}
