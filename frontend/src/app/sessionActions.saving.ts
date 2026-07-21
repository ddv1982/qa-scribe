import {
  emptyRichEditorDocument,
  managedAttachmentImagesInDocument,
  parseRichEditorDocument,
  serializeRichEditorDocument,
  type RichEditorDocument,
} from '../editor/editorDocument'
import { formatError } from '../ui/format'
import type { SessionActionsContext } from './sessionActions'
import type { SessionWriteActions } from './sessionActions.writes'

export function createSessionSaveActions(ctx: SessionActionsContext, writes: SessionWriteActions) {
  const pendingImportedAttachmentIds = new Map<string, Set<string>>()

  function rememberImportedAttachments(entryId: string, attachmentIds: string[]) {
    if (attachmentIds.length === 0) return
    const pending = pendingImportedAttachmentIds.get(entryId) ?? new Set<string>()
    for (const id of attachmentIds) pending.add(id)
    pendingImportedAttachmentIds.set(entryId, pending)
  }

  function registerImportedNoteAttachment(entryId: string, attachmentId: string) {
    rememberImportedAttachments(entryId, [attachmentId])
  }

  function clearPendingImportedAttachments(entryId: string) {
    pendingImportedAttachmentIds.delete(entryId)
  }

  function markReferencedAttachmentsSaved(entryId: string, body: RichEditorDocument) {
    const pending = pendingImportedAttachmentIds.get(entryId)
    if (!pending) return
    for (const image of managedAttachmentImagesInDocument(body)) pending.delete(image.attachmentId)
    if (pending.size === 0) pendingImportedAttachmentIds.delete(entryId)
  }

  async function cleanupPendingAttachmentsNotIn(entryId: string, body: RichEditorDocument): Promise<boolean> {
    const pending = pendingImportedAttachmentIds.get(entryId)
    if (!pending?.size) return true
    const retained = new Set(managedAttachmentImagesInDocument(body).map((image) => image.attachmentId))
    const stale = Array.from(pending).filter((id) => !retained.has(id))
    if (!await ctx.cleanupMaterializedAttachments(stale)) return false
    for (const id of stale) pending.delete(id)
    if (pending.size === 0) pendingImportedAttachmentIds.delete(entryId)
    return true
  }

  async function savePendingSessionEdits(): Promise<boolean> {
    if (ctx.session.forcedPendingSaveRef.current) return ctx.session.forcedPendingSaveRef.current

    const pending = flushPendingSessionEdits().finally(() => {
      if (ctx.session.forcedPendingSaveRef.current === pending) {
        ctx.session.forcedPendingSaveRef.current = null
      }
    })
    ctx.session.forcedPendingSaveRef.current = pending
    return pending
  }

  async function flushPendingSessionEdits(): Promise<boolean> {
    ctx.session.suppressAmbientNoteSaveRef.current = true
    try {
      do {
        const flushedNote = await saveNoteNow({ manageBusy: false })
        if (!flushedNote) return false
        const flushedRecords = await ctx.saveDirtyRecordsNow()
        if (!flushedRecords) return false
      } while (hasPendingSessionEdits())
      return true
    } finally {
      ctx.session.suppressAmbientNoteSaveRef.current = false
    }
  }

  function hasPendingSessionEdits(): boolean {
    const titleDirty = Boolean(
      ctx.session.activeSession
      && ctx.session.sessionTitleRef.current !== ctx.session.savedTitleRef.current,
    )
    const bodyDirty = Boolean(
      ctx.session.noteEntry
      && serializeRichEditorDocument(ctx.session.noteBodyRef.current) !== ctx.session.savedBodyRef.current,
    )
    return titleDirty
      || bodyDirty
      || ctx.records.dirtyDraftIdsRef.current.size > 0
      || ctx.records.dirtyFindingIdsRef.current.size > 0
  }

  function discardPendingSessionEdits(): boolean | Promise<boolean> {
    ctx.session.sessionTitleWriteVersionRef.current += 1
    const activeSessionId = ctx.session.activeSessionIdRef.current
    if (activeSessionId) {
      writes.discardTitleEditIntent(activeSessionId, ctx.session.savedTitleRef.current)
    }
    ctx.feedback.setBusyAction((current) => (
      current === 'save-title' || current === 'save-body' || current === 'undo-generation' ? null : current
    ))
    ctx.session.setSessionTitle(ctx.session.savedTitleRef.current)
    const recoveryDecision = ctx.latestNoteGenerationUndoRef.current
    if (
      recoveryDecision?.pendingRecoveryDecision
      && recoveryDecision.generated
      && recoveryDecision.entryId === ctx.session.noteEntryIdRef.current
    ) {
      writes.selectRecoveredSummaryChoice('generated')
      const generatedDecision = ctx.latestNoteGenerationUndoRef.current!
      const generated = recoveryDecision.generated
      const canonicalGenerated = recoveryDecision.generatedCanonical ?? generated
      ctx.session.savedBodyRef.current = serializeRichEditorDocument(canonicalGenerated)
      writes.reserveNoteWrite(generated, recoveryDecision.entryId, ctx.session.activeSessionIdRef.current!)
      ctx.session.setNoteBody(generated)
      const finishDiscard = async (saved: boolean) => {
        if (!saved) return false
        markReferencedAttachmentsSaved(recoveryDecision.entryId, generated)
        if (!await cleanupPendingAttachmentsNotIn(recoveryDecision.entryId, generated)) return false
        if (ctx.latestNoteGenerationUndoRef.current === generatedDecision) {
          ctx.generation.setLatestNoteGenerationUndo(null)
        }
        return true
      }
      if (serializeRichEditorDocument(generated) !== ctx.session.savedBodyRef.current) {
        return writes.saveBody(generated).then(finishDiscard)
      }
      return finishDiscard(true)
    }
    writes.supersedeNoteWritesWithCurrentSavedBody()
    const savedBody = parseRichEditorDocument(ctx.session.savedBodyRef.current) ?? emptyRichEditorDocument
    ctx.session.setNoteBody(savedBody)
    const entryId = ctx.session.noteEntryIdRef.current
    return entryId ? cleanupPendingAttachmentsNotIn(entryId, savedBody) : true
  }

  async function saveNoteNow(options: { manageBusy?: boolean } = {}): Promise<boolean> {
    const { manageBusy = true } = options
    const title = ctx.session.sessionTitleRef.current
    const titleDirty = Boolean(ctx.session.activeSession && title !== ctx.session.savedTitleRef.current)
    let recoveryDecision = ctx.latestNoteGenerationUndoRef.current
    const pendingRecoveryDecision = Boolean(
      recoveryDecision?.pendingRecoveryDecision
      && recoveryDecision.generated
      && recoveryDecision.entryId === ctx.session.noteEntry?.id,
    )
    const bodyDirty = pendingRecoveryDecision || Boolean(
      ctx.session.noteEntry
      && serializeRichEditorDocument(ctx.session.noteBodyRef.current) !== ctx.session.savedBodyRef.current,
    )
    if (!titleDirty && !bodyDirty) return true

    let saved = true
    if (titleDirty) {
      saved = (await writes.saveTitle(title, { manageBusy })) && saved
    }
    if (bodyDirty && ctx.session.noteEntry) {
      if (writes.noteSaveIsBlocked(ctx.session.noteEntry.sessionId)) return false
      const entryId = ctx.session.noteEntry.id
      const sessionId = ctx.session.noteEntry.sessionId
      const visibleBodySerialized = serializeRichEditorDocument(ctx.session.noteBodyRef.current)
      const sourceBody = pendingRecoveryDecision
        ? recoveryDecision!.pendingRecoveryChoice === 'generated'
          ? recoveryDecision!.generated!
          : recoveryDecision!.before
        : ctx.session.noteBodyRef.current
      // Reserve the write before image imports start. Discard, navigation, or a
      // newer save can now invalidate both materialization and the later save.
      const writeVersion = ++ctx.session.noteBodyWriteVersionRef.current
      writes.reserveNoteWrite(sourceBody, entryId, sessionId, { version: writeVersion })
      if (manageBusy) ctx.feedback.setBusyAction('save-body')
      const releaseBusy = () => {
        if (manageBusy && writeVersion === ctx.session.noteBodyWriteVersionRef.current) {
          ctx.feedback.setBusyAction(null)
        }
      }
      let body: RichEditorDocument
      let importedAttachmentIds: string[]
      try {
        const materialized = await ctx.materializeInlineImages(sourceBody, {
          entryId,
          isCurrent: () => (
            writeVersion === ctx.session.noteBodyWriteVersionRef.current
            && entryId === ctx.session.noteEntryIdRef.current
            && sessionId === ctx.session.activeSessionIdRef.current
            && serializeRichEditorDocument(ctx.session.noteBodyRef.current) === visibleBodySerialized
            && (!pendingRecoveryDecision || ctx.latestNoteGenerationUndoRef.current === recoveryDecision)
          ),
        })
        body = materialized.document
        importedAttachmentIds = materialized.importedAttachmentIds
      } catch (cause) {
        if (writeVersion !== ctx.session.noteBodyWriteVersionRef.current) return true
        ctx.feedback.setError(formatError(cause))
        releaseBusy()
        return false
      }
      if (
        writeVersion !== ctx.session.noteBodyWriteVersionRef.current
        || entryId !== ctx.session.noteEntryIdRef.current
        || sessionId !== ctx.session.activeSessionIdRef.current
        || serializeRichEditorDocument(ctx.session.noteBodyRef.current) !== visibleBodySerialized
        || (pendingRecoveryDecision && ctx.latestNoteGenerationUndoRef.current !== recoveryDecision)
      ) {
        if (!await ctx.cleanupMaterializedAttachments(importedAttachmentIds)) return false
        releaseBusy()
        return true
      }

      // Materialization is pure with respect to Note state. Commit its result
      // only after the reserved intent is still known to be current.
      if (pendingRecoveryDecision) {
        if (importedAttachmentIds.length > 0) {
          recoveryDecision = {
            ...recoveryDecision!,
            [recoveryDecision!.pendingRecoveryChoice === 'generated' ? 'generated' : 'before']: body,
          }
          ctx.latestNoteGenerationUndoRef.current = recoveryDecision
          ctx.generation.setLatestNoteGenerationUndo(recoveryDecision)
        }
        ctx.session.savedBodyRef.current = serializeRichEditorDocument(
          recoveryDecision!.generatedCanonical ?? recoveryDecision!.generated!,
        )
      }
      rememberImportedAttachments(entryId, importedAttachmentIds)
      ctx.session.setNoteBody(body)
      const bodySaved = await writes.saveBody(body, {
        manageBusy: false,
        writeVersion,
        entryId,
        sessionId,
        expectedCurrentBody: serializeRichEditorDocument(body),
      })
      if (writeVersion !== ctx.session.noteBodyWriteVersionRef.current) {
        const currentAttachmentIds = new Set(
          managedAttachmentImagesInDocument(ctx.session.noteBodyRef.current)
            .map((image) => image.attachmentId),
        )
        const staleAttachmentIds = importedAttachmentIds.filter((id) => !currentAttachmentIds.has(id))
        if (!await ctx.cleanupMaterializedAttachments(staleAttachmentIds)) return false
      }
      let attachmentsCleaned = true
      if (bodySaved) {
        markReferencedAttachmentsSaved(entryId, body)
        attachmentsCleaned = await cleanupPendingAttachmentsNotIn(entryId, body)
      }
      saved = bodySaved && attachmentsCleaned && saved
      if (
        saved
        && pendingRecoveryDecision
        && writeVersion === ctx.session.noteBodyWriteVersionRef.current
        && ctx.latestNoteGenerationUndoRef.current === recoveryDecision
        && ctx.session.savedBodyRef.current === serializeRichEditorDocument(body)
      ) ctx.generation.setLatestNoteGenerationUndo(null)
      releaseBusy()
    }
    return saved
  }

  return {
    clearPendingImportedAttachments,
    discardPendingSessionEdits,
    hasPendingSessionEdits,
    registerImportedNoteAttachment,
    saveNoteNow,
    savePendingSessionEdits,
  }
}
