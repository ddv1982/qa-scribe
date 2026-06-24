import type { Draft, Finding, Session } from '../tauri'

export type DeleteConfirmation =
  | { kind: 'note'; session: Session }
  | { kind: 'draft'; draft: Draft }
  | { kind: 'finding'; finding: Finding }

export function deleteConfirmationCopy(confirmation: DeleteConfirmation) {
  if (confirmation.kind === 'note') {
    return {
      title: `Delete "${confirmation.session.title}"?`,
      body: 'This removes the note, its testware, findings, and attachments. This cannot be undone.',
      confirmLabel: 'Delete note permanently',
    }
  }

  if (confirmation.kind === 'draft') {
    return {
      title: `Delete "${confirmation.draft.title}"?`,
      body: 'This removes this testware draft only. AI run history is kept. This cannot be undone.',
      confirmLabel: 'Delete testware permanently',
    }
  }

  return {
    title: `Delete "${confirmation.finding.title}"?`,
    body: 'This removes this finding and its evidence links. Source notes and attachments are kept. This cannot be undone.',
    confirmLabel: 'Delete finding permanently',
  }
}
