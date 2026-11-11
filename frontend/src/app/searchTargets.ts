import { testwareGenerationSummary } from '../testware/generationPreferences'
import type { DraftLibraryItem, FindingLibraryItem, Session } from '../tauri'
import { formatFindingKind, formatSessionDate } from '../ui/format'
import type { SearchTarget } from './AppOverlays'

/** Saved work the command palette can jump to, most recently updated first within each group. */
export function createSearchTargets({ sessions, draftLibrary, findingLibrary, openSession, openRecord }: {
  sessions: Session[]
  draftLibrary: DraftLibraryItem[]
  findingLibrary: FindingLibraryItem[]
  openSession: (session: Session) => void
  openRecord: (sessionId: string, view: 'testware' | 'findings', recordId: string) => void
}): SearchTarget[] {
  const testCases = draftLibrary
    .filter((item) => item.draft.kind === 'testware')
    .sort((left, right) => right.draft.updatedAt.localeCompare(left.draft.updatedAt))
    .map(({ draft, sessionTitle }): SearchTarget => ({
      key: `draft:${draft.sessionId}:${draft.id}`,
      group: 'Test cases',
      label: draft.title.trim() || 'Untitled test case',
      // Repeated runs often share a title, so the format and time tell them apart.
      detail: [sessionTitle, testwareGenerationSummary(draft)?.format, formatSessionDate(draft.updatedAt)].filter(Boolean).join(' · '),
      text: `${draft.title} ${sessionTitle}`.toLocaleLowerCase(),
      open: () => openRecord(draft.sessionId, 'testware', draft.id),
    }))
  const findings = [...findingLibrary]
    .sort((left, right) => right.finding.updatedAt.localeCompare(left.finding.updatedAt))
    .map(({ finding, sessionTitle }): SearchTarget => ({
      key: `finding:${finding.sessionId}:${finding.id}`,
      group: 'Findings',
      label: finding.title.trim() || 'Untitled finding',
      detail: `${formatFindingKind(finding.kind)} · ${sessionTitle}`,
      text: `${finding.title} ${sessionTitle}`.toLocaleLowerCase(),
      open: () => openRecord(finding.sessionId, 'findings', finding.id),
    }))
  return [
    ...sessions.map((session): SearchTarget => ({
      key: `session:${session.id}`,
      group: 'Sessions',
      label: session.title,
      detail: `Updated ${formatSessionDate(session.updatedAt)}`,
      text: session.title.toLocaleLowerCase(),
      open: () => openSession(session),
    })),
    ...testCases,
    ...findings,
  ]
}
