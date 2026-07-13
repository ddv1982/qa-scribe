import {
  createDraft,
  createFinding,
  deleteDraft,
  deleteFinding,
  updateDraft,
  updateFinding,
  type Draft,
  type Finding,
  type Session,
} from '../tauri'
import {
  emptyRichEditorDocument,
  richEditorDocumentFromHtml,
  richEditorDocumentFromStoredBody,
  richEditorDocumentToStoredBody,
  type StoredRichBody,
  type RichEditorDocument,
} from '../editor/editorDocument'
import { formatError, nextUntitledRecordTitle } from '../ui/format'
import { renderPrefilledFinding, renderPrefilledTestware } from '../workflows/prefillTemplates'
import type { DeletionWorkspace, FindingRecordPatch, RecordWorkspace, RichRecordPatch, SessionWorkspace, WorkflowFeedback, WorkflowNavigation } from './types'
import { useStableCapability } from './useStableCapability'
import type { BusyAction, MainView } from '../ui/types'

export type RecordLoaders = {
  loadDraftsForSession: (sessionId: string, options?: { force?: boolean; replace?: boolean }) => Promise<Draft[]>
  loadFindingsForSession: (sessionId: string, options?: { force?: boolean; replace?: boolean }) => Promise<Finding[]>
}

type InlineImageMaterializer = (
  document: RichEditorDocument,
  options?: { entryId?: string | null; updateNoteBody?: boolean },
) => Promise<RichEditorDocument>

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
  >
  feedback: WorkflowFeedback
  navigation: WorkflowNavigation
  deletion: DeletionWorkspace
  saveNoteNow: (options?: { manageBusy?: boolean }) => Promise<boolean>
  handleDeleteSession: (session: Session) => Promise<void>
  materializeInlineImages: InlineImageMaterializer
  loaders: RecordLoaders
}

