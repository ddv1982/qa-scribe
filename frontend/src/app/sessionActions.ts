import {
  createEntry,
  createSession,
  deleteSession,
  listSessions,
  openSessionNoteState,
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
import { createSessionSaveActions } from './sessionActions.saving'
import { createSessionWriteActions } from './sessionActions.writes'
import type {
  DeletionWorkspace,
  GenerationWorkspace,
  RecordWorkspace,
  SessionWorkspace,
  SummaryRecoveryCoordinator,
  WorkflowFeedback,
  WorkflowNavigation,
} from './types'
import { useStableCapability } from './useStableCapability'
import type { RecordLoadSuspension } from './useRecordHydration'

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
  generation: Pick<GenerationWorkspace, 'latestNoteGenerationUndo' | 'setLatestNoteGenerationUndo'>
  latestNoteGenerationUndoRef: { current: GenerationWorkspace['latestNoteGenerationUndo'] }
  summaryRecovery: SummaryRecoveryCoordinator
  feedback: WorkflowFeedback
  navigation: WorkflowNavigation
  deletion: Pick<DeletionWorkspace, 'setDeleteConfirmation'>
  materializeInlineImages: (
    document: RichEditorDocument,
    options?: { entryId?: string | null; isCurrent?: () => boolean },
  ) => Promise<{ document: RichEditorDocument; importedAttachmentIds: string[] }>
  cleanupMaterializedAttachments: (attachmentIds: string[]) => Promise<boolean>
  suspendRecordLoads: () => RecordLoadSuspension
  restoreRecordLoads: (suspension: RecordLoadSuspension) => Promise<void>
  resetRecordHydration: () => void
  saveDirtyRecordsNow: () => Promise<boolean>
  retryPendingRecordCompensations: (sessionId: string) => Promise<boolean>
}

