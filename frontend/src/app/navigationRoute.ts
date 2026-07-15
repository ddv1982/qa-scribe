import type { MainView } from '../ui/types'

export type AppNavigationRoute =
  | { kind: 'session'; sessionId: string | null; view: 'sessions' | 'testware' | 'findings'; recordId: string | null }
  | { kind: 'library'; view: 'testware-library' | 'findings-library' }
  | { kind: 'settings'; sectionId: string | null }

export function parseNavigationRoute(hash: string): AppNavigationRoute | null {
  let parts: string[]
  try {
    parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
  if (parts[0] === 'settings') return { kind: 'settings', sectionId: parts[1] ?? null }
  if (parts[0] === 'libraries' && parts[1] === 'testware') return { kind: 'library', view: 'testware-library' }
  if (parts[0] === 'libraries' && parts[1] === 'findings') return { kind: 'library', view: 'findings-library' }
  if (parts[0] === 'sessions') {
    const view = parts[2] === 'testware' || parts[2] === 'findings' ? parts[2] : 'sessions'
    return { kind: 'session', sessionId: parts[1] ?? null, view, recordId: parts[3] ?? null }
  }
  return null
}

export function navigationHash({
  activeView,
  sessionId,
  focusedRecordId,
  settingsSectionId,
}: {
  activeView: MainView
  sessionId: string | null
  focusedRecordId: string | null
  settingsSectionId: string | null
}): string {
  if (activeView === 'settings') return routeHash(['settings', settingsSectionId])
  if (activeView === 'testware-library') return '#/libraries/testware'
  if (activeView === 'findings-library') return '#/libraries/findings'
  if (!sessionId) return '#/sessions'
  return routeHash(['sessions', sessionId, activeView === 'sessions' ? null : activeView, activeView === 'sessions' ? null : focusedRecordId])
}

function routeHash(parts: Array<string | null>): string {
  return `#/${parts.filter((part): part is string => Boolean(part)).map(encodeURIComponent).join('/')}`
}
