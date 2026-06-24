import type { Finding, Session } from '../tauri'
import type { ThemePreference } from './types'

export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length
}

export function formatError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  if (message.includes('Cannot read properties of undefined') && message.includes('invoke')) {
    return 'Desktop bridge unavailable in browser preview. Run the Tauri app for live local data.'
  }
  return message
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
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function nextUntitledTitle(sessions: Session[]): string {
  const highest = sessions.reduce((max, session) => {
    const match = /^Untitled note (\d+)$/.exec(session.title)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `Untitled note ${highest + 1}`
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