export function createSessionActions(ctx: SessionActionsContext) {
  const writes = createSessionWriteActions(ctx)
  const saving = createSessionSaveActions(ctx, writes)

  async function openSession(
    session: Session,
    showNotice = true,
    onOpened?: () => void,
    requestedEpoch?: number,
  ) {
    const navigationEpoch = requestedEpoch ?? writes.beginSessionNavigation()
    if (!writes.sessionNavigationIsCurrent(navigationEpoch)) return
    if (!writes.recoveryDiscoveryAllowsNoteHydration()) return
    let loadSuspension: RecordLoadSuspension | null = null
    let hydrationCommitted = false
    try {
      ctx.feedback.setBusyAction('open-session')
      ctx.feedback.setError(null)
      const flushed = await saving.savePendingSessionEdits()
      if (!flushed || !writes.sessionNavigationIsCurrent(navigationEpoch)) return
      const compensatedTitle = await writes.retryPendingTitleCompensation(session.id)
      if (!compensatedTitle || !writes.sessionNavigationIsCurrent(navigationEpoch)) return
      const compensatedNote = await writes.retryPendingNoteCompensation(session.id)
      if (!compensatedNote || !writes.sessionNavigationIsCurrent(navigationEpoch)) return
      const compensatedRecords = await ctx.retryPendingRecordCompensations(session.id)
      if (!compensatedRecords || !writes.sessionNavigationIsCurrent(navigationEpoch)) return
      loadSuspension = ctx.suspendRecordLoads()
      ctx.summaryRecovery.openingSessionIdRef.current = session.id
      const opened = await openSessionNoteState(session.id)
      if (!writes.sessionNavigationIsCurrent(navigationEpoch)) return
      const { session: reopened } = opened
      const recoveredSummaryEntry = ctx.summaryRecovery.completedSummaryEntriesRef.current.get(session.id)
      if (recoveredSummaryEntry && recoveredSummaryEntry.id !== opened.noteEntry.id) {
        ctx.feedback.setError('Recovered Summary returned an unexpected Note Entry.')
        return
      }
      const editableNote = recoveredSummaryEntry ?? opened.noteEntry
      if (recoveredSummaryEntry) ctx.summaryRecovery.completedSummaryEntriesRef.current.delete(session.id)

      ctx.session.sessionTitleWriteVersionRef.current += 1
      ctx.session.noteBodyWriteVersionRef.current += 1
      ctx.resetRecordHydration()
      hydrationCommitted = true
      ctx.session.activeSessionIdRef.current = reopened.id
      ctx.session.noteEntryIdRef.current = editableNote.id
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
      writes.resetTitleIntent(reopened.id, reopened.title)
      ctx.navigation.setActiveView('sessions')
      if (showNotice) ctx.feedback.setNotice(`Opened ${reopened.title}`)
      onOpened?.()
    } catch (cause) {
      if (writes.sessionNavigationIsCurrent(navigationEpoch)) ctx.feedback.setError(formatError(cause))
    } finally {
      if (!hydrationCommitted && loadSuspension) {
        await ctx.restoreRecordLoads(loadSuspension)
      }
      if (writes.sessionNavigationIsCurrent(navigationEpoch)) {
        if (ctx.summaryRecovery.openingSessionIdRef.current === session.id) {
          ctx.summaryRecovery.openingSessionIdRef.current = null
        }
        ctx.feedback.setBusyAction(null)
      }
    }
  }

  async function handleNewSession() {
    const navigationEpoch = writes.beginSessionNavigation()
    if (!writes.recoveryDiscoveryAllowsNoteHydration()) return
    let loadSuspension: RecordLoadSuspension | null = null
    let hydrationCommitted = false
    try {
      ctx.feedback.setBusyAction('new-session')
      ctx.feedback.setError(null)
      const flushed = await saving.savePendingSessionEdits()
      if (!flushed || !writes.sessionNavigationIsCurrent(navigationEpoch)) return
      loadSuspension = ctx.suspendRecordLoads()
      const title = nextUntitledSessionTitle(ctx.session.sessions)
      const session = await createSession({ title, sessionContext: null, objectiveNotes: null })
      // Session creation is durable even if the follow-up Note creation fails.
      // Publish it immediately so supersession cannot hide a partial result;
      // opening it later will repair a missing Note through openSessionNoteState.
      ctx.session.setSessions((previous) => mergeSessions(previous, [session]))
      writes.initializeTitleIntent(session.id, session.title)
      if (!writes.sessionNavigationIsCurrent(navigationEpoch)) return
      const editableNote = await createEntry({
        sessionId: session.id,
        entryType: 'note',
        title: 'Note body',
        ...richEditorDocumentToStoredBody(emptyRichEditorDocument),
        metadataJson: null,
        excludedFromGeneration: false,
      })
      if (!writes.sessionNavigationIsCurrent(navigationEpoch)) return
      const nextSessions = await listSessions()
      if (!writes.sessionNavigationIsCurrent(navigationEpoch)) return
      ctx.resetRecordHydration()
      hydrationCommitted = true
      ctx.session.sessionTitleWriteVersionRef.current += 1
      ctx.session.noteBodyWriteVersionRef.current += 1
      ctx.session.activeSessionIdRef.current = session.id
      ctx.session.noteEntryIdRef.current = editableNote.id
      ctx.session.setSessions((previous) => mergeSessions(mergeSessions(nextSessions, [session]), previous))
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
      if (writes.sessionNavigationIsCurrent(navigationEpoch)) ctx.feedback.setError(formatError(cause))
    } finally {
      if (!hydrationCommitted && loadSuspension) {
        await ctx.restoreRecordLoads(loadSuspension)
      }
      if (writes.sessionNavigationIsCurrent(navigationEpoch)) ctx.feedback.setBusyAction(null)
    }
  }

  function clearActiveSessionState() {
    const clearedSessionId = ctx.session.activeSessionIdRef.current
    const clearedEntryId = ctx.session.noteEntryIdRef.current
    if (clearedSessionId) writes.clearTitleIntent(clearedSessionId)
    if (clearedEntryId) saving.clearPendingImportedAttachments(clearedEntryId)
    ctx.resetRecordHydration()
    ctx.records.dirtyDraftIdsRef.current.clear()
    ctx.records.dirtyFindingIdsRef.current.clear()
    ctx.session.sessionTitleWriteVersionRef.current += 1
    ctx.session.noteBodyWriteVersionRef.current += 1
    ctx.session.activeSessionIdRef.current = null
    ctx.session.noteEntryIdRef.current = null
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
      ctx.session.setSessions((previous) => previous.filter((session) => session.id !== sessionToDelete.id))
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

  return {
    adoptCanonicalNoteBody: writes.adoptCanonicalNoteBody,
    beginSessionNavigation: writes.beginSessionNavigation,
    clearActiveSessionState,
    discardPendingSessionEdits: saving.discardPendingSessionEdits,
    handleDeleteSession,
    handleNewSession,
    hasPendingSessionCompensations: writes.hasPendingSessionCompensations,
    hasPendingSessionEdits: saving.hasPendingSessionEdits,
    openSession,
    registerImportedNoteAttachment: saving.registerImportedNoteAttachment,
    registerNoteEditIntent: writes.registerNoteEditIntent,
    registerRecordEditIntent: writes.registerRecordEditIntent,
    registerTitleEditIntent: writes.registerTitleEditIntent,
    retryAllPendingSessionCompensations: writes.retryAllPendingSessionCompensations,
    selectRecoveredSummaryChoice: writes.selectRecoveredSummaryChoice,
    requestDeleteSession,
    saveBody: writes.saveBody,
    saveNoteNow: saving.saveNoteNow,
    savePendingSessionEdits: saving.savePendingSessionEdits,
    saveTitle: writes.saveTitle,
    sessionNavigationIsCurrent: writes.sessionNavigationIsCurrent,
    waitForPendingSessionWrites: writes.waitForPendingSessionWrites,
  }
}

function mergeSessions(current: Session[], incoming: Session[]): Session[] {
  const merged = [...current]
  for (const session of incoming) {
    const index = merged.findIndex((candidate) => candidate.id === session.id)
    if (index === -1) merged.push(session)
    else merged[index] = session
  }
  return merged
}

export function useSessionActions(ctx: SessionActionsContext) {
  return useStableCapability(ctx, createSessionActions)
}
