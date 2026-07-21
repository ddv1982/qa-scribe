import { createDraft, createFinding, type Draft, type Finding, type Session } from '../tauri'
import {
  emptyRichEditorDocument,
  richEditorDocumentFromHtml,
  richEditorDocumentToStoredBody,
  type RichEditorDocument,
} from '../editor/editorDocument'
import { formatError, nextUntitledRecordTitle } from '../ui/format'
import type { BusyAction, MainView } from '../ui/types'
import { renderPrefilledFinding, renderPrefilledTestware } from '../workflows/prefillTemplates'
import type { InlineImageMaterialization } from './attachmentActions'
import { createRecordActionCoordination } from './recordActions.coordination'
import { createDraftRecordActions } from './recordActions.drafts'
import { createFindingRecordActions } from './recordActions.findings'
import type {
  DeletionWorkspace,
  RecordWorkspace,
  SessionWorkspace,
  WorkflowFeedback,
  WorkflowNavigation,
} from './types'
import { useStableCapability } from './useStableCapability'

export type RecordLoaders = {
  loadDraftsForSession: (sessionId: string, options?: { force?: boolean; replace?: boolean }) => Promise<Draft[]>
  loadFindingsForSession: (sessionId: string, options?: { force?: boolean; replace?: boolean }) => Promise<Finding[]>
}

type InlineImageMaterializer = (
  document: RichEditorDocument,
  options?: { entryId?: string | null; isCurrent?: () => boolean },
) => Promise<InlineImageMaterialization>

export type RecordActionsContext = {
  session: Pick<SessionWorkspace, 'activeSession' | 'activeSessionIdRef' | 'noteBodyHtml'>
  records: Pick<
    RecordWorkspace,
    | 'dirtyDraftIdsRef'
    | 'dirtyFindingIdsRef'
    | 'draftsRef'
    | 'findingsRef'
    | 'savedDraftsRef'
    | 'savedFindingsRef'
    | 'setDrafts'
    | 'setFindings'
    | 'setTestwareDraftCount'
    | 'setFindingCount'
  >
  feedback: WorkflowFeedback
  navigation: WorkflowNavigation
  deletion: DeletionWorkspace
  saveNoteNow: (options?: { manageBusy?: boolean }) => Promise<boolean>
  registerRecordEditIntent: () => void
  handleDeleteSession: (session: Session) => Promise<void>
  materializeInlineImages: InlineImageMaterializer
  cleanupMaterializedAttachments: (attachmentIds: string[]) => Promise<boolean>
  invalidateDraftLoads: () => void
  invalidateFindingLoads: () => void
  loaders: RecordLoaders
}

