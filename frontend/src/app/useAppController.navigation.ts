import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Session } from '../tauri'
import { serializeRichEditorDocument } from '../editor/editorDocument'
import type { MainView } from '../ui/types'
import { navigationHash } from './navigationRoute'
import { createSessionNavigationActions } from './sessionNavigationActions'
import type { SessionWorkspace } from './types'
import type { useAttachmentActions } from './attachmentActions'
import type { useRecordActions } from './recordActions'
import type { useSessionActions } from './sessionActions'

type AppControllerNavigationContext = {
  activeSession: Session | null
  activeView: MainView
  attachmentActions: ReturnType<typeof useAttachmentActions>
  dirtyDraftIdsRef: MutableRefObject<Set<string>>
  dirtyFindingIdsRef: MutableRefObject<Set<string>>
  discardSettingsDraft: () => void
  focusedRecordId: string | null
  pendingNavigationContinuationRef: MutableRefObject<(() => void | Promise<void>) | null>
  pendingNavigationEpochRef: MutableRefObject<number>
  pendingNavigationView: MainView | null
  pendingRecoveredSummaryDecision: boolean
  recordActions: ReturnType<typeof useRecordActions>
  savedTitleRef: MutableRefObject<string>
  saveSettingsDraft: () => Promise<boolean>
  sessionActions: ReturnType<typeof useSessionActions>
  sessions: Session[]
  sessionTitle: string
  sessionWorkspace: SessionWorkspace
  settingsDirty: boolean
  settingsReturnViewRef: MutableRefObject<MainView>
  settingsSection: string | null
  setActiveView: Dispatch<SetStateAction<MainView>>
  setError: Dispatch<SetStateAction<string | null>>
  setFocusedRecordId: Dispatch<SetStateAction<string | null>>
  setPendingNavigationView: Dispatch<SetStateAction<MainView | null>>
  setPendingSettingsSection: Dispatch<SetStateAction<string | null>>
  setSettingsSection: Dispatch<SetStateAction<string | null>>
}

