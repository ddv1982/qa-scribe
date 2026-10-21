import { createDraft, createFinding, type Draft, type Finding, type Session } from '../tauri'
import {
  emptyRichEditorDocument,
  richEditorDocumentFromHtml,
  richEditorDocumentToStoredBody,
  type RichEditorDocument,
} from '../editor/editorDocument'
import { formatError, nextUntitledRecordTitle } from '../ui/format'
import type { BusyAction } from '../ui/types'
import { renderPrefilledFinding, renderPrefilledTestware } from '../workflows/prefillTemplates'
import type { RecordPersistence, RecordPersistenceContext } from './recordPersistence'
import { createDraftRecordActions } from './recordActions.drafts'
import { createFindingRecordActions } from './recordActions.findings'
import type {
  DeletionWorkspace,
  CreatedRecordEditTarget,
  SessionWorkspace,
  WorkflowFeedback,
  WorkflowNavigation,
} from './types'
import { useStableCapability } from './useStableCapability'

export type RecordLoaders = {
  loadDraftsForSession: (sessionId: string, options?: { force?: boolean; replace?: boolean }) => Promise<Draft[]>
  loadFindingsForSession: (sessionId: string, options?: { force?: boolean; replace?: boolean }) => Promise<Finding[]>
}

export type RecordActionsContext = Omit<RecordPersistenceContext, 'session'> & {
  session: Pick<SessionWorkspace, 'activeSession' | 'activeSessionIdRef' | 'noteBodyHtml'>
  feedback: WorkflowFeedback
  navigation: WorkflowNavigation
  deletion: DeletionWorkspace
  saveNoteNow: (options?: { manageBusy?: boolean }) => Promise<boolean>
  registerRecordEditIntent: () => void
  handleDeleteSession: (session: Session) => Promise<void>
  invalidateDraftLoads: () => void
  invalidateFindingLoads: () => void
  loaders: RecordLoaders
  beginSessionNavigation: () => number
  sessionNavigationIsCurrent: (epoch: number) => boolean
  openCreatedRecord: (target: CreatedRecordEditTarget, epoch: number) => Promise<void>
}