export function createRecordActions(ctx: RecordActionsContext) {
  const coordination = createRecordActionCoordination(ctx)
  const draftActions = createDraftRecordActions(ctx, coordination)
  const findingActions = createFindingRecordActions(ctx, coordination)

  async function createRecordFromNote(
    busy: BusyAction,
    bodyDocument: RichEditorDocument,
    untitledTitle: string,
    loadExistingTitles: () => Promise<Array<{ title: string }>>,
    create: (title: string, body: ReturnType<typeof richEditorDocumentToStoredBody>) => Promise<unknown>,
    refresh: () => Promise<void>,
    view: MainView,
    successNotice: string,
  ) {
    try {
      ctx.feedback.setBusyAction(busy)
      ctx.feedback.setError(null)
      const saved = await ctx.saveNoteNow({ manageBusy: false })
      if (!saved) return
      const existingTitles = await loadExistingTitles()
      await create(nextUntitledRecordTitle(existingTitles, untitledTitle), richEditorDocumentToStoredBody(bodyDocument))
      await refresh()
      ctx.navigation.setActiveView(view)
      ctx.feedback.setNotice(successNotice)
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  async function handleManualTestware() {
    if (!ctx.session.activeSession) return
    const session = ctx.session.activeSession
    await createRecordFromNote(
      'manual-testware',
      emptyRichEditorDocument,
      'Untitled testware',
      async () => (await ctx.loaders.loadDraftsForSession(session.id)).filter((draft) => draft.kind === 'testware'),
      (title, body) => createDraft({ sessionId: session.id, aiRunId: null, kind: 'testware', title, ...body, metadataJson: null }),
      async () => {
        await ctx.loaders.loadDraftsForSession(session.id, { force: true, replace: true })
      },
      'testware',
      'Manual testware created',
    )
  }

  async function handlePrefillTestwareFromNote() {
    if (!ctx.session.activeSession) return
    const session = ctx.session.activeSession
    await createRecordFromNote(
      'prefill-testware',
      richEditorDocumentFromHtml(renderPrefilledTestware(session.title, ctx.session.noteBodyHtml)),
      'Untitled testware',
      async () => (await ctx.loaders.loadDraftsForSession(session.id)).filter((draft) => draft.kind === 'testware'),
      (title, body) => createDraft({ sessionId: session.id, aiRunId: null, kind: 'testware', title, ...body, metadataJson: null }),
      async () => {
        await ctx.loaders.loadDraftsForSession(session.id, { force: true, replace: true })
      },
      'testware',
      'Testware prefilled from note',
    )
  }

  async function handleManualFinding() {
    if (!ctx.session.activeSession) return
    const session = ctx.session.activeSession
    await createRecordFromNote(
      'manual-finding',
      emptyRichEditorDocument,
      'Untitled finding',
      async () => ctx.loaders.loadFindingsForSession(session.id),
      (title, body) => createFinding({ sessionId: session.id, title, ...body, kind: 'bug', metadataJson: null }),
      async () => {
        await ctx.loaders.loadFindingsForSession(session.id, { force: true, replace: true })
      },
      'findings',
      'Manual finding created',
    )
  }

  async function handlePrefillFindingFromNote() {
    if (!ctx.session.activeSession) return
    const session = ctx.session.activeSession
    await createRecordFromNote(
      'prefill-finding',
      richEditorDocumentFromHtml(renderPrefilledFinding(ctx.session.noteBodyHtml)),
      'Untitled finding',
      async () => ctx.loaders.loadFindingsForSession(session.id),
      (title, body) => createFinding({ sessionId: session.id, title, ...body, kind: 'bug', metadataJson: null }),
      async () => {
        await ctx.loaders.loadFindingsForSession(session.id, { force: true, replace: true })
      },
      'findings',
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

  async function saveDirtyRecordsNow(): Promise<boolean> {
    const dirtyDrafts = ctx.records.draftsRef.current.filter((draft) => ctx.records.dirtyDraftIdsRef.current.has(draft.id))
    const dirtyFindings = ctx.records.findingsRef.current.filter((finding) => ctx.records.dirtyFindingIdsRef.current.has(finding.id))
    if (dirtyDrafts.length === 0 && dirtyFindings.length === 0) return true

    let failed = false
    let allSaved = true
    for (const draft of dirtyDrafts) {
      const result = await draftActions.persistDraft(draft)
      failed = result === 'failed' || failed
      allSaved = result === 'saved' && allSaved
    }
    for (const finding of dirtyFindings) {
      const result = await findingActions.persistFinding(finding)
      failed = result === 'failed' || failed
      allSaved = result === 'saved' && allSaved
    }
    if (failed) return false
    if (allSaved) ctx.feedback.setNotice('Pending record edits saved')
    return true
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
    registerImportedRecordAttachment: coordination.registerImportedRecordAttachment,
    retryAllPendingRecordCompensations: coordination.retryAllPendingRecordCompensations,
    retryPendingRecordCompensations: coordination.retryPendingRecordCompensations,
    updateLocalDraft: draftActions.updateLocalDraft,
    updateLocalFinding: findingActions.updateLocalFinding,
    waitForPendingRecordWrites: coordination.waitForPendingRecordWrites,
  }
}

export function useRecordActions(ctx: RecordActionsContext) {
  return useStableCapability(ctx, createRecordActions)
}
