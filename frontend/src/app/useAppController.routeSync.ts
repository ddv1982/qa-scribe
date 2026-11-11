import { useEffect, useRef, type RefObject } from 'react'
import type { ChatRef } from '../bindings'
import type { Session } from '../tauri'
import type { BusyAction, MainView } from '../ui/types'
import { navigationHash, parseNavigationRoute, type AppNavigationRoute } from './navigationRoute'

type NavigationRouteSyncOptions = {
  initialNavigationRoute: AppNavigationRoute | null
  bootedRef: RefObject<boolean>
  busyAction: BusyAction | null
  activeSession: Session | null
  activeView: MainView
  focusedRecordId: string | null
  settingsSection: string | null
  conversation: ChatRef | null
  applyNavigationRoute: (route: AppNavigationRoute) => Promise<unknown>
}

export function useNavigationRouteSync({
  initialNavigationRoute,
  bootedRef,
  busyAction,
  activeSession,
  activeView,
  focusedRecordId,
  settingsSection,
  conversation,
  applyNavigationRoute,
}: NavigationRouteSyncOptions) {
  const initialNavigationRouteRef = useRef(initialNavigationRoute)
  const navigationRouteHydratedRef = useRef(false)
  useEffect(() => {
    if (navigationRouteHydratedRef.current || !bootedRef.current || busyAction !== null) return
    const route = initialNavigationRouteRef.current
    navigationRouteHydratedRef.current = true
    if (!route) return
    const timeout = window.setTimeout(() => void applyNavigationRoute(route), 0)
    return () => window.clearTimeout(timeout)
  }, [activeSession, busyAction]) // oxlint-disable-line react-hooks/exhaustive-deps -- hydrate the immutable launch route once after startup
  useEffect(() => {
    function handleHistoryNavigation() {
      const route = parseNavigationRoute(window.location.hash)
      if (route) void applyNavigationRoute(route)
    }
    window.addEventListener('hashchange', handleHistoryNavigation)
    return () => window.removeEventListener('hashchange', handleHistoryNavigation)
  })
  useEffect(() => {
    if (!navigationRouteHydratedRef.current) return
    const nextHash = navigationHash({
      activeView,
      sessionId: activeSession?.id ?? null,
      focusedRecordId,
      settingsSectionId: settingsSection,
      conversation,
    })
    if (window.location.hash !== nextHash) window.history.pushState(null, '', nextHash)
  }, [activeSession?.id, activeView, focusedRecordId, settingsSection, conversation])
}