export function createRecordActions(ctx: RecordActionsContext, persistence: RecordPersistence) {
  const { coordination, saveDirtyRecordsNow } = persistence
  const draftActions = createDraftRecordActions(ctx, coordination, persistence.drafts)
  const findingActions = createFindingRecordActions(ctx, coordination, persistence.findings)
  let creationEpoch: number | null = null

  async function createRecordFromNote(
    sessionId: string,
    kind: CreatedRecordEditTarget['kind'],
    busy: BusyAction,
    bodyDocument: RichEditorDocument,
    untitledTitle: string,
    loadExistingTitles: () => Promise<Array<{ title: string }>>,
    create: (title: string, body: ReturnType<typeof richEditorDocumentToStoredBody>) => Promise<{ id: string }>,
    refresh: () => Promise<void>,
    successNotice: string,
  ) {
    const epoch = ctx.beginSessionNavigation()
    creationEpoch = epoch
    const isCurrent = () => ctx.session.activeSessionIdRef.current === sessionId && ctx.sessionNavigationIsCurrent(epoch)
    try {
      ctx.feedback.setBusyAction(busy)
      ctx.feedback.setError(null)
      const saved = await ctx.saveNoteNow({ manageBusy: false })
      if (!saved || !isCurrent()) return
      const existingTitles = await loadExistingTitles()
      if (!isCurrent()) return
      const created = await create(nextUntitledRecordTitle(existingTitles, untitledTitle), richEditorDocumentToStoredBody(bodyDocument))
      if (ctx.session.activeSessionIdRef.current !== sessionId) return
      await refresh()
      if (!isCurrent()) return
      await ctx.openCreatedRecord({ sessionId, kind, recordId: created.id }, epoch)
      if (isCurrent()) ctx.feedback.setNotice(successNotice)
    } catch (cause) {
      if (isCurrent()) ctx.feedback.setError(formatError(cause))
    } finally {
      if (creationEpoch === epoch) ctx.feedback.setBusyAction((current) => current === busy ? null : current)
    }
  }

  async function handleManualTestware() {
    if (!ctx.session.activeSession) return
    const session = ctx.session.activeSession
    await createRecordFromNote(
      session.id, 'testware',
      'manual-testware',
      emptyRichEditorDocument,
      'Untitled testware',
      async () => (await ctx.loaders.loadDraftsForSession(session.id)).filter((draft) => draft.kind === 'testware'),
      (title, body) => createDraft({ sessionId: session.id, aiRunId: null, kind: 'testware', title, ...body, metadataJson: null }),
      async () => {
        await ctx.loaders.loadDraftsForSession(session.id, { force: true, replace: true })
      },
      'Manual testware created',
    )
  }

  async function handlePrefillTestwareFromNote() {
    if (!ctx.session.activeSession) return
    const session = ctx.session.activeSession
    await createRecordFromNote(
      session.id, 'testware',
      'prefill-testware',
      richEditorDocumentFromHtml(renderPrefilledTestware(session.title, ctx.session.noteBodyHtml)),
      'Untitled testware',
      async () => (await ctx.loaders.loadDraftsForSession(session.id)).filter((draft) => draft.kind === 'testware'),
      (title, body) => createDraft({ sessionId: session.id, aiRunId: null, kind: 'testware', title, ...body, metadataJson: null }),
      async () => {
        await ctx.loaders.loadDraftsForSession(session.id, { force: true, replace: true })
      },
      'Testware prefilled from note',
    )
  }

  async function handleManualFinding() {
    if (!ctx.session.activeSession) return
    const session = ctx.session.activeSession
    await createRecordFromNote(
      session.id, 'finding',
      'manual-finding',
      emptyRichEditorDocument,
      'Untitled finding',
      async () => ctx.loaders.loadFindingsForSession(session.id),
      (title, body) => createFinding({ sessionId: session.id, title, ...body, kind: 'bug', metadataJson: null }),
      async () => {
        await ctx.loaders.loadFindingsForSession(session.id, { force: true, replace: true })
      },
      'Manual finding created',
    )
  }

  async function handlePrefillFindingFromNote() {
    if (!ctx.session.activeSession) return
    const session = ctx.session.activeSession
    await createRecordFromNote(
      session.id, 'finding',
      'prefill-finding',
      richEditorDocumentFromHtml(renderPrefilledFinding(ctx.session.noteBodyHtml)),
      'Untitled finding',
      async () => ctx.loaders.loadFindingsForSession(session.id),
      (title, body) => createFinding({ sessionId: session.id, title, ...body, kind: 'bug', metadataJson: null }),
      async () => {
        await ctx.loaders.loadFindingsForSession(session.id, { force: true, replace: true })
      },
      'Finding prefilled from note',
    )
  }

  function discardAllDirtyRecords() {
    const dirtyDraftIds = new Set(ctx.records.dirtyDraftIdsRef.current)
    const dirtyFindingIds = new Set(ctx.records.dirtyFindingIdsRef.current)
    const savedDrafts = new Map(ctx.records.savedDraftsRef.current.map((draft) => [draft.id, draft]))
    const savedFindings = new Map(ctx.records.savedFindingsRef.current.map((finding) => [finding.id, finding]))
    const pendingDraftIds = new Set(Array.from(dirtyDraftIds).filter((id) => coordination.draftIntents.get(id)?.compensationPending))
    const pendingFindingIds = new Set(Array.from(dirtyFindingIds).filter((id) => coordination.findingIntents.get(id)?.compensationPending))
    for (const id of dirtyDraftIds) if (!pendingDraftIds.has(id)) coordination.reserveDraftIntent(id, 'discard', savedDrafts.get(id) ?? null)
    for (const id of dirtyFindingIds) if (!pendingFindingIds.has(id)) coordination.reserveFindingIntent(id, 'discard', savedFindings.get(id) ?? null)
    ctx.records.dirtyDraftIdsRef.current.clear()
    ctx.records.dirtyFindingIdsRef.current.clear()
    for (const id of pendingDraftIds) ctx.records.dirtyDraftIdsRef.current.add(id)
    for (const id of pendingFindingIds) ctx.records.dirtyFindingIdsRef.current.add(id)
    for (const id of dirtyDraftIds) {
      void coordination.settleImportedRecordAttachments({ kind: 'draft', id }, savedDrafts.get(id) ?? null)
    }
    for (const id of dirtyFindingIds) {
      void coordination.settleImportedRecordAttachments({ kind: 'finding', id }, savedFindings.get(id) ?? null)
    }
    ctx.records.setDrafts((previous) => {
      const next = previous
        .filter((draft) => !dirtyDraftIds.has(draft.id) || savedDrafts.has(draft.id))
        .map((draft) => dirtyDraftIds.has(draft.id) ? savedDrafts.get(draft.id) ?? draft : draft)
      ctx.records.draftsRef.current = next
      return next
    })
    ctx.records.setFindings((previous) => {
      const next = previous
        .filter((finding) => !dirtyFindingIds.has(finding.id) || savedFindings.has(finding.id))
        .map((finding) => dirtyFindingIds.has(finding.id) ? savedFindings.get(finding.id) ?? finding : finding)
      ctx.records.findingsRef.current = next
      return next
    })
    if (pendingDraftIds.size > 0 || pendingFindingIds.size > 0) {
      ctx.feedback.setError('A failed Record reconciliation must be saved again before leaving.')
      return
    }
    ctx.feedback.setNotice('Pending record changes discarded')
  }

  async function confirmDelete() {
    const confirmation = ctx.deletion.deleteConfirmation
    if (!confirmation) return

    ctx.deletion.setDeleteConfirmation(null)
    if (confirmation.kind === 'session') {
      await ctx.handleDeleteSession(confirmation.session)
    } else if (confirmation.kind === 'draft') {
      await draftActions.handleDeleteDraft(confirmation.draft)
    } else {
      await findingActions.handleDeleteFinding(confirmation.finding)
    }
  }

  return {
    confirmDelete,
    canonicalizeGeneratedDraft: draftActions.canonicalizeGeneratedDraft,
    canonicalizeGeneratedFinding: findingActions.canonicalizeGeneratedFinding,
    discardLocalDraft: draftActions.discardLocalDraft,
    discardLocalFinding: findingActions.discardLocalFinding,
    discardAllDirtyRecords,
    handleManualFinding,
    handleManualTestware,
    handlePrefillFindingFromNote,
    handlePrefillTestwareFromNote,
    hasPendingRecordCompensations: coordination.hasPendingRecordCompensations,
    saveDirtyRecordsNow,
    handleSaveDraft: draftActions.handleSaveDraft,
    handleSaveFinding: findingActions.handleSaveFinding,
    requestDeleteDraft: draftActions.requestDeleteDraft,
    requestDeleteFinding: findingActions.requestDeleteFinding,
    retryAllPendingRecordCompensations: coordination.retryAllPendingRecordCompensations,
    retryPendingRecordCompensations: coordination.retryPendingRecordCompensations,
    updateLocalDraft: draftActions.updateLocalDraft,
    updateLocalFinding: findingActions.updateLocalFinding,
    waitForPendingRecordWrites: coordination.waitForPendingRecordWrites,
  }
}

export function useRecordActions(ctx: RecordActionsContext, persistence: RecordPersistence) {
  return useStableCapability(ctx, (current) => createRecordActions(current, persistence))
}
