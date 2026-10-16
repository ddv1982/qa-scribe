import { updateFinding, type Finding } from '../tauri'
import { richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { formatError } from '../ui/format'
import type { RecordPersistenceContext } from './recordPersistence'
import type { RecordActionCoordination } from './recordActions.coordination'

type RecordPersistResult = 'saved' | 'superseded' | 'failed'

export function createFindingPersistence(ctx: RecordPersistenceContext, coordination: RecordActionCoordination) {
  const intents = coordination.findingIntents

  async function persistFinding(finding: Finding): Promise<RecordPersistResult> {
    if (intents.get(finding.id)?.kind === 'delete') return 'superseded'
    const intentGeneration = coordination.reserveFindingIntent(finding.id, 'save')
    let importedAttachmentIds: string[] = []
    try {
      ctx.feedback.setError(null)
      const materialized = await coordination.materializeRecordBody(
        finding,
        () => intents.get(finding.id)?.generation === intentGeneration,
      )
      importedAttachmentIds = materialized.importedAttachmentIds
      if (intents.get(finding.id)?.generation !== intentGeneration) {
        return await ctx.cleanupMaterializedAttachments(importedAttachmentIds) ? 'superseded' : 'failed'
      }
      const storedBody = richEditorDocumentToStoredBody(materialized.document)
      const saved = await coordination.trackWrite(updateFinding(finding.id, {
        title: finding.title,
        ...storedBody,
        kind: finding.kind,
        metadataJson: finding.metadataJson,
      }))
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
      intents.set(finding.id, { ...latestIntent, restore: saved, compensationPending: false })
      if (ctx.session.activeSessionIdRef.current === saved.sessionId) {
        ctx.records.savedFindingsRef.current = coordination.replaceRecord(ctx.records.savedFindingsRef.current, saved)
      }
      const current = ctx.records.findingsRef.current.find((item) => item.id === finding.id)
      if (!current) {
        return 'failed'
      }
      if (!findingEditableFieldsMatch(current, finding)) {
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
      if (!currentAfterSettlement || !findingEditableFieldsMatch(currentAfterSettlement, finding)) {
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
      return 'saved'
    } catch (cause) {
      await ctx.cleanupMaterializedAttachments(importedAttachmentIds)
      const latestIntent = intents.get(finding.id)
      const reconciled = !latestIntent?.restore || await coordination.reconcileFindingIntent(finding.id)
      if (reconciled) ctx.feedback.setError(formatError(cause))
      return 'failed'
    }
  }

  async function canonicalizeGeneratedFinding(finding: Finding): Promise<void> {
    if (intents.get(finding.id)?.kind === 'delete') return
    const intentGeneration = coordination.reserveFindingIntent(finding.id, 'canonicalize', finding)
    ctx.records.savedFindingsRef.current = coordination.replaceRecord(ctx.records.savedFindingsRef.current, finding)
    try {
      const saved = await coordination.trackWrite(updateFinding(finding.id, coordination.findingPersistencePatch(finding)))
      const intent = intents.get(finding.id)
      if (!intent || intent.generation !== intentGeneration) {
        await coordination.reconcileFindingIntent(finding.id)
        return
      }
      intents.set(finding.id, { ...intent, restore: saved, compensationPending: false })
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
    } catch (cause) {
      const intent = intents.get(finding.id)
      if (intent?.generation !== intentGeneration) return
      coordination.markFindingCompensationPending(finding, cause)
    }
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
