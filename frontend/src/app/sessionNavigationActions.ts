import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { reopenSession, type Session } from '../tauri'
import { formatError } from '../ui/format'
import type { MainView } from '../ui/types'
import type { AppNavigationRoute } from './navigationRoute'

type SessionOpenActions = {
  beginSessionNavigation: () => number
  sessionNavigationIsCurrent: (epoch: number) => boolean
  openSession: (
    session: Session,
    showNotice?: boolean,
    onOpened?: () => void,
    requestedEpoch?: number,
  ) => Promise<void>
}

type SessionNavigationContext = {
  activeSessionId: string | null
  activeView: MainView
  sessions: Session[]
  settingsReturnViewRef: MutableRefObject<MainView>
  sessionActions: SessionOpenActions
  requestActiveView: (view: MainView) => void
  requestSessionNavigation: (view: MainView, navigate: () => Promise<void>) => Promise<void>
  setActiveView: Dispatch<SetStateAction<MainView>>
  setError: Dispatch<SetStateAction<string | null>>
  setFocusedRecordId: Dispatch<SetStateAction<string | null>>
  setPendingSettingsSection: Dispatch<SetStateAction<string | null>>
  setSettingsSection: Dispatch<SetStateAction<string | null>>
}

export function createSessionNavigationActions(ctx: SessionNavigationContext) {
  function openSessionInCurrentView(session: Session) {
    const destination = ctx.activeView === 'testware' || ctx.activeView === 'findings'
      ? ctx.activeView
      : 'sessions'
    if (ctx.activeSessionId === session.id) {
      ctx.sessionActions.beginSessionNavigation()
      return Promise.resolve()
    }
    return ctx.requestSessionNavigation(destination, () => ctx.sessionActions.openSession(session, true, () => ctx.setActiveView(destination)))
  }

  async function openLibraryRecord(sessionId: string, view: 'testware' | 'findings', recordId: string) {
    await ctx.requestSessionNavigation(view, async () => {
      const epoch = ctx.sessionActions.beginSessionNavigation()
      try {
        const session = ctx.sessions.find((candidate) => candidate.id === sessionId) ?? await reopenSession(sessionId)
        if (!ctx.sessionActions.sessionNavigationIsCurrent(epoch)) return
        await ctx.sessionActions.openSession(session, false, () => {
          ctx.setFocusedRecordId(recordId)
          ctx.setActiveView(view)
        }, epoch)
      } catch (cause) {
        if (ctx.sessionActions.sessionNavigationIsCurrent(epoch)) {
          ctx.setError(`Could not open the selected output. ${formatError(cause)}`)
        }
      }
    })
  }

  async function applyNavigationRoute(route: AppNavigationRoute) {
    if (route.kind === 'settings') {
      if (ctx.activeView !== 'settings') ctx.settingsReturnViewRef.current = ctx.activeView
      ctx.setSettingsSection(route.sectionId)
      ctx.setPendingSettingsSection(route.sectionId)
      ctx.requestActiveView('settings')
      return
    }
    if (route.kind === 'library') {
      ctx.requestActiveView(route.view)
      return
    }
    if (!route.sessionId || ctx.activeSessionId === route.sessionId) {
      ctx.setFocusedRecordId(route.recordId)
      ctx.requestActiveView(route.view)
      return
    }
    await ctx.requestSessionNavigation(route.view, async () => {
      const epoch = ctx.sessionActions.beginSessionNavigation()
      try {
        const session = ctx.sessions.find((candidate) => candidate.id === route.sessionId) ?? await reopenSession(route.sessionId!)
        if (!ctx.sessionActions.sessionNavigationIsCurrent(epoch)) return
        await ctx.sessionActions.openSession(session, false, () => {
          ctx.setFocusedRecordId(route.recordId)
          ctx.setActiveView(route.view)
        }, epoch)
      } catch (cause) {
        if (ctx.sessionActions.sessionNavigationIsCurrent(epoch)) {
          ctx.setError(`Could not open the linked workspace. ${formatError(cause)}`)
        }
      }
    })
  }

  return { applyNavigationRoute, openLibraryRecord, openSessionInCurrentView }
}
