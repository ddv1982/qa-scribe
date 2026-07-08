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
import type { AppWorkflowContext, FindingRecordPatch, RichRecordPatch } from './types'
import type { BusyAction, MainView } from '../ui/types'

type RecordLoaders = {
  loadDraftsForSession: (sessionId: string, options?: { force?: boolean; replace?: boolean }) => Promise<Draft[]>
  loadFindingsForSession: (sessionId: string, options?: { force?: boolean; replace?: boolean }) => Promise<Finding[]>
}

type InlineImageMaterializer = (
  document: RichEditorDocument,
  options?: { entryId?: string | null; updateNoteBody?: boolean },
) => Promise<RichEditorDocument>

export function createRecordActions(
  ctx: AppWorkflowContext,
  saveNoteNow: (options?: { manageBusy?: boolean }) => Promise<boolean>,
  handleDeleteSession: (session: Session) => Promise<void>,
  materializeInlineImages: InlineImageMaterializer,
  loaders: RecordLoaders,
) {
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
      ctx.setBusyAction(busy)
      ctx.setError(null)
      const saved = await saveNoteNow({ manageBusy: false })
      if (!saved) return
      const existingTitles = await loadExistingTitles()
      await create(nextUntitledRecordTitle(existingTitles, untitledTitle), richEditorDocumentToStoredBody(bodyDocument))
      await refresh()
      ctx.setActiveView(view)
      ctx.setNotice(successNotice)
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function handleManualTestware() {
    if (!ctx.activeSession) return
    const session = ctx.activeSession
    await createRecordFromNote(
      'manual-testware',
      emptyRichEditorDocument,
      'Untitled testware',
      async () => (await loaders.loadDraftsForSession(session.id)).filter((draft) => draft.kind === 'testware'),
      (title, body) => createDraft({ sessionId: session.id, aiRunId: null, kind: 'testware', title, ...body, metadataJson: null }),
      async () => {
        await loaders.loadDraftsForSession(session.id, { force: true, replace: true })
      },
      'testware',
      'Manual testware created',
    )
  }

  async function handlePrefillTestwareFromNote() {
    if (!ctx.activeSession) return
    const session = ctx.activeSession
    await createRecordFromNote(
      'prefill-testware',
      richEditorDocumentFromHtml(renderPrefilledTestware(session.title, ctx.noteBodyHtml)),
      'Untitled testware',
      async () => (await loaders.loadDraftsForSession(session.id)).filter((draft) => draft.kind === 'testware'),
      (title, body) => createDraft({ sessionId: session.id, aiRunId: null, kind: 'testware', title, ...body, metadataJson: null }),
      async () => {
        await loaders.loadDraftsForSession(session.id, { force: true, replace: true })
      },
      'testware',
      'Testware prefilled from note',
    )
  }

  async function handleManualFinding() {
    if (!ctx.activeSession) return
    const session = ctx.activeSession
    await createRecordFromNote(
      'manual-finding',
      emptyRichEditorDocument,
      'Untitled finding',
      async () => loaders.loadFindingsForSession(session.id),
      (title, body) => createFinding({ sessionId: session.id, title, ...body, kind: 'bug', metadataJson: null }),
      async () => {
        await loaders.loadFindingsForSession(session.id, { force: true, replace: true })
      },
      'findings',
      'Manual finding created',
    )
  }

  async function handlePrefillFindingFromNote() {
    if (!ctx.activeSession) return
    const session = ctx.activeSession
    await createRecordFromNote(
      'prefill-finding',
      richEditorDocumentFromHtml(renderPrefilledFinding(ctx.noteBodyHtml)),
      'Untitled finding',
      async () => loaders.loadFindingsForSession(session.id),
      (title, body) => createFinding({ sessionId: session.id, title, ...body, kind: 'bug', metadataJson: null }),
      async () => {
        await loaders.loadFindingsForSession(session.id, { force: true, replace: true })
      },
      'findings',
      'Finding prefilled from note',
    )
  }

  async function persistDraft(draft: Draft): Promise<boolean> {
    try {
      ctx.setError(null)
      const storedBody = await materializeRecordBody(draft, materializeInlineImages)
      const saved = await updateDraft(draft.id, { title: draft.title, ...storedBody })
      const current = ctx.draftsRef.current.find((item) => item.id === draft.id)
      if (!current || !draftEditableFieldsMatch(current, draft)) return false
      ctx.dirtyDraftIdsRef.current.delete(saved.id)
      if (ctx.activeSessionIdRef.current === saved.sessionId) {
        ctx.setDrafts((previous) => {
          const nextDrafts = previous.map((item) => (item.id === saved.id ? saved : item))
          ctx.draftsRef.current = nextDrafts
          return nextDrafts
        })
      }
      return true
    } catch (cause) {
      ctx.setError(formatError(cause))
      return false
    }
  }

  async function handleSaveDraft(draft: Draft): Promise<boolean> {
    try {
      ctx.setBusyAction(`draft:${draft.id}`)
      const saved = await persistDraft(draft)
      if (saved) ctx.setNotice('Testware saved')
      return saved
    } finally {
      ctx.setBusyAction(null)
    }
  }

  function updateLocalDraft(id: string, patch: RichRecordPatch) {
    ctx.dirtyDraftIdsRef.current.add(id)
    ctx.setDrafts((previous) => {
      const nextDrafts = previous.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft))
      ctx.draftsRef.current = nextDrafts
      return nextDrafts
    })
  }

  async function persistFinding(finding: Finding): Promise<boolean> {
    try {
      ctx.setError(null)
      const storedBody = await materializeRecordBody(finding, materializeInlineImages)
      const saved = await updateFinding(finding.id, {
        title: finding.title,
        ...storedBody,
        kind: finding.kind,
        metadataJson: finding.metadataJson,
      })
      const current = ctx.findingsRef.current.find((item) => item.id === finding.id)
      if (!current || !findingEditableFieldsMatch(current, finding)) return false
      ctx.dirtyFindingIdsRef.current.delete(saved.id)
      if (ctx.activeSessionIdRef.current === saved.sessionId) {
        ctx.setFindings((previous) => {
          const nextFindings = previous.map((item) => (item.id === saved.id ? saved : item))
          ctx.findingsRef.current = nextFindings
          return nextFindings
        })
      }
      return true
    } catch (cause) {
      ctx.setError(formatError(cause))
      return false
    }
  }

  async function handleSaveFinding(finding: Finding): Promise<boolean> {
    try {
      ctx.setBusyAction(`finding:${finding.id}`)
      const saved = await persistFinding(finding)
      if (saved) ctx.setNotice('Finding saved')
      return saved
    } finally {
      ctx.setBusyAction(null)
    }
  }

  function updateLocalFinding(id: string, patch: FindingRecordPatch) {
    ctx.dirtyFindingIdsRef.current.add(id)
    ctx.setFindings((previous) => {
      const nextFindings = previous.map((finding) => (finding.id === id ? { ...finding, ...patch } : finding))
      ctx.findingsRef.current = nextFindings
      return nextFindings
    })
  }

  async function saveDirtyRecordsNow(): Promise<boolean> {
    const dirtyDrafts = ctx.draftsRef.current.filter((draft) => ctx.dirtyDraftIdsRef.current.has(draft.id))
    const dirtyFindings = ctx.findingsRef.current.filter((finding) => ctx.dirtyFindingIdsRef.current.has(finding.id))
    if (dirtyDrafts.length === 0 && dirtyFindings.length === 0) return true

    let saved = true
    for (const draft of dirtyDrafts) {
      saved = (await persistDraft(draft)) && saved
    }
    for (const finding of dirtyFindings) {
      saved = (await persistFinding(finding)) && saved
    }
    if (saved) ctx.setNotice('Pending record edits saved')
    return saved
  }

  function requestDeleteDraft(draft: Draft) {
    ctx.setDeleteConfirmation({ kind: 'draft', draft })
  }

  async function handleDeleteDraft(draft: Draft) {
    try {
      ctx.setBusyAction(`delete-draft:${draft.id}`)
      ctx.setError(null)
      await deleteDraft(draft.id)
      ctx.dirtyDraftIdsRef.current.delete(draft.id)
      await loaders.loadDraftsForSession(draft.sessionId, { force: true, replace: true })
      ctx.setNotice('Testware deleted')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  function requestDeleteFinding(finding: Finding) {
    ctx.setDeleteConfirmation({ kind: 'finding', finding })
  }

  async function handleDeleteFinding(finding: Finding) {
    try {
      ctx.setBusyAction(`delete-finding:${finding.id}`)
      ctx.setError(null)
      await deleteFinding(finding.id)
      ctx.dirtyFindingIdsRef.current.delete(finding.id)
      await loaders.loadFindingsForSession(finding.sessionId, { force: true, replace: true })
      ctx.setNotice('Finding deleted')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function confirmDelete() {
    const confirmation = ctx.deleteConfirmation
    if (!confirmation) return

    ctx.setDeleteConfirmation(null)
    if (confirmation.kind === 'note') {
      await handleDeleteSession(confirmation.session)
    } else if (confirmation.kind === 'draft') {
      await handleDeleteDraft(confirmation.draft)
    } else {
      await handleDeleteFinding(confirmation.finding)
    }
  }

  return {
    confirmDelete,
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