export function useAppControllerNavigation(ctx: AppControllerNavigationContext) {
  function requestActiveView(view: MainView) {
    ctx.sessionActions.beginSessionNavigation()
    if (view === ctx.activeView) return
    const titlePending = Boolean(ctx.activeSession && ctx.sessionTitle !== ctx.savedTitleRef.current)
    if (
      titlePending
      || ctx.pendingRecoveredSummaryDecision
      || ctx.settingsDirty
      || ctx.dirtyDraftIdsRef.current.size > 0
      || ctx.dirtyFindingIdsRef.current.size > 0
    ) {
      ctx.pendingNavigationEpochRef.current += 1
      ctx.pendingNavigationContinuationRef.current = () => ctx.setActiveView(view)
      ctx.setPendingNavigationView(view)
      return
    }
    ctx.setActiveView(view)
  }

  function openSettingsSection(sectionId?: string) {
    if (ctx.activeView !== 'settings') ctx.settingsReturnViewRef.current = ctx.activeView
    const nextSection = sectionId ?? null
    ctx.setSettingsSection(nextSection)
    ctx.setPendingSettingsSection(nextSection)
    requestActiveView('settings')
  }

  function closeSettings() { requestActiveView(ctx.settingsReturnViewRef.current) }

  function requestSessionNavigation(view: MainView, navigate: () => Promise<void>): Promise<void> {
    // A recovered Summary represents two valid canonical outcomes and must not
    // be silently selected by the ordinary Session-switch flush.
    if (ctx.pendingRecoveredSummaryDecision) {
      ctx.pendingNavigationEpochRef.current += 1
      ctx.pendingNavigationContinuationRef.current = navigate
      ctx.setPendingNavigationView(view)
      return Promise.resolve()
    }
    return navigate()
  }

  function requestOpenSession(session: Session, showNotice = true, onOpened?: () => void): Promise<void> {
    if (ctx.activeSession?.id === session.id) return Promise.resolve()
    const destination = ctx.activeView === 'testware' || ctx.activeView === 'findings' ? ctx.activeView : 'sessions'
    return requestSessionNavigation(destination, () => ctx.sessionActions.openSession(session, showNotice, onOpened))
  }

  function requestNewSession(): Promise<void> {
    return requestSessionNavigation('sessions', ctx.sessionActions.handleNewSession)
  }

  const sessionNavigationActions = createSessionNavigationActions({
    activeSessionId: ctx.activeSession?.id ?? null,
    activeView: ctx.activeView,
    sessions: ctx.sessions,
    settingsReturnViewRef: ctx.settingsReturnViewRef,
    sessionActions: ctx.sessionActions,
    requestActiveView,
    requestSessionNavigation,
    setActiveView: ctx.setActiveView,
    setError: ctx.setError,
    setFocusedRecordId: ctx.setFocusedRecordId,
    setPendingSettingsSection: ctx.setPendingSettingsSection,
    setSettingsSection: ctx.setSettingsSection,
  })

  async function savePendingNavigationChanges() {
    const navigationEpoch = ctx.pendingNavigationEpochRef.current
    const destination = ctx.pendingNavigationView
    if (ctx.pendingRecoveredSummaryDecision) ctx.sessionActions.selectRecoveredSummaryChoice('authored')
    const saved = await saveAllPendingChanges()
    if (!saved || !destination || ctx.pendingNavigationEpochRef.current !== navigationEpoch) return
    ctx.pendingNavigationEpochRef.current += 1
    const continuation = ctx.pendingNavigationContinuationRef.current
    ctx.pendingNavigationContinuationRef.current = null
    ctx.setPendingNavigationView(null)
    if (continuation) await continuation()
    else ctx.setActiveView(destination)
  }

  function discardPendingNavigationChanges(): void | Promise<void> {
    const navigationEpoch = ctx.pendingNavigationEpochRef.current
    const destination = ctx.pendingNavigationView
    if (!destination) return
    const finishDiscard = (discarded: boolean): void | Promise<void> => {
      if (!discarded || ctx.pendingNavigationEpochRef.current !== navigationEpoch) return
      ctx.pendingNavigationEpochRef.current += 1
      ctx.recordActions.discardAllDirtyRecords()
      if (ctx.dirtyDraftIdsRef.current.size > 0 || ctx.dirtyFindingIdsRef.current.size > 0) return
      if (ctx.settingsDirty) ctx.discardSettingsDraft()
      const continuation = ctx.pendingNavigationContinuationRef.current
      ctx.pendingNavigationContinuationRef.current = null
      ctx.setPendingNavigationView(null)
      if (continuation) return Promise.resolve(continuation()).then(() => undefined)
      ctx.setActiveView(destination)
    }
    const discarded = ctx.sessionActions.discardPendingSessionEdits()
    return discarded instanceof Promise ? discarded.then(finishDiscard) : finishDiscard(discarded)
  }

  function cancelPendingNavigation() {
    ctx.pendingNavigationEpochRef.current += 1
    ctx.pendingNavigationContinuationRef.current = null
    ctx.setPendingNavigationView(null)
    window.history.replaceState(null, '', navigationHash({
      activeView: ctx.activeView,
      sessionId: ctx.activeSession?.id ?? null,
      focusedRecordId: ctx.focusedRecordId,
      settingsSectionId: ctx.settingsSection,
    }))
  }

  async function saveAllPendingChanges(): Promise<boolean> {
    let sessionSaved = true
    for (;;) {
      await ctx.attachmentActions.waitForPendingAttachmentMutations()
      const flushed = await ctx.sessionActions.savePendingSessionEdits()
      sessionSaved = flushed && sessionSaved
      await Promise.all([
        ctx.sessionActions.waitForPendingSessionWrites(),
        ctx.recordActions.waitForPendingRecordWrites(),
        ctx.attachmentActions.waitForPendingAttachmentMutations(),
      ])
      const titleWriteVersion = ctx.sessionWorkspace.sessionTitleWriteVersionRef.current
      const noteWriteVersion = ctx.sessionWorkspace.noteBodyWriteVersionRef.current
      const sessionCompensated = await ctx.sessionActions.retryAllPendingSessionCompensations()
      const recordsCompensated = await ctx.recordActions.retryAllPendingRecordCompensations()
      const attachmentsCleaned = await ctx.attachmentActions.retryPendingAttachmentCleanup()
      if (!sessionCompensated || !recordsCompensated || !attachmentsCleaned) return false
      if (!flushed) return false
      await Promise.all([
        ctx.sessionActions.waitForPendingSessionWrites(),
        ctx.recordActions.waitForPendingRecordWrites(),
        ctx.attachmentActions.waitForPendingAttachmentMutations(),
      ])
      const sessionRefsDirty = Boolean(
        ctx.sessionWorkspace.activeSessionIdRef.current
        && (
          ctx.sessionWorkspace.sessionTitleRef.current !== ctx.sessionWorkspace.savedTitleRef.current
          || (
            ctx.sessionWorkspace.noteEntryIdRef.current
            && serializeRichEditorDocument(ctx.sessionWorkspace.noteBodyRef.current) !== ctx.sessionWorkspace.savedBodyRef.current
          )
        ),
      )
      if (
        titleWriteVersion === ctx.sessionWorkspace.sessionTitleWriteVersionRef.current
        && noteWriteVersion === ctx.sessionWorkspace.noteBodyWriteVersionRef.current
        && !sessionRefsDirty
        && !ctx.attachmentActions.hasPendingAttachmentOperations()
        && !ctx.sessionActions.hasPendingSessionEdits()
        && !hasPendingCompensations()
      ) break
    }
    const settingsSaved = !ctx.settingsDirty || await ctx.saveSettingsDraft()
    return sessionSaved && settingsSaved
  }

  function hasPendingCompensations() {
    return ctx.sessionActions.hasPendingSessionCompensations()
      || ctx.recordActions.hasPendingRecordCompensations()
      || ctx.attachmentActions.hasPendingAttachmentMutations()
  }

  return {
    ...sessionNavigationActions,
    cancelPendingNavigation,
    closeSettings,
    discardPendingNavigationChanges,
    hasPendingCompensations,
    openSettingsSection,
    requestActiveView,
    requestNewSession,
    requestOpenSession,
    saveAllPendingChanges,
    savePendingNavigationChanges,
  }
}
