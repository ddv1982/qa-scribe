import { updateFinding, type Finding } from '../tauri'
import { richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { formatError } from '../ui/format'
import { RecordWriteConflict } from './recordWriteGuards'
import type { ExactSaveOperation, RecordPersistenceContext } from './recordPersistence'
import type { RecordActionCoordination } from './recordActions.coordination'

type RecordPersistResult = 'saved' | 'superseded' | 'failed'

export function createFindingPersistence(ctx: RecordPersistenceContext, coordination: RecordActionCoordination) {
  const intents = coordination.findingIntents

  async function persistFinding(finding: Finding, exact?: ExactSaveOperation): Promise<RecordPersistResult> {
    if (intents.get(finding.id)?.kind === 'delete') return 'superseded'
    const stageOrigin = coordination.proposalStages.get(`finding:${finding.id}`)?.origin
    const intentGeneration = coordination.reserveFindingIntent(finding.id, 'save')
    const finishOperation = coordination.beginRecordOperation()
    const isCurrent = () => intents.get(finding.id)?.generation === intentGeneration && (exact?.isCurrent(intentGeneration) ?? true)
    let importedAttachmentIds: string[] = []
    try {
      ctx.feedback.setError(null)
      const guard = await coordination.guardFor(finding, 'finding')
      if (!isCurrent()) return 'superseded'
      const materialized = await coordination.materializeRecordBody(
        finding,
        isCurrent,
      )
      importedAttachmentIds = materialized.importedAttachmentIds
      if (!isCurrent()) {
        return await ctx.cleanupMaterializedAttachments(importedAttachmentIds) ? 'superseded' : 'failed'
      }
      const storedBody = richEditorDocumentToStoredBody(materialized.document)
      if (!isCurrent()) return await ctx.cleanupMaterializedAttachments(importedAttachmentIds) ? 'superseded' : 'failed'
      if (exact && !exact.acknowledged) exact.dispatched = true
      const saved = (exact?.acknowledged && !('aiRunId' in exact.acknowledged) ? exact.acknowledged : undefined) ?? await coordination.trackWrite(updateFinding(finding.id, {
        title: finding.title,
        ...storedBody,
        kind: finding.kind,
        metadataJson: finding.metadataJson,
      }, guard))
      if (exact) exact.acknowledged = saved
      const completedOrigin = await coordination.confirmedWrite({ record: saved, kind: 'finding', guard, generation: intentGeneration, stageOrigin })
      const latestIntent = intents.get(finding.id)
      if (!latestIntent || latestIntent.generation !== intentGeneration) {
        const reconciled = await coordination.reconcileFindingIntent(finding.id)
        const desired = latestIntent?.restore
          ?? ctx.records.findingsRef.current.find((item) => item.id === finding.id)
        const cleaned = await ctx.cleanupMaterializedAttachments(
          coordination.attachmentsNotReferencedByRecord(importedAttachmentIds, desired),
        )
        return reconciled && cleaned ? 'superseded' : 'failed'
      }
      if (ctx.session.activeSessionIdRef.current === saved.sessionId) {
        ctx.records.savedFindingsRef.current = coordination.replaceRecord(ctx.records.savedFindingsRef.current, saved)
      }
      const current = ctx.records.findingsRef.current.find((item) => item.id === finding.id)
      if (!current) {
        return 'failed'
      }
      if (!isCurrent() || !findingEditableFieldsMatch(current, finding)) {
        return await ctx.cleanupMaterializedAttachments(
          coordination.attachmentsNotReferencedByRecord(importedAttachmentIds, current),
        ) ? 'superseded' : 'failed'
      }
      if (!await coordination.settleImportedRecordAttachments({ kind: 'finding', id: finding.id }, saved)) return 'failed'
      const settledIntent = intents.get(finding.id)
      if (!settledIntent || settledIntent.generation !== intentGeneration) {
        const reconciled = await coordination.reconcileFindingIntent(finding.id)
        const desired = settledIntent?.restore
          ?? ctx.records.findingsRef.current.find((item) => item.id === finding.id)
        const cleaned = await ctx.cleanupMaterializedAttachments(
          coordination.attachmentsNotReferencedByRecord(importedAttachmentIds, desired),
        )
        return reconciled && cleaned ? 'superseded' : 'failed'
      }
      const currentAfterSettlement = ctx.records.findingsRef.current.find((item) => item.id === finding.id)
      if (!isCurrent() || !currentAfterSettlement || !findingEditableFieldsMatch(currentAfterSettlement, finding)) {
        return await ctx.cleanupMaterializedAttachments(
          coordination.attachmentsNotReferencedByRecord(importedAttachmentIds, currentAfterSettlement),
        ) ? 'superseded' : 'failed'
      }
      ctx.records.dirtyFindingIdsRef.current.delete(finding.id)
      if (ctx.session.activeSessionIdRef.current === saved.sessionId) {
        ctx.records.setFindings((previous) => {
          const nextFindings = previous.map((item) => (item.id === saved.id ? saved : item))
          ctx.records.findingsRef.current = nextFindings
          return nextFindings
        })
      }
      coordination.clearStage('finding', finding.id, 'saved', completedOrigin)
      if (exact) exact.settled = saved
      return 'saved'
    } catch (cause) {
      if (exact) {
        exact.message = formatError(cause)
        if (cause instanceof RecordWriteConflict) exact.conflict = cause.current
      }
      if (intents.get(finding.id)?.generation !== intentGeneration) {
        return await coordination.cleanupUnreferencedRecordAttachments('finding', finding.id, importedAttachmentIds) ? 'superseded' : 'failed'
      }
      if (coordination.adoptConflict(cause, stageOrigin)) {
        await coordination.cleanupUnreferencedRecordAttachments('finding', finding.id, importedAttachmentIds)
        return 'failed'
      }
      await coordination.cleanupUnreferencedRecordAttachments('finding', finding.id, importedAttachmentIds)
      const latestIntent = intents.get(finding.id)
      if (latestIntent?.generation !== intentGeneration) return 'superseded'
      const reconciled = !latestIntent.restore || await coordination.reconcileFindingIntent(finding.id)
      if (reconciled && intents.get(finding.id)?.generation === intentGeneration) ctx.feedback.setError(formatError(cause))
      return 'failed'
    } finally { finishOperation() }
  }

  async function canonicalizeGeneratedFinding(finding: Finding, storedBase: Finding): Promise<RecordPersistResult> {
    if (intents.get(finding.id)?.kind === 'delete') return 'superseded'
    const stageOrigin = coordination.proposalStages.get(`finding:${finding.id}`)?.origin
    const finishOperation = coordination.beginRecordOperation()
    const intentGeneration = coordination.reserveFindingIntent(finding.id, 'canonicalize', finding)
    try {
      ctx.records.savedFindingsRef.current = coordination.replaceRecord(ctx.records.savedFindingsRef.current, storedBase)
      const guard = await coordination.guardFor(finding, 'finding')
      const saved = await coordination.trackWrite(updateFinding(finding.id, coordination.findingPersistencePatch(finding), guard))
      await coordination.confirmedWrite({ record: saved, kind: 'finding', guard, generation: intentGeneration, stageOrigin })
      const intent = intents.get(finding.id)
      if (!intent || intent.generation !== intentGeneration) {
        return await coordination.reconcileFindingIntent(finding.id) ? 'superseded' : 'failed'
      }
      if (ctx.session.activeSessionIdRef.current === saved.sessionId) {
        ctx.records.savedFindingsRef.current = coordination.replaceRecord(ctx.records.savedFindingsRef.current, saved)
      }
      if (ctx.session.activeSessionIdRef.current === saved.sessionId && !ctx.records.dirtyFindingIdsRef.current.has(saved.id)) {
        ctx.records.setFindings((previous) => {
          const next = coordination.replaceRecord(previous, saved)
          ctx.records.findingsRef.current = next
          return next
        })
      }
      return 'saved'
    } catch (cause) {
      const intent = intents.get(finding.id)
      if (intent?.generation !== intentGeneration) return 'superseded'
      if (coordination.adoptConflict(cause, stageOrigin)) return 'failed'
      coordination.markFindingCompensationPending(finding, cause)
      return 'failed'
    } finally { finishOperation() }
  }

  return { persistFinding, canonicalizeGeneratedFinding }
}

function findingEditableFieldsMatch(left: Finding, right: Finding): boolean {
  return (
    left.title === right.title &&
    left.body === right.body &&
    left.bodyJson === right.bodyJson &&
    left.bodyFormat === right.bodyFormat &&
    left.kind === right.kind &&
    left.metadataJson === right.metadataJson
  )
}
