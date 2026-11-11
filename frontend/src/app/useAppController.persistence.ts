import { useAttachmentActions } from './attachmentActions'
import { useImportedAttachments } from './importedAttachments'
import { createNoteEligibility } from './noteEligibility'
import { useRecordPersistence } from './recordPersistence'
import { useSessionActions, type SessionActionsContext } from './sessionActions'
import type { useAppControllerRecords } from './useAppController.records'
import { useChatNoteRecovery } from './useChatNoteRecovery'
import { useStableCapability } from './useStableCapability'

type AppControllerPersistenceContext = Pick<
  SessionActionsContext,
  | 'session'
  | 'generation'
  | 'latestNoteGenerationUndoRef'
  | 'summaryRecovery'
  | 'feedback'
  | 'navigation'
  | 'deletion'
  | 'attachmentCleanup'
> & {
  records: ReturnType<typeof useAppControllerRecords>
}

export function useAppControllerPersistence({
  session,
  records,
  generation,
  latestNoteGenerationUndoRef,
  summaryRecovery,
  feedback,
  navigation,
  deletion,
  attachmentCleanup,
}: AppControllerPersistenceContext) {
  const { recordWorkspace, suspendRecordLoads, restoreRecordLoads, resetRecordHydration } = records
  const importedAttachments = useImportedAttachments()
  const attachmentActions = useAttachmentActions({
    session, feedback, registerImportedAttachment: importedAttachments.register,
  })
  const recordPersistence = useRecordPersistence({
    importedAttachments, session, records: recordWorkspace, feedback,
    materializeInlineImages: attachmentActions.materializeInlineImages,
    cleanupMaterializedAttachments: attachmentActions.cleanupMaterializedAttachments,
  })
  const noteRecovery = useChatNoteRecovery()
  const noteEligibility = useStableCapability({ summary: summaryRecovery, chat: noteRecovery }, createNoteEligibility)
  const sessionActions = useSessionActions({
    session, noteRecovery, noteEligibility, importedAttachments,
    records: recordWorkspace,
    generation, latestNoteGenerationUndoRef, summaryRecovery,
    feedback,
    navigation,
    deletion,
    attachmentCleanup,
    materializeInlineImages: attachmentActions.materializeInlineImages,
    cleanupMaterializedAttachments: attachmentActions.cleanupMaterializedAttachments,
    suspendRecordLoads,
    restoreRecordLoads,
    resetRecordHydration,
    saveDirtyRecordsNow: recordPersistence.saveDirtyRecordsNow,
    retryPendingRecordCompensations: recordPersistence.retryPendingRecordCompensations,
  })
  return { importedAttachments, attachmentActions, recordPersistence, noteRecovery, noteEligibility, sessionActions }
}