export function createRecordActions(ctx: RecordActionsContext) {
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

  async function persistDraft(draft: Draft): Promise<boolean> {
    try {
      ctx.feedback.setError(null)
      const storedBody = await materializeRecordBody(draft, ctx.materializeInlineImages)
      const saved = await updateDraft(draft.id, { title: draft.title, ...storedBody })
      const current = ctx.records.draftsRef.current.find((item) => item.id === draft.id)
      if (!current || !draftEditableFieldsMatch(current, draft)) return false
      ctx.records.dirtyDraftIdsRef.current.delete(saved.id)
      ctx.records.savedDraftsRef.current = replaceRecord(ctx.records.savedDraftsRef.current, saved)
      if (ctx.session.activeSessionIdRef.current === saved.sessionId) {
        ctx.records.setDrafts((previous) => {
          const nextDrafts = previous.map((item) => (item.id === saved.id ? saved : item))
          ctx.records.draftsRef.current = nextDrafts
          return nextDrafts
        })
      }
      return true
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
      return false
    }
  }

  async function handleSaveDraft(draft: Draft): Promise<boolean> {
    try {
      ctx.feedback.setBusyAction(`draft:${draft.id}`)
      const saved = await persistDraft(draft)
      if (saved) ctx.feedback.setNotice('Testware saved')
      return saved
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  function updateLocalDraft(id: string, patch: RichRecordPatch) {
    ctx.records.dirtyDraftIdsRef.current.add(id)
    ctx.records.setDrafts((previous) => {
      const nextDrafts = previous.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft))
      ctx.records.draftsRef.current = nextDrafts
      return nextDrafts
    })
  }

  function discardLocalDraft(original: Draft) {
    ctx.records.dirtyDraftIdsRef.current.delete(original.id)
    ctx.records.setDrafts((previous) => {
      const nextDrafts = previous.map((draft) => (draft.id === original.id ? original : draft))
      ctx.records.draftsRef.current = nextDrafts
      return nextDrafts
    })
    ctx.feedback.setNotice('Testware changes discarded')
  }

  async function persistFinding(finding: Finding): Promise<boolean> {
    try {
      ctx.feedback.setError(null)
      const storedBody = await materializeRecordBody(finding, ctx.materializeInlineImages)
      const saved = await updateFinding(finding.id, {
        title: finding.title,
        ...storedBody,
        kind: finding.kind,
        metadataJson: finding.metadataJson,
      })
      const current = ctx.records.findingsRef.current.find((item) => item.id === finding.id)
      if (!current || !findingEditableFieldsMatch(current, finding)) return false
      ctx.records.dirtyFindingIdsRef.current.delete(saved.id)
      ctx.records.savedFindingsRef.current = replaceRecord(ctx.records.savedFindingsRef.current, saved)
      if (ctx.session.activeSessionIdRef.current === saved.sessionId) {
        ctx.records.setFindings((previous) => {
          const nextFindings = previous.map((item) => (item.id === saved.id ? saved : item))
          ctx.records.findingsRef.current = nextFindings
          return nextFindings
        })
      }
      return true
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
      return false
    }
  }

  async function handleSaveFinding(finding: Finding): Promise<boolean> {
    try {
      ctx.feedback.setBusyAction(`finding:${finding.id}`)
      const saved = await persistFinding(finding)
      if (saved) ctx.feedback.setNotice('Finding saved')
      return saved
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  function updateLocalFinding(id: string, patch: FindingRecordPatch) {
    ctx.records.dirtyFindingIdsRef.current.add(id)
    ctx.records.setFindings((previous) => {
      const nextFindings = previous.map((finding) => (finding.id === id ? { ...finding, ...patch } : finding))
      ctx.records.findingsRef.current = nextFindings
      return nextFindings
    })
  }

  function discardLocalFinding(original: Finding) {
    ctx.records.dirtyFindingIdsRef.current.delete(original.id)
    ctx.records.setFindings((previous) => {
      const nextFindings = previous.map((finding) => (finding.id === original.id ? original : finding))
      ctx.records.findingsRef.current = nextFindings
      return nextFindings
    })
    ctx.feedback.setNotice('Finding changes discarded')
  }

  function discardAllDirtyRecords() {
    const dirtyDraftIds = new Set(ctx.records.dirtyDraftIdsRef.current)
    const dirtyFindingIds = new Set(ctx.records.dirtyFindingIdsRef.current)
    const savedDrafts = new Map(ctx.records.savedDraftsRef.current.map((draft) => [draft.id, draft]))
    const savedFindings = new Map(ctx.records.savedFindingsRef.current.map((finding) => [finding.id, finding]))
    ctx.records.dirtyDraftIdsRef.current.clear()
    ctx.records.dirtyFindingIdsRef.current.clear()
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
    ctx.feedback.setNotice('Pending record changes discarded')
  }

  async function saveDirtyRecordsNow(): Promise<boolean> {
    const dirtyDrafts = ctx.records.draftsRef.current.filter((draft) => ctx.records.dirtyDraftIdsRef.current.has(draft.id))
    const dirtyFindings = ctx.records.findingsRef.current.filter((finding) => ctx.records.dirtyFindingIdsRef.current.has(finding.id))
    if (dirtyDrafts.length === 0 && dirtyFindings.length === 0) return true

    let saved = true
    for (const draft of dirtyDrafts) {
      saved = (await persistDraft(draft)) && saved
    }
    for (const finding of dirtyFindings) {
      saved = (await persistFinding(finding)) && saved
    }
    if (saved) ctx.feedback.setNotice('Pending record edits saved')
    return saved
  }

  function requestDeleteDraft(draft: Draft) {
    ctx.deletion.setDeleteConfirmation({ kind: 'draft', draft })
  }

  async function handleDeleteDraft(draft: Draft) {
    try {
      ctx.feedback.setBusyAction(`delete-draft:${draft.id}`)
      ctx.feedback.setError(null)
      await deleteDraft(draft.id)
      ctx.records.dirtyDraftIdsRef.current.delete(draft.id)
      await ctx.loaders.loadDraftsForSession(draft.sessionId, { force: true, replace: true })
      ctx.feedback.setNotice('Testware deleted')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  function requestDeleteFinding(finding: Finding) {
    ctx.deletion.setDeleteConfirmation({ kind: 'finding', finding })
  }

  async function handleDeleteFinding(finding: Finding) {
    try {
      ctx.feedback.setBusyAction(`delete-finding:${finding.id}`)
      ctx.feedback.setError(null)
      await deleteFinding(finding.id)
      ctx.records.dirtyFindingIdsRef.current.delete(finding.id)
      await ctx.loaders.loadFindingsForSession(finding.sessionId, { force: true, replace: true })
      ctx.feedback.setNotice('Finding deleted')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  async function confirmDelete() {
    const confirmation = ctx.deletion.deleteConfirmation
    if (!confirmation) return

    ctx.deletion.setDeleteConfirmation(null)
    if (confirmation.kind === 'session') {
      await ctx.handleDeleteSession(confirmation.session)
    } else if (confirmation.kind === 'draft') {
      await handleDeleteDraft(confirmation.draft)
    } else {
      await handleDeleteFinding(confirmation.finding)
    }
  }

  return {
    confirmDelete,
    discardLocalDraft,
    discardLocalFinding,
    discardAllDirtyRecords,
    handleManualFinding,
    handleManualTestware,
    handlePrefillFindingFromNote,
    handlePrefillTestwareFromNote,
    saveDirtyRecordsNow,
    handleSaveDraft,
    handleSaveFinding,
    requestDeleteDraft,
    requestDeleteFinding,
    updateLocalDraft,
    updateLocalFinding,
  }
}

function replaceRecord<T extends { id: string }>(records: T[], saved: T): T[] {
  return records.some((record) => record.id === saved.id)
    ? records.map((record) => record.id === saved.id ? saved : record)
    : [saved, ...records]
}

export function useRecordActions(ctx: RecordActionsContext) {
  return useStableCapability(ctx, createRecordActions)
}

export async function materializeRecordBody(
  record: StoredRichBody,
  materializeInlineImages: InlineImageMaterializer,
): Promise<StoredRichBody> {
  const document = richEditorDocumentFromStoredBody(record)
  const materialized = await materializeInlineImages(document, { entryId: null })
  return richEditorDocumentToStoredBody(materialized)
}

function draftEditableFieldsMatch(left: Draft, right: Draft): boolean {
  return (
    left.title === right.title &&
    left.body === right.body &&
    left.bodyJson === right.bodyJson &&
    left.bodyFormat === right.bodyFormat
  )
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
