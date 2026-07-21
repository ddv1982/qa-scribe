import { deleteDraft, updateDraft, type Draft } from '../tauri'
import { richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { formatError } from '../ui/format'
import type { RichRecordPatch } from './types'
import type { RecordActionsContext } from './recordActions'
import type { RecordActionCoordination } from './recordActions.coordination'

type RecordPersistResult = 'saved' | 'superseded' | 'failed'

export function createDraftRecordActions(
  ctx: RecordActionsContext,
  coordination: RecordActionCoordination,
) {
  const intents = coordination.draftIntents

  async function persistDraft(draft: Draft): Promise<RecordPersistResult> {
    if (intents.get(draft.id)?.kind === 'delete') return 'superseded'
    const intentGeneration = coordination.reserveDraftIntent(draft.id, 'save')
    let importedAttachmentIds: string[] = []
    try {
      ctx.feedback.setError(null)
      const materialized = await coordination.materializeRecordBody(
        draft,
        () => intents.get(draft.id)?.generation === intentGeneration,
      )
      importedAttachmentIds = materialized.importedAttachmentIds
      if (intents.get(draft.id)?.generation !== intentGeneration) {
        return await ctx.cleanupMaterializedAttachments(importedAttachmentIds) ? 'superseded' : 'failed'
      }
      const storedBody = richEditorDocumentToStoredBody(materialized.document)
      const saved = await coordination.trackWrite(updateDraft(draft.id, { title: draft.title, ...storedBody }))
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
      return 'saved'
    } catch (cause) {
      await ctx.cleanupMaterializedAttachments(importedAttachmentIds)
      const latestIntent = intents.get(draft.id)
      const reconciled = !latestIntent?.restore || await coordination.reconcileDraftIntent(draft.id)
      if (reconciled) ctx.feedback.setError(formatError(cause))
      return 'failed'
    }
  }

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
    ctx.registerRecordEditIntent()
    ctx.records.dirtyDraftIdsRef.current.add(id)
    ctx.records.setDrafts((previous) => {
      const nextDrafts = previous.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft))
      ctx.records.draftsRef.current = nextDrafts
      return nextDrafts
    })
  }

  function discardLocalDraft(original: Draft) {
    if (intents.get(original.id)?.kind === 'delete') return
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

  async function canonicalizeGeneratedDraft(draft: Draft): Promise<void> {
    if (intents.get(draft.id)?.kind === 'delete') return
    const intentGeneration = coordination.reserveDraftIntent(draft.id, 'canonicalize', draft)
    ctx.records.savedDraftsRef.current = coordination.replaceRecord(ctx.records.savedDraftsRef.current, draft)
    try {
      const saved = await coordination.trackWrite(updateDraft(draft.id, coordination.draftPersistencePatch(draft)))
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
      const intent = intents.get(draft.id)
      if (intent?.generation !== intentGeneration) return
      coordination.markDraftCompensationPending(draft, cause)
    }
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

function draftEditableFieldsMatch(left: Draft, right: Draft): boolean {
  return (
    left.title === right.title &&
    left.body === right.body &&
    left.bodyJson === right.bodyJson &&
    left.bodyFormat === right.bodyFormat
  )
}
