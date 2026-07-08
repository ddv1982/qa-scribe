import {
  createEntry,
  createSession,
  deleteSession,
  listSessions,
  openSessionNoteState,
  updateEntry,
  updateSession,
  type Session,
} from '../tauri'
import {
  emptyRichEditorDocument,
  richEditorDocumentFromStoredBody,
  richEditorDocumentToStoredBody,
  serializeRichEditorDocument,
  type RichEditorDocument,
} from '../editor/editorDocument'
import { formatError, nextUntitledSessionTitle } from '../ui/format'
import type { AppWorkflowContext } from './types'

const noteBodyMaxLength = 100_000

export function createSessionActions(
  ctx: AppWorkflowContext,
  materializeInlineImages: (document: RichEditorDocument) => Promise<RichEditorDocument>,
  invalidateRecordLoads: () => void,
  resetRecordHydration: () => void,
  saveDirtyRecordsNow: () => Promise<boolean>,
) {
  async function savePendingSessionEdits(): Promise<boolean> {
    if (ctx.forcedPendingSaveRef.current) return ctx.forcedPendingSaveRef.current

    const pending = flushPendingSessionEdits().finally(() => {
      if (ctx.forcedPendingSaveRef.current === pending) {
        ctx.forcedPendingSaveRef.current = null
      }
    })
    ctx.forcedPendingSaveRef.current = pending
    return pending
  }

  async function flushPendingSessionEdits(): Promise<boolean> {
    ctx.suppressAmbientNoteSaveRef.current = true
    try {
      const flushedNote = await saveNoteNow({ manageBusy: false })
      if (!flushedNote) return false
      return saveDirtyRecordsNow()
    } finally {
      ctx.suppressAmbientNoteSaveRef.current = false
    }
  }

  async function openSession(session: Session, showNotice = true) {
    try {
      ctx.setBusyAction('open-note')
      ctx.setError(null)
      const flushed = await savePendingSessionEdits()
      if (!flushed) return
      invalidateRecordLoads()
      const opened = await openSessionNoteState(session.id)
      const { session: reopened, noteEntry: editableNote } = opened

      ctx.noteTitleWriteVersionRef.current += 1
      ctx.noteBodyWriteVersionRef.current += 1
      resetRecordHydration()
      ctx.setActiveSession(reopened)
      ctx.setNoteEntry(editableNote)
      ctx.setLatestNoteGenerationUndo(null)
      ctx.setDrafts([])
      ctx.setFindings([])
      ctx.setTestwareDraftCount(opened.testwareDraftCount)
      ctx.setFindingCount(opened.findingCount)
      ctx.setNoteTitle(reopened.title)
      const noteDocument = richEditorDocumentFromStoredBody(editableNote)
      ctx.setNoteBody(noteDocument)
      ctx.savedTitleRef.current = reopened.title
      ctx.savedBodyRef.current = serializeRichEditorDocument(noteDocument)
      ctx.setActiveView('notes')
      if (showNotice) ctx.setNotice(`Opened ${reopened.title}`)
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function handleNewSession() {
    try {
      ctx.setBusyAction('new-note')
      ctx.setError(null)
      const flushed = await savePendingSessionEdits()
      if (!flushed) return
      invalidateRecordLoads()
      const title = nextUntitledSessionTitle(ctx.sessions)
      const session = await createSession({ title, sessionContext: null, objectiveNotes: null })
      const editableNote = await createEntry({
        sessionId: session.id,
        entryType: 'note',
        title: 'Note body',
        ...richEditorDocumentToStoredBody(emptyRichEditorDocument),
        metadataJson: null,
        excludedFromGeneration: false,
      })
      const nextSessions = await listSessions()
      resetRecordHydration()
      ctx.noteTitleWriteVersionRef.current += 1
      ctx.noteBodyWriteVersionRef.current += 1
      ctx.setSessions(nextSessions)
      ctx.setActiveSession(session)
      ctx.setNoteEntry(editableNote)
      ctx.setLatestNoteGenerationUndo(null)
      ctx.setDrafts([])
      ctx.setFindings([])
      ctx.setTestwareDraftCount(0)
      ctx.setFindingCount(0)
      ctx.setNoteTitle(session.title)
      ctx.setNoteBody(emptyRichEditorDocument)
      ctx.savedTitleRef.current = session.title
      ctx.savedBodyRef.current = serializeRichEditorDocument(emptyRichEditorDocument)
      ctx.setActiveView('notes')
      ctx.setNotice('New note created')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  function clearActiveSessionState() {
    resetRecordHydration()
    ctx.dirtyDraftIdsRef.current.clear()
    ctx.dirtyFindingIdsRef.current.clear()
    ctx.noteTitleWriteVersionRef.current += 1
    ctx.noteBodyWriteVersionRef.current += 1
    ctx.setActiveSession(null)
    ctx.setNoteEntry(null)
    ctx.setLatestNoteGenerationUndo(null)
    ctx.setDrafts([])
    ctx.setFindings([])
    ctx.setTestwareDraftCount(0)
    ctx.setFindingCount(0)
    ctx.setNoteTitle('')
    ctx.setNoteBody(emptyRichEditorDocument)
    ctx.savedTitleRef.current = ''
    ctx.savedBodyRef.current = serializeRichEditorDocument(emptyRichEditorDocument)
  }

  function requestDeleteSession() {
    if (!ctx.activeSession) return
    ctx.setDeleteConfirmation({ kind: 'note', session: ctx.activeSession })
  }

  async function handleDeleteSession(sessionToDelete: Session) {
    try {
      ctx.deletingSessionIdRef.current = sessionToDelete.id
      ctx.setBusyAction('delete-note')
      ctx.setError(null)
      await deleteSession(sessionToDelete.id)
      // Clear active-note state immediately after the delete succeeds, before any
      // follow-up call that could reject. Once cleared, the title/body autosave
      // effects have nothing left to save against the deleted session, so the
      // guard below no longer needs to keep protecting it if listSessions/openSession fail.
      if (ctx.activeSession?.id === sessionToDelete.id) clearActiveSessionState()

      const nextSessions = await listSessions()
      ctx.setSessions(nextSessions)

      if (nextSessions[0]) {
        await openSession(nextSessions[0], false)
      } else {
        ctx.setActiveView('notes')
      }
      ctx.setNotice('Note deleted')
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.deletingSessionIdRef.current = null
      ctx.setBusyAction(null)
    }
  }

  async function saveTitle(title: string, options: { manageBusy?: boolean } = {}): Promise<boolean> {
    const { manageBusy = true } = options
    if (!ctx.activeSession || ctx.deletingSessionIdRef.current === ctx.activeSession.id) return false
    const sessionId = ctx.activeSession.id
    const writeVersion = ++ctx.noteTitleWriteVersionRef.current
    try {
      if (manageBusy) ctx.setBusyAction('save-title')
      const saved = await updateSession(sessionId, { title })
      if (writeVersion !== ctx.noteTitleWriteVersionRef.current || ctx.activeSessionIdRef.current !== saved.id) return true
      ctx.savedTitleRef.current = saved.title
      ctx.setActiveSession(saved)
      ctx.setSessions((previous) => previous.map((session) => (session.id === saved.id ? saved : session)))
      ctx.setNotice('Note saved')
      return true
    } catch (cause) {
      if (writeVersion !== ctx.noteTitleWriteVersionRef.current) return true
      ctx.setError(formatError(cause))
      return false
    } finally {
      if (manageBusy && writeVersion === ctx.noteTitleWriteVersionRef.current) ctx.setBusyAction(null)
    }
  }

  async function saveBody(body: RichEditorDocument, options: { manageBusy?: boolean } = {}): Promise<boolean> {
    const { manageBusy = true } = options
    if (!ctx.noteEntry || ctx.deletingSessionIdRef.current === ctx.noteEntry.sessionId) return false
    const storedBody = richEditorDocumentToStoredBody(body)
    if (storedBody.body.length > noteBodyMaxLength) {
      ctx.setError('Note is too large to autosave. This usually means an image was embedded directly in the note; paste images again so QA Scribe can store them as attachments.')
      return false
    }
    const writeVersion = ++ctx.noteBodyWriteVersionRef.current
    try {
      if (manageBusy) ctx.setBusyAction('save-body')
      const saved = await updateEntry(ctx.noteEntry.id, storedBody)
      if (writeVersion !== ctx.noteBodyWriteVersionRef.current) return true
      ctx.savedBodyRef.current = serializeRichEditorDocument(richEditorDocumentFromStoredBody(saved))
      ctx.setNoteEntry(saved)
      ctx.setNotice('Note saved')
      return true
    } catch (cause) {
      if (writeVersion !== ctx.noteBodyWriteVersionRef.current) return true
      ctx.setError(formatError(cause))
      return false
    } finally {
      if (manageBusy && writeVersion === ctx.noteBodyWriteVersionRef.current) ctx.setBusyAction(null)
    }
  }

  async function saveNoteNow(options: { manageBusy?: boolean } = {}): Promise<boolean> {
    const { manageBusy = true } = options
    const title = ctx.noteTitle.trim()
    let body: RichEditorDocument
    try {
      body = await materializeInlineImages(ctx.noteBody)
    } catch (cause) {
      ctx.setError(formatError(cause))
      return false
    }
    let saved = true
    if (ctx.activeSession && title && title !== ctx.savedTitleRef.current) {
      saved = (await saveTitle(title, { manageBusy })) && saved
    }
    if (ctx.noteEntry && serializeRichEditorDocument(body) !== ctx.savedBodyRef.current) {
      saved = (await saveBody(body, { manageBusy })) && saved
    }
    return saved
  }

  return {
    clearActiveSessionState,
    handleDeleteSession,
    handleNewSession,
    openSession,
    requestDeleteSession,
    saveBody,
    saveNoteNow,
    savePendingSessionEdits,
    saveTitle,
  }
}
