import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  FormatToolbar: () => <div data-testid="format-toolbar" />,
  RichTextEditor: () => <div role="textbox" />,
}))

import type { Draft, Finding, Session } from '../tauri'
import { FindingsView } from './FindingsView'
import { NotesView } from './NotesView'
import { TestwareView } from './TestwareView'

describe('copy success buttons', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows a success state for copied notes', () => {
    render(
      <NotesView
        activeProviderAvailable
        activeSession={session}
        busyAction={null}
        copySucceeded
        filteredSessions={[session]}
        isBusy={false}
        noteBody="<p>Body</p>"
        noteIsReady
        noteTitle="Login note"
        noteWordCount={1}
        notice={null}
        error={null}
        pendingAiActions={{}}
        onAiAction={async () => undefined}
        onCopyNote={async () => undefined}
        onDeleteNote={() => undefined}
        onNewNote={async () => undefined}
        onOpenNote={async () => undefined}
        onSetNoteBody={() => undefined}
        onSetNoteTitle={() => undefined}
        onUploadImage={() => undefined}
      />,
    )

    const button = screen.getByRole('button', { name: 'Note copied for Jira' })
    expect(button.className).toContain('success')
  })

  it('shows a success state for the copied testware record only', () => {
    render(
      <TestwareView
        busyAction={null}
        copiedDraftId="draft-1"
        drafts={[draft]}
        notice={null}
        error={null}
        isBusy={false}
        activeGenerationJob={null}
        updateLocalDraft={() => undefined}
        onCancelGenerationJob={async () => undefined}
        onCopyDraft={async () => undefined}
        onDeleteDraft={() => undefined}
        onManualCreate={async () => undefined}
        onPrefillFromNote={async () => undefined}
        onSaveDraft={async () => undefined}
        onUploadImage={() => undefined}
      />,
    )

    const button = screen.getByRole('button', { name: 'Login case copied for Jira' })
    expect(button.className).toContain('success')
  })

  it('shows a success state for the copied finding only', () => {
    render(
      <FindingsView
        busyAction={null}
        copiedFindingId="finding-1"
        findings={[finding]}
        notice={null}
        error={null}
        isBusy={false}
        activeGenerationJob={null}
        updateLocalFinding={() => undefined}
        onCancelGenerationJob={async () => undefined}
        onCopyFinding={async () => undefined}
        onDeleteFinding={() => undefined}
        onManualCreate={async () => undefined}
        onPrefillFromNote={async () => undefined}
        onSaveFinding={async () => undefined}
        onUploadImage={() => undefined}
      />,
    )

    const button = screen.getByRole('button', { name: 'Login finding copied for Jira' })
    expect(button.className).toContain('success')
  })
})

const session: Session = {
  id: 'session-1',
  title: 'Login note',
  sessionContext: null,
  objectiveNotes: null,
  environment: null,
  buildVersion: null,
  relatedReference: null,
  createdAt: '2026-06-24T08:00:00Z',
  updatedAt: '2026-06-24T08:00:00Z',
  lastOpenedAt: '2026-06-24T08:00:00Z',
}

const draft: Draft = {
  id: 'draft-1',
  sessionId: 'session-1',
  aiRunId: null,
  kind: 'testware',
  title: 'Login case',
  body: '<p>Verify login</p>',
  createdAt: '2026-06-24T08:00:00Z',
  updatedAt: '2026-06-24T08:00:00Z',
}

const finding: Finding = {
  id: 'finding-1',
  sessionId: 'session-1',
  title: 'Login finding',
  body: '<p>Login fails</p>',
  kind: 'bug',
  metadataJson: null,
  createdAt: '2026-06-24T08:00:00Z',
  updatedAt: '2026-06-24T08:00:00Z',
}
