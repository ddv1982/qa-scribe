import type { CommandError, Finding, Session } from '../tauri'
import type { ResolvedTheme, ThemePreference } from './types'

export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length
}

const BRIDGE_UNAVAILABLE_MESSAGE =
  'Desktop bridge unavailable in browser preview. Run the Tauri app for live local data.'

function isCommandError(value: unknown): value is CommandError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as { kind: unknown }).kind === 'string' &&
    typeof (value as { message: unknown }).message === 'string'
  )
}

/**
 * Normalize a Tauri `invoke` rejection into a `CommandError`. The backend
 * rejects with the serialized `CommandError` object; the only remaining
 * string-sniffing lives here, isolated to detecting the "desktop bridge
 * unavailable" case (browser preview without the Tauri runtime, where
 * `invoke` itself throws before any command can run).
 */
export function toCommandError(cause: unknown): CommandError {
  if (isCommandError(cause)) return cause

  const message = cause instanceof Error ? cause.message : String(cause)
  if (message.includes('Cannot read properties of undefined') && message.includes('invoke')) {
    return { kind: 'internal', message: BRIDGE_UNAVAILABLE_MESSAGE }
  }
  return { kind: 'internal', message }
}

export function formatError(cause: unknown): string {
  const error = toCommandError(cause)
  if (error.kind === 'validation') return error.message
  // The bridge-unavailable message is already complete, user-facing copy
  // (assembled in toCommandError, not raw backend text) — prefixing it would
  // read as a stutter ("Something went wrong: Desktop bridge unavailable...").
  if (error.message === BRIDGE_UNAVAILABLE_MESSAGE) return error.message
  return `Something went wrong: ${error.message}`
}

export function formatFindingKind(kind: Finding['kind']): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatSessionDate(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'Updated'

  const elapsed = Date.now() - timestamp
  const day = 24 * 60 * 60 * 1000
  if (elapsed >= 0 && elapsed < day) return 'Today'
  if (elapsed >= day && elapsed < day * 2) return 'Yesterday'

  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(timestamp))
}

export function initialTheme(): ThemePreference {
  const stored = window.localStorage.getItem('qa-scribe-theme')
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

export function currentSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function resolveThemePreference(theme: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  return theme === 'system' ? systemTheme : theme
}

export function nextUntitledSessionTitle(sessions: Session[]): string {
  const highest = sessions.reduce((max, session) => {
    const match = /^Untitled session (\d+)$/.exec(session.title)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `Untitled session ${highest + 1}`
}

export function nextUntitledRecordTitle(records: Array<{ title: string }>, baseTitle: string): string {
  const pattern = new RegExp(`^${escapeRegExp(baseTitle)}(?: (\\d+))?$`)
  const highest = records.reduce((max, record) => {
    const match = pattern.exec(record.title)
    if (!match) return max
    return Math.max(max, match[1] ? Number(match[1]) : 1)
  }, 0)
  return highest === 0 ? baseTitle : `${baseTitle} ${highest + 1}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function statusLabel(status: string): string {
  return status.replace(/([A-Z])/g, ' $1').toLowerCase()
}
