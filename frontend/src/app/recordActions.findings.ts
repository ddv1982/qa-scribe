import { deleteFinding, updateFinding, type Finding } from '../tauri'
import { richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { formatError } from '../ui/format'
import type { FindingRecordPatch } from './types'
import type { RecordActionsContext } from './recordActions'
import type { RecordActionCoordination } from './recordActions.coordination'

type RecordPersistResult = 'saved' | 'superseded' | 'failed'

export function createFindingRecordActions(
  ctx: RecordActionsContext,
  coordination: RecordActionCoordination,
) {
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

  async function handleSaveFinding(finding: Finding): Promise<boolean> {
    try {
      ctx.feedback.setBusyAction(`finding:${finding.id}`)
      const result = await persistFinding(finding)
      if (result === 'saved') ctx.feedback.setNotice('Finding saved')
      return result === 'saved'
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  function updateLocalFinding(id: string, patch: FindingRecordPatch) {
    if (intents.get(id)?.kind === 'delete') return
    ctx.registerRecordEditIntent()
    ctx.records.dirtyFindingIdsRef.current.add(id)
    ctx.records.setFindings((previous) => {
      const nextFindings = previous.map((finding) => (finding.id === id ? { ...finding, ...patch } : finding))
      ctx.records.findingsRef.current = nextFindings
      return nextFindings
    })
  }

  function discardLocalFinding(original: Finding) {
    if (intents.get(original.id)?.kind === 'delete') return
    const latestSaved = ctx.records.savedFindingsRef.current.find((finding) => finding.id === original.id) ?? original
    const compensationPending = intents.get(original.id)?.compensationPending
    coordination.reserveFindingIntent(original.id, 'discard', latestSaved)
    if (compensationPending) {
      intents.get(original.id)!.compensationPending = true
      ctx.records.dirtyFindingIdsRef.current.add(original.id)
    } else {
      ctx.records.dirtyFindingIdsRef.current.delete(original.id)
    }
    ctx.records.setFindings((previous) => {
      const nextFindings = previous.map((finding) => (finding.id === original.id ? latestSaved : finding))
      ctx.records.findingsRef.current = nextFindings
      return nextFindings
    })
    void coordination.settleImportedRecordAttachments({ kind: 'finding', id: original.id }, latestSaved)
    if (compensationPending) {
      ctx.feedback.setError('Save the restored Finding again before leaving.')
      return
    }
    ctx.feedback.setNotice('Finding changes discarded')
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

  function requestDeleteFinding(finding: Finding) {
    ctx.deletion.setDeleteConfirmation({ kind: 'finding', finding })
  }

  async function handleDeleteFinding(finding: Finding) {
    const previousIntent = intents.get(finding.id)
    const deletionGeneration = coordination.reserveFindingIntent(finding.id, 'delete')
    let deleted = false
    try {
      ctx.feedback.setBusyAction(`delete-finding:${finding.id}`)
      ctx.feedback.setError(null)
      await deleteFinding(finding.id)
      deleted = true
      ctx.invalidateFindingLoads()
      removeDeletedFindingFromWorkspace(finding)
      const attachmentsSettled = await coordination.settleImportedRecordAttachments({ kind: 'finding', id: finding.id }, null)
      ctx.feedback.setNotice(attachmentsSettled
        ? 'Finding deleted'
        : 'Finding deleted; image cleanup will retry before closing')
      await ctx.loaders.loadFindingsForSession(finding.sessionId, { force: true, replace: true })
    } catch (cause) {
      if (!deleted && intents.get(finding.id)?.generation === deletionGeneration) {
        if (previousIntent) intents.set(finding.id, previousIntent)
        else intents.delete(finding.id)
      }
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  function removeDeletedFindingFromWorkspace(finding: Finding) {
    ctx.records.dirtyFindingIdsRef.current.delete(finding.id)
    ctx.records.savedFindingsRef.current = ctx.records.savedFindingsRef.current.filter((item) => item.id !== finding.id)
    if (ctx.session.activeSessionIdRef.current !== finding.sessionId) return
    const wasVisible = ctx.records.findingsRef.current.some((item) => item.id === finding.id)
    const next = ctx.records.findingsRef.current.filter((item) => item.id !== finding.id)
    ctx.records.findingsRef.current = next
    ctx.records.setFindings(next)
    if (wasVisible) ctx.records.setFindingCount((count) => Math.max(0, count - 1))
  }

  return {
    canonicalizeGeneratedFinding,
    discardLocalFinding,
    handleDeleteFinding,
    handleSaveFinding,
    persistFinding,
    requestDeleteFinding,
    updateLocalFinding,
  }
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
