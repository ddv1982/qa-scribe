import { updateDraft, type Draft } from '../tauri'
import { richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { formatError } from '../ui/format'
import type { RecordPersistenceContext } from './recordPersistence'
import type { RecordActionCoordination } from './recordActions.coordination'

type RecordPersistResult = 'saved' | 'superseded' | 'failed'

export function createDraftPersistence(ctx: RecordPersistenceContext, coordination: RecordActionCoordination) {
  const intents = coordination.draftIntents

  async function persistDraft(draft: Draft): Promise<RecordPersistResult> {
    if (intents.get(draft.id)?.kind === 'delete') return 'superseded'
    const intentGeneration = coordination.reserveDraftIntent(draft.id, 'save')
    const finishOperation = coordination.beginRecordOperation()
    let importedAttachmentIds: string[] = []
    try {
      ctx.feedback.setError(null)
      const guard = await coordination.guardFor(draft, 'draft')
      const materialized = await coordination.materializeRecordBody(
        draft,
        () => intents.get(draft.id)?.generation === intentGeneration,
      )
      importedAttachmentIds = materialized.importedAttachmentIds
      if (intents.get(draft.id)?.generation !== intentGeneration) {
        return await ctx.cleanupMaterializedAttachments(importedAttachmentIds) ? 'superseded' : 'failed'
      }
      const storedBody = richEditorDocumentToStoredBody(materialized.document)
      const saved = await coordination.trackWrite(updateDraft(draft.id, { title: draft.title, ...storedBody }, guard))
      await coordination.confirmedWrite(saved, 'draft', guard)
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
      intents.set(draft.id, { ...latestIntent, restore: saved, compensationPending: false })
      if (ctx.session.activeSessionIdRef.current === saved.sessionId) {
        ctx.records.savedDraftsRef.current = coordination.replaceRecord(ctx.records.savedDraftsRef.current, saved)
      }
      const current = ctx.records.draftsRef.current.find((item) => item.id === draft.id)
      if (!current) {
        return 'failed'
      }
      if (!draftEditableFieldsMatch(current, draft)) {
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
      if (!currentAfterSettlement || !draftEditableFieldsMatch(currentAfterSettlement, draft)) {
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
      coordination.clearStage('draft', draft.id)
      return 'saved'
    } catch (cause) {
      if (coordination.adoptConflict(cause)) return 'failed'
      await ctx.cleanupMaterializedAttachments(importedAttachmentIds)
      const latestIntent = intents.get(draft.id)
      const reconciled = !latestIntent?.restore || await coordination.reconcileDraftIntent(draft.id)
      if (reconciled) ctx.feedback.setError(formatError(cause))
      return 'failed'
    } finally { finishOperation() }
  }

  async function canonicalizeGeneratedDraft(draft: Draft, storedBase: Draft): Promise<void> {
    if (intents.get(draft.id)?.kind === 'delete') return
    const finishOperation = coordination.beginRecordOperation()
    const intentGeneration = coordination.reserveDraftIntent(draft.id, 'canonicalize', draft)
    ctx.records.savedDraftsRef.current = coordination.replaceRecord(ctx.records.savedDraftsRef.current, storedBase)
    try {
      const guard = await coordination.guardFor(draft, 'draft')
      const saved = await coordination.trackWrite(updateDraft(draft.id, coordination.draftPersistencePatch(draft), guard))
      await coordination.confirmedWrite(saved, 'draft', guard)
      const intent = intents.get(draft.id)
      if (!intent || intent.generation !== intentGeneration) {
        await coordination.reconcileDraftIntent(draft.id)
        return
      }
      intents.set(draft.id, { ...intent, restore: saved, compensationPending: false })
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
    } catch (cause) {
      if (coordination.adoptConflict(cause)) return
      const intent = intents.get(draft.id)
      if (intent?.generation !== intentGeneration) return
      coordination.markDraftCompensationPending(draft, cause)
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
