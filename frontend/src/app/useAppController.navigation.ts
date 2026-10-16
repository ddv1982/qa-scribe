import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Session } from '../tauri'
import type { MainView } from '../ui/types'
import { navigationHash } from './navigationRoute'
import { createSessionNavigationActions } from './sessionNavigationActions'
import type { AppSettlement } from './appSettlement'
import type { useRecordActions } from './recordActions'
import type { useSessionActions } from './sessionActions'
import type { useSessionChat } from './useSessionChat'

type AppControllerNavigationContext = {
  chat: Pick<ReturnType<typeof useSessionChat>, 'flush' | 'hasPendingChanges' | 'recoverSession'>
  activeSession: Session | null
  activeView: MainView
  settlement: AppSettlement
  dirtyDraftIdsRef: MutableRefObject<Set<string>>
  dirtyFindingIdsRef: MutableRefObject<Set<string>>
  discardSettingsDraft: () => void
  focusedRecordId: string | null
  pendingNavigationContinuationRef: MutableRefObject<(() => void | Promise<void>) | null>
  pendingNavigationEpochRef: MutableRefObject<number>
  pendingNavigationView: MainView | null
  recordActions: ReturnType<typeof useRecordActions>
  sessionActions: ReturnType<typeof useSessionActions>
  sessions: Session[]
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
    const epoch = ctx.sessionActions.beginSessionNavigation()
    if (view === ctx.activeView) return
    if (ctx.chat.hasPendingChanges()) {
      void ctx.chat.flush().then((saved) => {
        if (saved && ctx.sessionActions.sessionNavigationIsCurrent(epoch)) finishActiveViewNavigation(view)
      })
      return
    }
    finishActiveViewNavigation(view)
  }

  function finishActiveViewNavigation(view: MainView) {
    const { titleDirty, recoveryChoice } = ctx.sessionActions.settlement.snapshot()
    if (
      titleDirty
      || recoveryChoice
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

  async function requestSessionNavigation(view: MainView, navigate: () => Promise<void>): Promise<void> {
    const epoch = ctx.sessionActions.beginSessionNavigation()
    if (!await ctx.chat.flush() || !ctx.sessionActions.sessionNavigationIsCurrent(epoch)) return
    // A recovered Summary represents two valid canonical outcomes and must not
    // be silently selected by the ordinary Session-switch flush.
    if (ctx.sessionActions.settlement.snapshot().recoveryChoice) {
      ctx.pendingNavigationEpochRef.current += 1
      ctx.pendingNavigationContinuationRef.current = navigate
      ctx.setPendingNavigationView(view)
      return
    }
    await navigate()
  }

  function requestOpenSession(session: Session, showNotice = true, onOpened?: () => void): Promise<void> {
    if (ctx.activeSession?.id === session.id) {
      ctx.sessionActions.beginSessionNavigation()
      return ctx.chat.recoverSession(session.id).then(() => undefined)
    }
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
    if (ctx.sessionActions.settlement.snapshot().recoveryChoice) ctx.sessionActions.selectRecoveredSummaryChoice('authored')
    const saved = await ctx.settlement.flush()
    if (!saved || !destination || ctx.pendingNavigationEpochRef.current !== navigationEpoch) return
    ctx.pendingNavigationEpochRef.current += 1
    const continuation = ctx.pendingNavigationContinuationRef.current
    ctx.pendingNavigationContinuationRef.current = null
    ctx.setPendingNavigationView(null)
    if (continuation) await continuation()
    else ctx.setActiveView(destination)
  }

  function discardPendingNavigationChanges(): void | Promise<void> {
    if (ctx.chat.hasPendingChanges()) {
      return ctx.chat.flush().then((saved) => saved ? discardOtherPendingNavigationChanges() : undefined)
    }
    return discardOtherPendingNavigationChanges()
  }

  function discardOtherPendingNavigationChanges(): void | Promise<void> {
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


  return {
    ...sessionNavigationActions,
    openSessionInCurrentView: async (session: Session) => {
      if (ctx.activeSession?.id === session.id) {
        ctx.sessionActions.beginSessionNavigation()
        await ctx.chat.recoverSession(session.id)
        return
      }
      await sessionNavigationActions.openSessionInCurrentView(session)
    },
    cancelPendingNavigation,
    closeSettings,
    discardPendingNavigationChanges,
    openSettingsSection,
    requestActiveView,
    requestNewSession,
    requestOpenSession,
    savePendingNavigationChanges,
  }
}
