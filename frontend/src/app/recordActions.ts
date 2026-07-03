import {
  createDraft,
  createFinding,
  deleteDraft,
  deleteFinding,
  listDrafts,
  listFindings,
  updateDraft,
  updateFinding,
  type Draft,
  type Finding,
  type Session,
} from '../tauri'
import {
  emptyRichEditorDocument,
  richEditorDocumentFromHtml,
  richEditorDocumentToStoredBody,
  type RichEditorDocument,
} from '../editor/editorDocument'
import { formatError, nextUntitledRecordTitle } from '../ui/format'
import { renderPrefilledFinding, renderPrefilledTestware } from '../workflows/prefillTemplates'
import type { AppWorkflowContext, RichRecordPatch } from './types'
import type { BusyAction, WorkspaceView } from '../ui/types'

export function createRecordActions(
  ctx: AppWorkflowContext,
  saveNoteNow: (options?: { manageBusy?: boolean }) => Promise<boolean>,
  handleDeleteNote: (session: Session) => Promise<void>,
) {
  async function createRecordFromNote(
    busy: BusyAction,
    bodyDocument: RichEditorDocument,
    untitledTitle: string,
    existingTitles: Array<{ title: string }>,
    create: (title: string, body: ReturnType<typeof richEditorDocumentToStoredBody>) => Promise<unknown>,
    refresh: () => Promise<void>,
    view: WorkspaceView,
    successNotice: string,
  ) {
    try {
      ctx.setBusyAction(busy)
      ctx.setError(null)
      const saved = await saveNoteNow({ manageBusy: false })
      if (!saved) return
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
      ctx.testwareDrafts,
      (title, body) => createDraft({ sessionId: session.id, aiRunId: null, kind: 'testware', title, ...body, metadataJson: null }),
      async () => ctx.setDrafts(await listDrafts(session.id)),
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
      ctx.testwareDrafts,
      (title, body) => createDraft({ sessionId: session.id, aiRunId: null, kind: 'testware', title, ...body, metadataJson: null }),
      async () => ctx.setDrafts(await listDrafts(session.id)),
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
      ctx.findings,
      (title, body) => createFinding({ sessionId: session.id, title, ...body, kind: 'bug', metadataJson: null }),
      async () => ctx.setFindings(await listFindings(session.id)),
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
      ctx.findings,
      (title, body) => createFinding({ sessionId: session.id, title, ...body, kind: 'bug', metadataJson: null }),
      async () => ctx.setFindings(await listFindings(session.id)),
      'findings',
      'Finding prefilled from note',
    )
  }

  async function handleSaveDraft(draft: Draft): Promise<boolean> {
    try {
      ctx.setBusyAction(`draft:${draft.id}`)
      ctx.setError(null)
      const saved = await updateDraft(draft.id, { title: draft.title, body: draft.body, bodyJson: draft.bodyJson, bodyFormat: draft.bodyFormat })
      ctx.setDrafts((previous) => previous.map((item) => (item.id === saved.id ? saved : item)))
      ctx.setNotice('Testware saved')
      return true
    } catch (cause) {
      ctx.setError(formatError(cause))
      return false
    } finally {
      ctx.setBusyAction(null)
    }
  }

  function updateLocalDraft(id: string, patch: RichRecordPatch) {
    ctx.setDrafts((previous) => previous.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)))
  }

  async function handleSaveFinding(finding: Finding): Promise<boolean> {
    try {
      ctx.setBusyAction(`finding:${finding.id}`)
      ctx.setError(null)
      const saved = await updateFinding(finding.id, { title: finding.title, body: finding.body, bodyJson: finding.bodyJson, bodyFormat: finding.bodyFormat })
      ctx.setFindings((previous) => previous.map((item) => (item.id === saved.id ? saved : item)))
      ctx.setNotice('Finding saved')
      return true
    } catch (cause) {
      ctx.setError(formatError(cause))
      return false
    } finally {
      ctx.setBusyAction(null)
    }
  }

  function updateLocalFinding(id: string, patch: RichRecordPatch) {
    ctx.setFindings((previous) => previous.map((finding) => (finding.id === id ? { ...finding, ...patch } : finding)))
  }

  function requestDeleteDraft(draft: Draft) {
    ctx.setDeleteConfirmation({ kind: 'draft', draft })
  }

  async function handleDeleteDraft(draft: Draft) {
    try {
      ctx.setBusyAction(`delete-draft:${draft.id}`)
      ctx.setError(null)
      await deleteDraft(draft.id)
      ctx.setDrafts(await listDrafts(draft.sessionId))
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
      ctx.setFindings(await listFindings(finding.sessionId))
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
      await handleDeleteNote(confirmation.session)
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
    handleSaveDraft,
    handleSaveFinding,
    requestDeleteDraft,
    requestDeleteFinding,
    updateLocalDraft,
    updateLocalFinding,
  }
}
