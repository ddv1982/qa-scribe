import { updateDraft, type Draft } from '../tauri'
import { richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { formatError, isCommandError } from '../ui/format'
import { RecordWriteConflict } from './recordWriteGuards'
import type { ExactSaveOperation, RecordPersistenceContext } from './recordPersistence'
import type { RecordActionCoordination } from './recordActions.coordination'

type RecordPersistResult = 'saved' | 'superseded' | 'failed'

export function createDraftPersistence(ctx: RecordPersistenceContext, coordination: RecordActionCoordination) {
  const intents = coordination.draftIntents

  async function persistDraft(draft: Draft, exact?: ExactSaveOperation): Promise<RecordPersistResult> {
    if (intents.get(draft.id)?.kind === 'delete') return 'superseded'
    const stageOrigin = coordination.proposalStages.get(`draft:${draft.id}`)?.origin
    const intentGeneration = coordination.reserveDraftIntent(draft.id, 'save')
    const finishOperation = coordination.beginRecordOperation()
    const isCurrent = () => intents.get(draft.id)?.generation === intentGeneration && (exact?.isCurrent(intentGeneration) ?? true)
    let importedAttachmentIds: string[] = []
    try {
      ctx.feedback.setError(null)
      const guard = await coordination.guardFor(draft, 'draft')
      if (!isCurrent()) return 'superseded'
      const materialized = await coordination.materializeRecordBody(
        draft,
        isCurrent,
      )
      importedAttachmentIds = materialized.importedAttachmentIds
      if (!isCurrent()) {
        return await ctx.cleanupMaterializedAttachments(importedAttachmentIds) ? 'superseded' : 'failed'
      }
      const storedBody = richEditorDocumentToStoredBody(materialized.document)
      if (!isCurrent()) return await ctx.cleanupMaterializedAttachments(importedAttachmentIds) ? 'superseded' : 'failed'
      if (exact && !exact.acknowledged) exact.dispatched = true
      const saved = (exact?.acknowledged && 'aiRunId' in exact.acknowledged ? exact.acknowledged : undefined) ?? await coordination.trackWrite(updateDraft(draft.id, { title: draft.title, ...storedBody }, guard))
      if (exact) exact.acknowledged = saved
      const completedOrigin = await coordination.confirmedWrite({ record: saved, kind: 'draft', guard, generation: intentGeneration, stageOrigin })
      const latestIntent = intents.get(draft.id)
      if (!latestIntent || latestIntent.generation !== intentGeneration) {
        const reconciled = await coordination.reconcileDraftIntent(draft.id)
        const desired = latestIntent?.restore
          ?? ctx.records.draftsRef.current.find((item) => item.id === draft.id)
        const cleaned = await ctx.cleanupMaterializedAttachments(
          coordination.attachmentsNotReferencedByRecord(importedAttachmentIds, desired),
        )
        return reconciled && cleaned ? 'superseded' : 'failed'
      }
      if (ctx.session.activeSessionIdRef.current === saved.sessionId) {
        ctx.records.savedDraftsRef.current = coordination.replaceRecord(ctx.records.savedDraftsRef.current, saved)
      }
      const current = ctx.records.draftsRef.current.find((item) => item.id === draft.id)
      if (!current) {
        return 'failed'
      }
      if (!isCurrent() || !draftEditableFieldsMatch(current, draft)) {
        return await ctx.cleanupMaterializedAttachments(
          coordination.attachmentsNotReferencedByRecord(importedAttachmentIds, current),
        ) ? 'superseded' : 'failed'
      }
      if (!await coordination.settleImportedRecordAttachments({ kind: 'draft', id: draft.id }, saved)) return 'failed'
      const settledIntent = intents.get(draft.id)
      if (!settledIntent || settledIntent.generation !== intentGeneration) {
        const reconciled = await coordination.reconcileDraftIntent(draft.id)
        const desired = settledIntent?.restore
          ?? ctx.records.draftsRef.current.find((item) => item.id === draft.id)
        const cleaned = await ctx.cleanupMaterializedAttachments(
          coordination.attachmentsNotReferencedByRecord(importedAttachmentIds, desired),
        )
        return reconciled && cleaned ? 'superseded' : 'failed'
      }
      const currentAfterSettlement = ctx.records.draftsRef.current.find((item) => item.id === draft.id)
      if (!isCurrent() || !currentAfterSettlement || !draftEditableFieldsMatch(currentAfterSettlement, draft)) {
        return await ctx.cleanupMaterializedAttachments(
          coordination.attachmentsNotReferencedByRecord(importedAttachmentIds, currentAfterSettlement),
        ) ? 'superseded' : 'failed'
      }
      ctx.records.dirtyDraftIdsRef.current.delete(draft.id)
      if (ctx.session.activeSessionIdRef.current === saved.sessionId) {
        ctx.records.setDrafts((previous) => {
          const nextDrafts = previous.map((item) => (item.id === saved.id ? saved : item))
          ctx.records.draftsRef.current = nextDrafts
          return nextDrafts
        })
      }
      coordination.clearStage('draft', draft.id, 'saved', completedOrigin)
      if (exact) exact.settled = saved
      return 'saved'
    } catch (cause) {
      if (exact) {
        if (!exact.acknowledged && isCommandError(cause) && (cause.kind === 'validation' || cause.kind === 'notFound')) exact.dispatched = false
        exact.message = formatError(cause)
        if (cause instanceof RecordWriteConflict) exact.conflict = cause.current
      }
      if (intents.get(draft.id)?.generation !== intentGeneration) {
        return await coordination.cleanupUnreferencedRecordAttachments('draft', draft.id, importedAttachmentIds) ? 'superseded' : 'failed'
      }
      if (coordination.adoptConflict(cause, stageOrigin)) {
        await coordination.cleanupUnreferencedRecordAttachments('draft', draft.id, importedAttachmentIds)
        return 'failed'
      }
      await coordination.cleanupUnreferencedRecordAttachments('draft', draft.id, importedAttachmentIds)
      const latestIntent = intents.get(draft.id)
      if (latestIntent?.generation !== intentGeneration) return 'superseded'
      const reconciled = !latestIntent.restore || await coordination.reconcileDraftIntent(draft.id)
      if (reconciled && intents.get(draft.id)?.generation === intentGeneration) ctx.feedback.setError(formatError(cause))
      return 'failed'
    } finally { finishOperation() }
  }

  async function canonicalizeGeneratedDraft(draft: Draft, storedBase: Draft): Promise<RecordPersistResult> {
    if (intents.get(draft.id)?.kind === 'delete') return 'superseded'
    const stageOrigin = coordination.proposalStages.get(`draft:${draft.id}`)?.origin
    const finishOperation = coordination.beginRecordOperation()
    const intentGeneration = coordination.reserveDraftIntent(draft.id, 'canonicalize', draft)
    try {
      ctx.records.savedDraftsRef.current = coordination.replaceRecord(ctx.records.savedDraftsRef.current, storedBase)
      const guard = await coordination.guardFor(draft, 'draft')
      const saved = await coordination.trackWrite(updateDraft(draft.id, coordination.draftPersistencePatch(draft), guard))
      await coordination.confirmedWrite({ record: saved, kind: 'draft', guard, generation: intentGeneration, stageOrigin })
      const intent = intents.get(draft.id)
      if (!intent || intent.generation !== intentGeneration) {
        return await coordination.reconcileDraftIntent(draft.id) ? 'superseded' : 'failed'
      }
      if (ctx.session.activeSessionIdRef.current === saved.sessionId) {
        ctx.records.savedDraftsRef.current = coordination.replaceRecord(ctx.records.savedDraftsRef.current, saved)
      }
      if (ctx.session.activeSessionIdRef.current === saved.sessionId && !ctx.records.dirtyDraftIdsRef.current.has(saved.id)) {
        ctx.records.setDrafts((previous) => {
          const next = coordination.replaceRecord(previous, saved)
          ctx.records.draftsRef.current = next
          return next
        })
      }
      return 'saved'
    } catch (cause) {
      const intent = intents.get(draft.id)
      if (intent?.generation !== intentGeneration) return 'superseded'
      if (coordination.adoptConflict(cause, stageOrigin)) return 'failed'
      coordination.markDraftCompensationPending(draft, cause)
      return 'failed'
    } finally { finishOperation() }
  }

  return { persistDraft, canonicalizeGeneratedDraft }
}

function draftEditableFieldsMatch(left: Draft, right: Draft): boolean {
  return (
    left.title === right.title &&
    left.body === right.body &&
    left.bodyJson === right.bodyJson &&
    left.bodyFormat === right.bodyFormat
  )
}
