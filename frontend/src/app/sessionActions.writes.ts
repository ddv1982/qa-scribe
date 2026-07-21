import { updateEntry, updateSession, type Session } from '../tauri'
import {
  emptyRichEditorDocument,
  parseRichEditorDocument,
  richEditorDocumentFromStoredBody,
  richEditorDocumentToStoredBody,
  serializeRichEditorDocument,
  type RichEditorDocument,
} from '../editor/editorDocument'
import { formatError } from '../ui/format'
import type { SessionActionsContext } from './sessionActions'

const noteBodyMaxLength = 100_000

type NoteWriteIntent = {
  version: number
  entryId: string
  sessionId: string
  body?: RichEditorDocument
  kind: 'write' | 'editor'
  expectedCurrentBody?: string
  compensationPending?: boolean
}

type TitleIntent = {
  revision: number
  baselineTitle: string
  backendTitle: string
  compensationPending: boolean
}

export function createSessionWriteActions(ctx: SessionActionsContext) {
  let sessionNavigationEpoch = 0
  const noteWriteIntents = new Map<string, NoteWriteIntent>()
  const pendingWriteOperations = new Set<Promise<unknown>>()
  const titleIntents = new Map<string, TitleIntent>()

  function trackWrite<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() => pendingWriteOperations.delete(tracked))
    pendingWriteOperations.add(tracked)
    return tracked
  }

  async function waitForPendingSessionWrites(): Promise<void> {
    while (pendingWriteOperations.size > 0) {
      await Promise.allSettled(Array.from(pendingWriteOperations))
    }
  }

  function titleIntentFor(sessionId: string, fallbackTitle: string): TitleIntent {
    const current = titleIntents.get(sessionId)
    if (current) return current
    const created = { revision: 0, baselineTitle: fallbackTitle, backendTitle: fallbackTitle, compensationPending: false }
    titleIntents.set(sessionId, created)
    return created
  }

  function initializeTitleIntent(sessionId: string, title: string) {
    titleIntentFor(sessionId, title)
  }

  function resetTitleIntent(sessionId: string, title: string) {
    const intent = titleIntentFor(sessionId, title)
    intent.baselineTitle = title
    intent.backendTitle = title
    intent.compensationPending = false
  }

  function clearTitleIntent(sessionId: string) {
    const intent = titleIntents.get(sessionId)
    if (intent) intent.revision += 1
    titleIntents.delete(sessionId)
  }

  function discardTitleEditIntent(sessionId: string, baselineTitle: string) {
    const intent = titleIntentFor(sessionId, baselineTitle)
    intent.revision += 1
    intent.baselineTitle = baselineTitle
  }

  function publishTitleBaseline(sessionId: string, saved: Session, updateEditorIfMatching?: string) {
    ctx.session.setSessions((previous) => previous.map((session) => (session.id === saved.id ? saved : session)))
    if (ctx.session.activeSessionIdRef.current !== sessionId) return
    ctx.session.savedTitleRef.current = saved.title
    if (updateEditorIfMatching === undefined || ctx.session.sessionTitleRef.current === updateEditorIfMatching) {
      ctx.session.setSessionTitle(saved.title)
    }
    ctx.session.setActiveSession(saved)
  }

  async function reconcileSavedTitleAfterStaleWrite(sessionId: string, staleTitle: string): Promise<boolean> {
    const intent = titleIntents.get(sessionId)
    if (!intent) return true
    intent.backendTitle = staleTitle
    if (intent.backendTitle === intent.baselineTitle) {
      intent.compensationPending = false
      return true
    }
    intent.compensationPending = true
    const restoredTitle = intent.baselineTitle
    try {
      const restored = await trackWrite(updateSession(sessionId, { title: restoredTitle }))
      intent.backendTitle = restored.title
      intent.compensationPending = intent.backendTitle !== intent.baselineTitle
      publishTitleBaseline(sessionId, restored, restoredTitle)
      if (intent.compensationPending) return reconcileSavedTitleAfterStaleWrite(sessionId, restored.title)
      return true
    } catch (cause) {
      intent.compensationPending = true
      const staleSession = ctx.session.sessions.find((session) => session.id === sessionId)
      if (staleSession) {
        ctx.session.setSessions((previous) => previous.map((session) => (
          session.id === sessionId ? { ...session, title: staleTitle } : session
        )))
      }
      if (ctx.session.activeSessionIdRef.current === sessionId) {
        ctx.session.savedTitleRef.current = staleTitle
        ctx.session.setActiveSession((current) => current?.id === sessionId ? { ...current, title: staleTitle } : current)
      }
      ctx.feedback.setError(formatError(cause))
      return false
    }
  }

  async function retryPendingTitleCompensation(sessionId: string): Promise<boolean> {
    const intent = titleIntents.get(sessionId)
    if (!intent?.compensationPending) return true
    return reconcileSavedTitleAfterStaleWrite(sessionId, intent.backendTitle)
  }

  function reserveNoteWrite(
    body: RichEditorDocument,
    entryId: string,
    sessionId: string,
    options: { version?: number; expectedCurrentBody?: string } = {},
  ): NoteWriteIntent {
    const version = options.version ?? ++ctx.session.noteBodyWriteVersionRef.current
    const intent: NoteWriteIntent = { version, entryId, sessionId, body, kind: 'write', expectedCurrentBody: options.expectedCurrentBody }
    noteWriteIntents.set(entryId, intent)
    return intent
  }

  function supersedeNoteWritesWithCurrentSavedBody() {
    const entryId = ctx.session.noteEntryIdRef.current
    const sessionId = ctx.session.activeSessionIdRef.current
    if (!entryId || !sessionId) {
      ctx.session.noteBodyWriteVersionRef.current += 1
      return
    }
    const body = parseRichEditorDocument(ctx.session.savedBodyRef.current) ?? emptyRichEditorDocument
    reserveNoteWrite(body, entryId, sessionId)
  }

  function adoptCanonicalNoteBody(body: RichEditorDocument, entryId: string, sessionId: string) {
    reserveNoteWrite(body, entryId, sessionId)
  }

  function invalidateSessionNavigationForEdit() {
    sessionNavigationEpoch += 1
    ctx.summaryRecovery.openingSessionIdRef.current = null
    ctx.feedback.setBusyAction((current) => (
      current === 'open-session'
      || current === 'new-session'
      || current === 'save-title'
      || current === 'save-body'
        ? null
        : current
    ))
  }

  function registerTitleEditIntent() {
    const sessionId = ctx.session.activeSessionIdRef.current
    if (sessionId) {
      const intent = titleIntentFor(sessionId, ctx.session.savedTitleRef.current)
      intent.revision += 1
      ctx.session.sessionTitleWriteVersionRef.current += 1
    }
    invalidateSessionNavigationForEdit()
  }

  function registerNoteEditIntent(_body: RichEditorDocument) {
    const version = ++ctx.session.noteBodyWriteVersionRef.current
    const entryId = ctx.session.noteEntryIdRef.current
    const sessionId = ctx.session.activeSessionIdRef.current
    if (entryId && sessionId) {
      noteWriteIntents.set(entryId, { version, entryId, sessionId, kind: 'editor' })
    }
    // `body` is intentionally not made a compensating write. It may still
    // contain inline images, or represent the generated side of a recovered
    // Summary decision rather than the authored body that Save will choose.
    invalidateSessionNavigationForEdit()
  }

  function registerRecordEditIntent() {
    invalidateSessionNavigationForEdit()
  }

  function selectRecoveredSummaryChoice(choice: 'authored' | 'generated') {
    const decision = ctx.latestNoteGenerationUndoRef.current
    if (!decision?.pendingRecoveryDecision) return
    const next = { ...decision, pendingRecoveryChoice: choice }
    ctx.latestNoteGenerationUndoRef.current = next
    ctx.generation.setLatestNoteGenerationUndo(next)
  }

  async function reconcileNoteAfterStaleWrite(entryId: string, staleEntry: Awaited<ReturnType<typeof updateEntry>>): Promise<boolean> {
    const intent = noteWriteIntents.get(entryId)
    if (!intent) return true
    if (intent.kind === 'editor' || !intent.body) {
      if (
        ctx.session.activeSessionIdRef.current === intent.sessionId
        && ctx.session.noteEntryIdRef.current === entryId
      ) {
        ctx.session.setNoteEntry(staleEntry)
        ctx.session.savedBodyRef.current = serializeRichEditorDocument(richEditorDocumentFromStoredBody(staleEntry))
      }
      return true
    }
    intent.compensationPending = true
    try {
      const restored = await trackWrite(updateEntry(entryId, richEditorDocumentToStoredBody(intent.body)))
      if (noteWriteIntents.get(entryId) !== intent) return reconcileNoteAfterStaleWrite(entryId, restored)
      intent.compensationPending = false
      if (
        ctx.session.activeSessionIdRef.current === intent.sessionId
        && ctx.session.noteEntryIdRef.current === entryId
      ) {
        ctx.session.setNoteEntry(restored)
        ctx.session.savedBodyRef.current = serializeRichEditorDocument(richEditorDocumentFromStoredBody(restored))
      }
      return true
    } catch (cause) {
      if (noteWriteIntents.get(entryId) !== intent) return reconcileNoteAfterStaleWrite(entryId, staleEntry)
      intent.compensationPending = true
      if (
        ctx.session.activeSessionIdRef.current === intent.sessionId
        && ctx.session.noteEntryIdRef.current === entryId
      ) {
        // Keep the desired body visible, but baseline it against the stale
        // value known to have landed. This restores dirty state and schedules
        // an ordinary autosave retry rather than hiding a failed compensation.
        ctx.session.savedBodyRef.current = serializeRichEditorDocument(richEditorDocumentFromStoredBody(staleEntry))
        ctx.session.setNoteEntry(staleEntry)
        ctx.session.setNoteBody(intent.body)
      }
      ctx.feedback.setError(formatError(cause))
      return false
    }
  }

  async function retryPendingNoteCompensation(sessionId: string): Promise<boolean> {
    for (const intent of noteWriteIntents.values()) {
      if (intent.sessionId !== sessionId || !intent.compensationPending) continue
      if (!intent.body) return false
      try {
        const restored = await trackWrite(updateEntry(intent.entryId, richEditorDocumentToStoredBody(intent.body)))
        if (noteWriteIntents.get(intent.entryId) !== intent) {
          if (!await retryPendingNoteCompensation(sessionId)) return false
          continue
        }
        intent.compensationPending = false
        if (
          ctx.session.activeSessionIdRef.current === sessionId
          && ctx.session.noteEntryIdRef.current === intent.entryId
        ) {
          ctx.session.setNoteEntry(restored)
          ctx.session.savedBodyRef.current = serializeRichEditorDocument(intent.body)
        }
      } catch (cause) {
        intent.compensationPending = true
        ctx.feedback.setError(formatError(cause))
        return false
      }
    }
    return true
  }

  function hasPendingSessionCompensations(): boolean {
    return pendingWriteOperations.size > 0
      || Array.from(titleIntents.values()).some((intent) => intent.compensationPending)
      || Array.from(noteWriteIntents.values()).some((intent) => intent.compensationPending)
  }

  async function retryAllPendingSessionCompensations(): Promise<boolean> {
    let reconciled = true
    for (const [sessionId, intent] of titleIntents) {
      if (intent.compensationPending && !await retryPendingTitleCompensation(sessionId)) reconciled = false
    }
    const pendingNoteSessionIds = new Set(
      Array.from(noteWriteIntents.values())
        .filter((intent) => intent.compensationPending)
        .map((intent) => intent.sessionId),
    )
    for (const sessionId of pendingNoteSessionIds) {
      if (!await retryPendingNoteCompensation(sessionId)) reconciled = false
    }
    return reconciled
  }

  function beginSessionNavigation(): number {
    ctx.summaryRecovery.openingSessionIdRef.current = null
    sessionNavigationEpoch += 1
    ctx.feedback.setBusyAction((current) => (
      current === 'open-session' || current === 'new-session' ? null : current
    ))
    return sessionNavigationEpoch
  }

  function sessionNavigationIsCurrent(epoch: number): boolean {
    return epoch === sessionNavigationEpoch
  }

  function summaryRecoveryBlocksNoteSave(sessionId: string): boolean {
    return ctx.summaryRecovery.discoveryPendingRef.current
      || Array.from(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.values()).includes(sessionId)
  }

  function noteSaveIsBlocked(sessionId: string): boolean {
    if (!summaryRecoveryBlocksNoteSave(sessionId)) return false
    ctx.summaryRecovery.blockedSaveSessionIdsRef.current.add(sessionId)
    return true
  }

  function recoveryDiscoveryAllowsNoteHydration(): boolean {
    if (!ctx.summaryRecovery.discoveryPendingRef.current) return true
    ctx.feedback.setError('Session recovery status is unavailable. Restart QA Scribe before opening an editable Note.')
    return false
  }

  async function saveTitle(title: string, options: { manageBusy?: boolean } = {}): Promise<boolean> {
    const { manageBusy = true } = options
    if (!ctx.session.activeSession || ctx.session.deletingSessionIdRef.current === ctx.session.activeSession.id) return false
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      ctx.feedback.setError('Session title is required.')
      return false
    }
    const sessionId = ctx.session.activeSession.id
    const titleIntent = titleIntentFor(sessionId, ctx.session.savedTitleRef.current)
    const intentRevision = ++titleIntent.revision
    const writeVersion = ++ctx.session.sessionTitleWriteVersionRef.current
    try {
      if (manageBusy) ctx.feedback.setBusyAction('save-title')
      const saved = await trackWrite(updateSession(sessionId, { title: normalizedTitle }))
      titleIntent.backendTitle = saved.title
      if (intentRevision !== titleIntent.revision) {
        return reconcileSavedTitleAfterStaleWrite(sessionId, saved.title)
      }
      titleIntent.baselineTitle = saved.title
      titleIntent.compensationPending = false
      publishTitleBaseline(sessionId, saved, title)
      ctx.feedback.setNotice('Session saved')
      return true
    } catch (cause) {
      if (intentRevision !== titleIntent.revision) return true
      ctx.feedback.setError(formatError(cause))
      return false
    } finally {
      if (manageBusy && writeVersion === ctx.session.sessionTitleWriteVersionRef.current) ctx.feedback.setBusyAction(null)
    }
  }

  async function saveBody(
    body: RichEditorDocument,
    options: {
      manageBusy?: boolean
      writeVersion?: number
      entryId?: string
      sessionId?: string
      expectedCurrentBody?: string
      allowRecoveryWrite?: boolean
    } = {},
  ): Promise<boolean> {
    const { manageBusy = true } = options
    if (!ctx.session.noteEntry || ctx.session.deletingSessionIdRef.current === ctx.session.noteEntry.sessionId) return false
    if (!options.allowRecoveryWrite && noteSaveIsBlocked(ctx.session.noteEntry.sessionId)) return false
    const storedBody = richEditorDocumentToStoredBody(body)
    if (storedBody.body.length > noteBodyMaxLength) {
      ctx.feedback.setError('Note is too large to autosave. This usually means an image was embedded directly in the note; paste images again so QA Scribe can store them as attachments.')
      return false
    }
    const entryId = options.entryId ?? ctx.session.noteEntry.id
    const sessionId = options.sessionId ?? ctx.session.noteEntry.sessionId
    const intent = reserveNoteWrite(body, entryId, sessionId, {
      version: options.writeVersion,
      expectedCurrentBody: options.expectedCurrentBody,
    })
    const writeVersion = intent.version
    if (
      writeVersion !== ctx.session.noteBodyWriteVersionRef.current
      || entryId !== ctx.session.noteEntryIdRef.current
      || sessionId !== ctx.session.activeSessionIdRef.current
    ) return true
    try {
      if (manageBusy) ctx.feedback.setBusyAction('save-body')
      const saved = await trackWrite(updateEntry(entryId, storedBody))
      if (
        writeVersion !== ctx.session.noteBodyWriteVersionRef.current
        || noteWriteIntents.get(entryId) !== intent
      ) return reconcileNoteAfterStaleWrite(entryId, saved)
      if (
        entryId !== ctx.session.noteEntryIdRef.current
        || sessionId !== ctx.session.activeSessionIdRef.current
        || saved.id !== entryId
        || saved.sessionId !== sessionId
        || (
          intent.expectedCurrentBody !== undefined
          && serializeRichEditorDocument(ctx.session.noteBodyRef.current) !== intent.expectedCurrentBody
        )
      ) return true
      ctx.session.savedBodyRef.current = serializeRichEditorDocument(richEditorDocumentFromStoredBody(saved))
      ctx.session.setNoteEntry(saved)
      ctx.feedback.setNotice('Note saved')
      return true
    } catch (cause) {
      if (writeVersion !== ctx.session.noteBodyWriteVersionRef.current || noteWriteIntents.get(entryId) !== intent) return true
      ctx.feedback.setError(formatError(cause))
      return false
    } finally {
      if (manageBusy && writeVersion === ctx.session.noteBodyWriteVersionRef.current) ctx.feedback.setBusyAction(null)
    }
  }

  return {
    adoptCanonicalNoteBody,
    beginSessionNavigation,
    clearTitleIntent,
    discardTitleEditIntent,
    hasPendingSessionCompensations,
    initializeTitleIntent,
    noteSaveIsBlocked,
    recoveryDiscoveryAllowsNoteHydration,
    registerNoteEditIntent,
    registerRecordEditIntent,
    registerTitleEditIntent,
    reserveNoteWrite,
    resetTitleIntent,
    retryAllPendingSessionCompensations,
    retryPendingNoteCompensation,
    retryPendingTitleCompensation,
    saveBody,
    saveTitle,
    selectRecoveredSummaryChoice,
    sessionNavigationIsCurrent,
    supersedeNoteWritesWithCurrentSavedBody,
    waitForPendingSessionWrites,
  }
}

export type SessionWriteActions = ReturnType<typeof createSessionWriteActions>
