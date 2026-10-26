import { deleteFinding, type Finding } from '../tauri'
import { formatError } from '../ui/format'
import type { FindingRecordPatch } from './types'
import type { RecordActionsContext } from './recordActions'
import type { RecordPersistence } from './recordPersistence'
import type { RecordActionCoordination } from './recordActions.coordination'

export function createFindingRecordActions(
  ctx: RecordActionsContext,
  coordination: RecordActionCoordination,
  persistence: RecordPersistence['findings'],
) {
  const intents = coordination.findingIntents
  const { persistFinding, canonicalizeGeneratedFinding } = persistence

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
    coordination.recordLocalEdit('finding', id)
    ctx.registerRecordEditIntent()
    ctx.records.dirtyFindingIdsRef.current.add(id)
    const next = ctx.records.findingsRef.current.map(record => record.id === id ? { ...record, ...patch } : record)
    ctx.records.findingsRef.current = next
    ctx.records.setFindings(next)
  }

  function discardLocalFinding(original: Finding) {
    if (intents.get(original.id)?.kind === 'delete') return
    coordination.clearStage('finding', original.id, 'discard')
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
