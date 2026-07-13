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
import type { DeletionWorkspace, GenerationWorkspace, RecordWorkspace, SessionWorkspace, WorkflowFeedback, WorkflowNavigation } from './types'
import { useStableCapability } from './useStableCapability'

const noteBodyMaxLength = 100_000

export type SessionActionsContext = {
  session: SessionWorkspace
  records: Pick<
    RecordWorkspace,
    | 'dirtyDraftIdsRef'
    | 'dirtyFindingIdsRef'
    | 'setDrafts'
    | 'setFindings'
    | 'setTestwareDraftCount'
    | 'setFindingCount'
  >
  generation: Pick<GenerationWorkspace, 'setLatestNoteGenerationUndo'>
  feedback: WorkflowFeedback
  navigation: WorkflowNavigation
  deletion: Pick<DeletionWorkspace, 'setDeleteConfirmation'>
  materializeInlineImages: (
    document: RichEditorDocument,
    options?: { entryId?: string | null; updateNoteBody?: boolean },
  ) => Promise<RichEditorDocument>
  invalidateRecordLoads: () => void
  resetRecordHydration: () => void
  saveDirtyRecordsNow: () => Promise<boolean>
}

export function createSessionActions(ctx: SessionActionsContext) {
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
      const flushedNote = await saveNoteNow({ manageBusy: false })
      if (!flushedNote) return false
      return ctx.saveDirtyRecordsNow()
    } finally {
      ctx.session.suppressAmbientNoteSaveRef.current = false
    }
  }

  async function openSession(session: Session, showNotice = true) {
    try {
      ctx.feedback.setBusyAction('open-session')
      ctx.feedback.setError(null)
      const flushed = await savePendingSessionEdits()
      if (!flushed) return
      ctx.invalidateRecordLoads()
      const opened = await openSessionNoteState(session.id)
      const { session: reopened, noteEntry: editableNote } = opened

      ctx.session.sessionTitleWriteVersionRef.current += 1
      ctx.session.noteBodyWriteVersionRef.current += 1
      ctx.resetRecordHydration()
      ctx.session.setActiveSession(reopened)
      ctx.session.setNoteEntry(editableNote)
      ctx.generation.setLatestNoteGenerationUndo(null)
      ctx.records.setDrafts([])
      ctx.records.setFindings([])
      ctx.records.setTestwareDraftCount(opened.testwareDraftCount)
      ctx.records.setFindingCount(opened.findingCount)
      ctx.session.setSessionTitle(reopened.title)
      const noteDocument = richEditorDocumentFromStoredBody(editableNote)
      ctx.session.setNoteBody(noteDocument)
      ctx.session.savedTitleRef.current = reopened.title
      ctx.session.savedBodyRef.current = serializeRichEditorDocument(noteDocument)
      ctx.navigation.setActiveView('sessions')
      if (showNotice) ctx.feedback.setNotice(`Opened ${reopened.title}`)
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  async function handleNewSession() {
    try {
      ctx.feedback.setBusyAction('new-session')
      ctx.feedback.setError(null)
      const flushed = await savePendingSessionEdits()
      if (!flushed) return
      ctx.invalidateRecordLoads()
      const title = nextUntitledSessionTitle(ctx.session.sessions)
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
      ctx.resetRecordHydration()
      ctx.session.sessionTitleWriteVersionRef.current += 1
      ctx.session.noteBodyWriteVersionRef.current += 1
      ctx.session.setSessions(nextSessions)
      ctx.session.setActiveSession(session)
      ctx.session.setNoteEntry(editableNote)
      ctx.generation.setLatestNoteGenerationUndo(null)
      ctx.records.setDrafts([])
      ctx.records.setFindings([])
      ctx.records.setTestwareDraftCount(0)
      ctx.records.setFindingCount(0)
      ctx.session.setSessionTitle(session.title)
      ctx.session.setNoteBody(emptyRichEditorDocument)
      ctx.session.savedTitleRef.current = session.title
      ctx.session.savedBodyRef.current = serializeRichEditorDocument(emptyRichEditorDocument)
      ctx.navigation.setActiveView('sessions')
      ctx.feedback.setNotice('New Session created')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  function clearActiveSessionState() {
    ctx.resetRecordHydration()
    ctx.records.dirtyDraftIdsRef.current.clear()
    ctx.records.dirtyFindingIdsRef.current.clear()
    ctx.session.sessionTitleWriteVersionRef.current += 1
    ctx.session.noteBodyWriteVersionRef.current += 1
    ctx.session.setActiveSession(null)
    ctx.session.setNoteEntry(null)
    ctx.generation.setLatestNoteGenerationUndo(null)
    ctx.records.setDrafts([])
    ctx.records.setFindings([])
    ctx.records.setTestwareDraftCount(0)
    ctx.records.setFindingCount(0)
    ctx.session.setSessionTitle('')
    ctx.session.setNoteBody(emptyRichEditorDocument)
    ctx.session.savedTitleRef.current = ''
    ctx.session.savedBodyRef.current = serializeRichEditorDocument(emptyRichEditorDocument)
  }

  function requestDeleteSession() {
    if (!ctx.session.activeSession) return
    ctx.deletion.setDeleteConfirmation({ kind: 'session', session: ctx.session.activeSession })
  }

  async function handleDeleteSession(sessionToDelete: Session) {
    try {
      ctx.session.deletingSessionIdRef.current = sessionToDelete.id
      ctx.feedback.setBusyAction('delete-session')
      ctx.feedback.setError(null)
      await deleteSession(sessionToDelete.id)
      // Clear active-Session state immediately after the delete succeeds, before any
      // follow-up call that could reject. Once cleared, the title/body autosave
      // effects have nothing left to save against the deleted session, so the
      // guard below no longer needs to keep protecting it if listSessions/openSession fail.
      if (ctx.session.activeSession?.id === sessionToDelete.id) clearActiveSessionState()

      const nextSessions = await listSessions()
      ctx.session.setSessions(nextSessions)

      if (nextSessions[0]) {
        await openSession(nextSessions[0], false)
      } else {
        ctx.navigation.setActiveView('sessions')
      }
      ctx.feedback.setNotice('Session deleted')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.session.deletingSessionIdRef.current = null
      ctx.feedback.setBusyAction(null)
    }
  }

  async function saveTitle(title: string, options: { manageBusy?: boolean } = {}): Promise<boolean> {
    const { manageBusy = true } = options
    if (!ctx.session.activeSession || ctx.session.deletingSessionIdRef.current === ctx.session.activeSession.id) return false
    const sessionId = ctx.session.activeSession.id
    const writeVersion = ++ctx.session.sessionTitleWriteVersionRef.current
    try {
      if (manageBusy) ctx.feedback.setBusyAction('save-title')
      const saved = await updateSession(sessionId, { title })
      if (writeVersion !== ctx.session.sessionTitleWriteVersionRef.current || ctx.session.activeSessionIdRef.current !== saved.id) return true
      ctx.session.savedTitleRef.current = saved.title
      ctx.session.setActiveSession(saved)
      ctx.session.setSessions((previous) => previous.map((session) => (session.id === saved.id ? saved : session)))
      ctx.feedback.setNotice('Session saved')
      return true
    } catch (cause) {
      if (writeVersion !== ctx.session.sessionTitleWriteVersionRef.current) return true
      ctx.feedback.setError(formatError(cause))
      return false
    } finally {
      if (manageBusy && writeVersion === ctx.session.sessionTitleWriteVersionRef.current) ctx.feedback.setBusyAction(null)
    }
  }

  async function saveBody(body: RichEditorDocument, options: { manageBusy?: boolean } = {}): Promise<boolean> {
    const { manageBusy = true } = options
    if (!ctx.session.noteEntry || ctx.session.deletingSessionIdRef.current === ctx.session.noteEntry.sessionId) return false
    const storedBody = richEditorDocumentToStoredBody(body)
    if (storedBody.body.length > noteBodyMaxLength) {
      ctx.feedback.setError('Note is too large to autosave. This usually means an image was embedded directly in the note; paste images again so QA Scribe can store them as attachments.')
      return false
    }
    const writeVersion = ++ctx.session.noteBodyWriteVersionRef.current
    try {
      if (manageBusy) ctx.feedback.setBusyAction('save-body')
      const saved = await updateEntry(ctx.session.noteEntry.id, storedBody)
      if (writeVersion !== ctx.session.noteBodyWriteVersionRef.current) return true
      ctx.session.savedBodyRef.current = serializeRichEditorDocument(richEditorDocumentFromStoredBody(saved))
      ctx.session.setNoteEntry(saved)
      ctx.feedback.setNotice('Note saved')
      return true
    } catch (cause) {
      if (writeVersion !== ctx.session.noteBodyWriteVersionRef.current) return true
      ctx.feedback.setError(formatError(cause))
      return false
    } finally {
      if (manageBusy && writeVersion === ctx.session.noteBodyWriteVersionRef.current) ctx.feedback.setBusyAction(null)
    }
  }

  async function saveNoteNow(options: { manageBusy?: boolean } = {}): Promise<boolean> {
    const { manageBusy = true } = options
    const title = ctx.session.sessionTitle.trim()
    let body: RichEditorDocument
    try {
      body = await ctx.materializeInlineImages(ctx.session.noteBody, { entryId: ctx.session.noteEntry?.id, updateNoteBody: true })
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
      return false
    }
    let saved = true
    if (ctx.session.activeSession && title && title !== ctx.session.savedTitleRef.current) {
      saved = (await saveTitle(title, { manageBusy })) && saved
    }
    if (ctx.session.noteEntry && serializeRichEditorDocument(body) !== ctx.session.savedBodyRef.current) {
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

export function useSessionActions(ctx: SessionActionsContext) {
  return useStableCapability(ctx, createSessionActions)
}
