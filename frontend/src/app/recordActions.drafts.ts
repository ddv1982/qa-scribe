import { deleteDraft, type Draft } from '../tauri'
import { formatError } from '../ui/format'
import type { RichRecordPatch } from './types'
import type { RecordActionsContext } from './recordActions'
import type { RecordPersistence } from './recordPersistence'
import type { RecordActionCoordination } from './recordActions.coordination'

export function createDraftRecordActions(
  ctx: RecordActionsContext,
  coordination: RecordActionCoordination,
  persistence: RecordPersistence['drafts'],
) {
  const intents = coordination.draftIntents
  const { persistDraft, canonicalizeGeneratedDraft } = persistence

  async function handleSaveDraft(draft: Draft): Promise<boolean> {
    try {
      ctx.feedback.setBusyAction(`draft:${draft.id}`)
      const result = await persistDraft(draft)
      if (result === 'saved') ctx.feedback.setNotice('Testware saved')
      return result === 'saved'
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  function updateLocalDraft(id: string, patch: RichRecordPatch) {
    if (intents.get(id)?.kind === 'delete') return
    coordination.recordLocalEdit('draft', id)
    ctx.registerRecordEditIntent()
    ctx.records.dirtyDraftIdsRef.current.add(id)
    const next = ctx.records.draftsRef.current.map(record => record.id === id ? { ...record, ...patch } : record)
    ctx.records.draftsRef.current = next
    ctx.records.setDrafts(next)
  }

  function discardLocalDraft(original: Draft) {
    if (intents.get(original.id)?.kind === 'delete') return
    coordination.clearStage('draft', original.id, 'discard')
    const latestSaved = ctx.records.savedDraftsRef.current.find((draft) => draft.id === original.id) ?? original
    const compensationPending = intents.get(original.id)?.compensationPending
    coordination.reserveDraftIntent(original.id, 'discard', latestSaved)
    if (compensationPending) {
      intents.get(original.id)!.compensationPending = true
      ctx.records.dirtyDraftIdsRef.current.add(original.id)
    } else {
      ctx.records.dirtyDraftIdsRef.current.delete(original.id)
    }
    ctx.records.setDrafts((previous) => {
      const nextDrafts = previous.map((draft) => (draft.id === original.id ? latestSaved : draft))
      ctx.records.draftsRef.current = nextDrafts
      return nextDrafts
    })
    void coordination.settleImportedRecordAttachments({ kind: 'draft', id: original.id }, latestSaved)
    if (compensationPending) {
      ctx.feedback.setError('Save the restored Testware again before leaving.')
      return
    }
    ctx.feedback.setNotice('Testware changes discarded')
  }

  function requestDeleteDraft(draft: Draft) {
    ctx.deletion.setDeleteConfirmation({ kind: 'draft', draft })
  }

  async function handleDeleteDraft(draft: Draft) {
    const previousIntent = intents.get(draft.id)
    const deletionGeneration = coordination.reserveDraftIntent(draft.id, 'delete')
    let deleted = false
    try {
      ctx.feedback.setBusyAction(`delete-draft:${draft.id}`)
      ctx.feedback.setError(null)
      await deleteDraft(draft.id)
      deleted = true
      ctx.invalidateDraftLoads()
      removeDeletedDraftFromWorkspace(draft)
      const attachmentsSettled = await coordination.settleImportedRecordAttachments({ kind: 'draft', id: draft.id }, null)
      ctx.feedback.setNotice(attachmentsSettled
        ? 'Testware deleted'
        : 'Testware deleted; image cleanup will retry before closing')
      await ctx.loaders.loadDraftsForSession(draft.sessionId, { force: true, replace: true })
    } catch (cause) {
      if (!deleted && intents.get(draft.id)?.generation === deletionGeneration) {
        if (previousIntent) intents.set(draft.id, previousIntent)
        else intents.delete(draft.id)
      }
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  function removeDeletedDraftFromWorkspace(draft: Draft) {
    ctx.records.dirtyDraftIdsRef.current.delete(draft.id)
    ctx.records.savedDraftsRef.current = ctx.records.savedDraftsRef.current.filter((item) => item.id !== draft.id)
    if (ctx.session.activeSessionIdRef.current !== draft.sessionId) return
    const wasVisible = ctx.records.draftsRef.current.some((item) => item.id === draft.id)
    const next = ctx.records.draftsRef.current.filter((item) => item.id !== draft.id)
    ctx.records.draftsRef.current = next
    ctx.records.setDrafts(next)
    if (wasVisible && draft.kind === 'testware') {
      ctx.records.setTestwareDraftCount((count) => Math.max(0, count - 1))
    }
  }

  return {
    canonicalizeGeneratedDraft,
    discardLocalDraft,
    handleDeleteDraft,
    handleSaveDraft,
    persistDraft,
    requestDeleteDraft,
    updateLocalDraft,
  }
}
