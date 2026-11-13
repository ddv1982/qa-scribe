import type { Draft, Finding, Session } from '../tauri'

export type DeleteConfirmation =
  | { kind: 'session'; session: Session }
  /** `testRunCount`: how many test runs of the draft are deleted with it. */
  | { kind: 'draft'; draft: Draft; testRunCount?: number }
  | { kind: 'finding'; finding: Finding }

export function deleteConfirmationCopy(confirmation: DeleteConfirmation) {
  if (confirmation.kind === 'session') {
    return {
      title: `Delete “${confirmation.session.title}”?`,
      body: 'This removes the Session, its Note Entry, testware, findings, and attachments. This cannot be undone.',
      confirmLabel: 'Delete Session permanently',
    }
  }

  if (confirmation.kind === 'draft') {
    const runs = confirmation.testRunCount ?? 0
    return {
      title: `Delete "${confirmation.draft.title}"?`,
      body: runs === 0
        ? 'This removes this testware draft only. AI run history is kept. This cannot be undone.'
        : `This removes this testware draft. ${runs === 1 ? 'Its test run is' : `Its ${runs} test runs are`} deleted too. AI run history is kept. This cannot be undone.`,
      confirmLabel: 'Delete testware permanently',
    }
  }

  return {
    title: `Delete "${confirmation.finding.title}"?`,
    body: 'This removes this finding and its evidence links. Source notes and attachments are kept. This cannot be undone.',
    confirmLabel: 'Delete finding permanently',
  }
}
