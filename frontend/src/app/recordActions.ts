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
} from '../editor/editorDocument'
import { formatError, nextUntitledRecordTitle } from '../ui/format'
import { renderPrefilledFinding, renderPrefilledTestware } from '../workflows/prefillTemplates'
import type { AppWorkflowContext, RichRecordPatch } from './types'

export function createRecordActions(
  ctx: AppWorkflowContext,
  saveNoteNow: (options?: { manageBusy?: boolean }) => Promise<boolean>,
  handleDeleteNote: (session: Session) => Promise<void>,
) {
  async function handleManualTestware() {
    if (!ctx.activeSession) return
    try {
      ctx.setBusyAction('manual-testware')
      ctx.setError(null)
      const saved = await saveNoteNow({ manageBusy: false })
      if (!saved) return
      await createDraft({
        sessionId: ctx.activeSession.id,
        aiRunId: null,
        kind: 'testware',
        title: nextUntitledRecordTitle(ctx.testwareDrafts, 'Untitled testware'),
        ...richEditorDocumentToStoredBody(emptyRichEditorDocument),
        metadataJson: null,
      })
      ctx.setDrafts(await listDrafts(ctx.activeSession.id))
      ctx.setActiveView('testware')
      ctx.setNotice('Manual testware created')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function handlePrefillTestwareFromNote() {
    if (!ctx.activeSession) return
    try {
      ctx.setBusyAction('prefill-testware')
      ctx.setError(null)
      const saved = await saveNoteNow({ manageBusy: false })
      if (!saved) return
      await createDraft({
        sessionId: ctx.activeSession.id,
        aiRunId: null,
        kind: 'testware',
        title: nextUntitledRecordTitle(ctx.testwareDrafts, 'Untitled testware'),
        ...richEditorDocumentToStoredBody(richEditorDocumentFromHtml(renderPrefilledTestware(ctx.activeSession.title, ctx.noteBodyHtml))),
        metadataJson: null,
      })
      ctx.setDrafts(await listDrafts(ctx.activeSession.id))
      ctx.setActiveView('testware')
      ctx.setNotice('Testware prefilled from note')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function handleManualFinding() {
    if (!ctx.activeSession) return
    try {
      ctx.setBusyAction('manual-finding')
      ctx.setError(null)
      const saved = await saveNoteNow({ manageBusy: false })
      if (!saved) return
      await createFinding({
        sessionId: ctx.activeSession.id,
        title: nextUntitledRecordTitle(ctx.findings, 'Untitled finding'),
        ...richEditorDocumentToStoredBody(emptyRichEditorDocument),
        kind: 'bug',
        metadataJson: null,
      })
      ctx.setFindings(await listFindings(ctx.activeSession.id))
      ctx.setActiveView('findings')
      ctx.setNotice('Manual finding created')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function handlePrefillFindingFromNote() {
    if (!ctx.activeSession) return
    try {
      ctx.setBusyAction('prefill-finding')
      ctx.setError(null)
      const saved = await saveNoteNow({ manageBusy: false })
      if (!saved) return
      await createFinding({
        sessionId: ctx.activeSession.id,
        title: nextUntitledRecordTitle(ctx.findings, 'Untitled finding'),
        ...richEditorDocumentToStoredBody(richEditorDocumentFromHtml(renderPrefilledFinding(ctx.noteBodyHtml))),
        kind: 'bug',
        metadataJson: null,
      })
      ctx.setFindings(await listFindings(ctx.activeSession.id))
      ctx.setActiveView('findings')
      ctx.setNotice('Finding prefilled from note')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
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
