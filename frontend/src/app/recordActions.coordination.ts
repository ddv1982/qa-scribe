import { updateDraft, updateFinding, type Draft, type Finding } from '../tauri'
import {
  managedAttachmentImagesInDocument,
  richEditorDocumentFromStoredBody,
  type StoredRichBody,
} from '../editor/editorDocument'
import { formatError } from '../ui/format'
import type { InlineImageMaterialization } from './attachmentActions'
import type { RecordActionsContext } from './recordActions'

export type RecordAttachmentOwner = { kind: 'draft' | 'finding'; id: string }

type RecordIntent<T> = {
  generation: number
  kind: 'save' | 'discard' | 'canonicalize' | 'delete'
  restore: T | null
  compensationPending?: boolean
}

export function createRecordActionCoordination(ctx: RecordActionsContext) {
  const draftIntents = new Map<string, RecordIntent<Draft>>()
  const findingIntents = new Map<string, RecordIntent<Finding>>()
  const pendingImportedAttachmentIds = new Map<string, Set<string>>()
  const pendingWriteOperations = new Set<Promise<unknown>>()

  function attachmentOwnerKey(owner: RecordAttachmentOwner) {
    return `${owner.kind}:${owner.id}`
  }

  function registerImportedRecordAttachment(owner: RecordAttachmentOwner, attachmentId: string) {
    const key = attachmentOwnerKey(owner)
    const pending = pendingImportedAttachmentIds.get(key) ?? new Set<string>()
    pending.add(attachmentId)
    pendingImportedAttachmentIds.set(key, pending)
  }

  async function settleImportedRecordAttachments(
    owner: RecordAttachmentOwner,
    record: StoredRichBody | null,
  ): Promise<boolean> {
    const key = attachmentOwnerKey(owner)
    const pending = pendingImportedAttachmentIds.get(key)
    if (!pending?.size) return true
    const attachmentIds = Array.from(pending)
    const staleIds = attachmentsNotReferencedByRecord(attachmentIds, record)
    if (!await ctx.cleanupMaterializedAttachments(staleIds)) return false
    for (const attachmentId of attachmentIds) pending.delete(attachmentId)
    if (pending.size === 0) pendingImportedAttachmentIds.delete(key)
    return true
  }

  function trackWrite<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() => pendingWriteOperations.delete(tracked))
    pendingWriteOperations.add(tracked)
    return tracked
  }

  async function waitForPendingRecordWrites(): Promise<void> {
    while (pendingWriteOperations.size > 0) {
      await Promise.allSettled(Array.from(pendingWriteOperations))
    }
  }

  function reserveDraftIntent(id: string, kind: RecordIntent<Draft>['kind'], restore: Draft | null = null) {
    const previous = draftIntents.get(id)
    const intent: RecordIntent<Draft> = {
      generation: (previous?.generation ?? 0) + 1,
      kind,
      restore: kind === 'save' ? restore ?? previous?.restore ?? null : restore,
      compensationPending: kind === 'save' ? previous?.compensationPending : undefined,
    }
    draftIntents.set(id, intent)
    return intent.generation
  }

  function reserveFindingIntent(id: string, kind: RecordIntent<Finding>['kind'], restore: Finding | null = null) {
    const previous = findingIntents.get(id)
    const intent: RecordIntent<Finding> = {
      generation: (previous?.generation ?? 0) + 1,
      kind,
      restore: kind === 'save' ? restore ?? previous?.restore ?? null : restore,
      compensationPending: kind === 'save' ? previous?.compensationPending : undefined,
    }
    findingIntents.set(id, intent)
    return intent.generation
  }

  function markDraftCompensationPending(draft: Draft, cause: unknown) {
    const intent = draftIntents.get(draft.id)
    if (intent) intent.compensationPending = true
    if (ctx.session.activeSessionIdRef.current !== draft.sessionId) {
      ctx.feedback.setError(`Could not reconcile the latest Testware write. ${formatError(cause)}`)
      return
    }
    const hasNewerLocalEdit = ctx.records.dirtyDraftIdsRef.current.has(draft.id)
    ctx.records.dirtyDraftIdsRef.current.add(draft.id)
    if (!hasNewerLocalEdit) {
      ctx.records.setDrafts((previous) => {
        const next = replaceRecord(previous, draft)
        ctx.records.draftsRef.current = next
        return next
      })
    }
    ctx.feedback.setError(`Could not reconcile the latest Testware write. ${formatError(cause)}`)
  }

  function markFindingCompensationPending(finding: Finding, cause: unknown) {
    const intent = findingIntents.get(finding.id)
    if (intent) intent.compensationPending = true
    if (ctx.session.activeSessionIdRef.current !== finding.sessionId) {
      ctx.feedback.setError(`Could not reconcile the latest Finding write. ${formatError(cause)}`)
      return
    }
    const hasNewerLocalEdit = ctx.records.dirtyFindingIdsRef.current.has(finding.id)
    ctx.records.dirtyFindingIdsRef.current.add(finding.id)
    if (!hasNewerLocalEdit) {
      ctx.records.setFindings((previous) => {
        const next = replaceRecord(previous, finding)
        ctx.records.findingsRef.current = next
        return next
      })
    }
    ctx.feedback.setError(`Could not reconcile the latest Finding write. ${formatError(cause)}`)
  }

  async function reconcileDraftIntent(id: string): Promise<boolean> {
    const intent = draftIntents.get(id)
    if (!intent?.restore) return true
    try {
      const restored = await trackWrite(updateDraft(id, draftPersistencePatch(intent.restore)))
      if (draftIntents.get(id) !== intent) return reconcileDraftIntent(id)
      if (ctx.session.activeSessionIdRef.current === restored.sessionId) {
        ctx.records.savedDraftsRef.current = replaceRecord(ctx.records.savedDraftsRef.current, restored)
      }
      const hasNewerLocalEdit = ctx.records.dirtyDraftIdsRef.current.has(id)
      if (ctx.session.activeSessionIdRef.current === restored.sessionId && !hasNewerLocalEdit) {
        ctx.records.setDrafts((previous) => {
          const next = replaceRecord(previous, restored)
          ctx.records.draftsRef.current = next
          return next
        })
      }
      if (!hasNewerLocalEdit) ctx.records.dirtyDraftIdsRef.current.delete(id)
      intent.compensationPending = false
      return true
    } catch (cause) {
      if (draftIntents.get(id) !== intent) return reconcileDraftIntent(id)
      markDraftCompensationPending(intent.restore, cause)
      return false
    }
  }

  async function reconcileFindingIntent(id: string): Promise<boolean> {
    const intent = findingIntents.get(id)
    if (!intent?.restore) return true
    try {
      const restored = await trackWrite(updateFinding(id, findingPersistencePatch(intent.restore)))
      if (findingIntents.get(id) !== intent) return reconcileFindingIntent(id)
      if (ctx.session.activeSessionIdRef.current === restored.sessionId) {
        ctx.records.savedFindingsRef.current = replaceRecord(ctx.records.savedFindingsRef.current, restored)
      }
      const hasNewerLocalEdit = ctx.records.dirtyFindingIdsRef.current.has(id)
      if (ctx.session.activeSessionIdRef.current === restored.sessionId && !hasNewerLocalEdit) {
        ctx.records.setFindings((previous) => {
          const next = replaceRecord(previous, restored)
          ctx.records.findingsRef.current = next
          return next
        })
      }
      if (!hasNewerLocalEdit) ctx.records.dirtyFindingIdsRef.current.delete(id)
      intent.compensationPending = false
      return true
    } catch (cause) {
      if (findingIntents.get(id) !== intent) return reconcileFindingIntent(id)
      markFindingCompensationPending(intent.restore, cause)
      return false
    }
  }

  async function retryPendingRecordCompensations(sessionId: string): Promise<boolean> {
    for (const [id, intent] of draftIntents) {
      if (intent.restore?.sessionId !== sessionId || !intent.compensationPending) continue
      if (!await reconcileDraftIntent(id)) return false
    }
    for (const [id, intent] of findingIntents) {
      if (intent.restore?.sessionId !== sessionId || !intent.compensationPending) continue
      if (!await reconcileFindingIntent(id)) return false
    }
    return true
  }

  function hasPendingRecordCompensations(): boolean {
    return pendingWriteOperations.size > 0
      || Array.from(draftIntents.values()).some((intent) => intent.compensationPending)
      || Array.from(findingIntents.values()).some((intent) => intent.compensationPending)
  }

  async function retryAllPendingRecordCompensations(): Promise<boolean> {
    let reconciled = true
    for (const [id, intent] of draftIntents) {
      if (intent.compensationPending && !await reconcileDraftIntent(id)) reconciled = false
    }
    for (const [id, intent] of findingIntents) {
      if (intent.compensationPending && !await reconcileFindingIntent(id)) reconciled = false
    }
    return reconciled
  }

  async function materializeRecordBody(
    record: StoredRichBody,
    isCurrent: () => boolean,
  ): Promise<InlineImageMaterialization> {
    const document = richEditorDocumentFromStoredBody(record)
    return ctx.materializeInlineImages(document, { entryId: null, isCurrent })
  }

  return {
    attachmentsNotReferencedByRecord,
    draftIntents,
    draftPersistencePatch,
    findingIntents,
    findingPersistencePatch,
    hasPendingRecordCompensations,
    markDraftCompensationPending,
    markFindingCompensationPending,
    materializeRecordBody,
    reconcileDraftIntent,
    reconcileFindingIntent,
    registerImportedRecordAttachment,
    replaceRecord,
    reserveDraftIntent,
    reserveFindingIntent,
    retryAllPendingRecordCompensations,
    retryPendingRecordCompensations,
    settleImportedRecordAttachments,
    trackWrite,
    waitForPendingRecordWrites,
  }
}

export type RecordActionCoordination = ReturnType<typeof createRecordActionCoordination>

function replaceRecord<T extends { id: string }>(records: T[], saved: T): T[] {
  return records.some((record) => record.id === saved.id)
    ? records.map((record) => record.id === saved.id ? saved : record)
    : [saved, ...records]
}

function draftPersistencePatch(draft: Pick<Draft, 'title' | 'body' | 'bodyJson' | 'bodyFormat'>) {
  return {
    title: draft.title,
    body: draft.body,
    bodyJson: draft.bodyJson,
    bodyFormat: draft.bodyFormat,
  }
}

function findingPersistencePatch(finding: Finding) {
  return {
    ...draftPersistencePatch(finding),
    kind: finding.kind,
    metadataJson: finding.metadataJson,
  }
}

function attachmentsNotReferencedByRecord(
  attachmentIds: string[],
  record: StoredRichBody | null | undefined,
): string[] {
  if (!record) return attachmentIds
  const referencedIds = new Set(
    managedAttachmentImagesInDocument(richEditorDocumentFromStoredBody(record))
      .map((image) => image.attachmentId),
  )
  return attachmentIds.filter((id) => !referencedIds.has(id))
}
