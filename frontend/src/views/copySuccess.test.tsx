import { recordCreationCommandsFixture } from '../test/fixtures'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  FormatToolbar: () => <div data-testid="format-toolbar" />,
  RichTextEditor: () => <div role="textbox" />,
}))

import type { Draft, Finding, Session } from '../tauri'
import { richEditorDocumentFromHtml } from '../editor/editorDocument'
import { FindingsView } from './FindingsView'
import { SessionEditorView } from './SessionEditorView'
import { TestwareView } from './TestwareView'

describe('copy success buttons', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows a success state for copied notes', () => {
    render(
      <SessionEditorView creationCommands={{ finding: recordCreationCommandsFixture('finding'), testware: recordCreationCommandsFixture('testware') }} noteBodyHtml="<p>Body</p>"
        activeProviderAvailable
        activeSession={session}
        busyAction={null}
        canUndoLatestGeneration={false}
        copyState={{ status: 'succeeded', snapshot: { target: { kind: 'note', sessionId: session.id, action: 'jira-text' }, title: 'Login session', bodyHtml: '<p>Body</p>' } }}

        filteredSessions={[session]}
        isBusy={false}
        noteBody={richEditorDocumentFromHtml('<p>Body</p>')}
        noteIsReady
        noteScreenshotCount={0}
        sessionTitle="Login session"
        noteWordCount={1}
        notice={null}
        error={null}
        pendingAiActions={{}}
        onAiAction={async () => undefined}
        onUndoLatestGeneration={async () => undefined}
        onCopy={async () => undefined}
        onCreateSession={() => undefined} canCreateSession
        onDeleteSession={() => undefined}
        onOpenSession={async () => undefined}
        onSetNoteBody={() => undefined}
        onSetSessionTitle={() => undefined}
        onUploadImage={() => undefined}
      />,
    )

    const button = screen.getByRole('button', { name: 'note Login session copied' })
    expect(button).toHaveTextContent(/Copied|Screenshot copied/)
    expect(button).toBeEnabled()
  })

  it('shows required-title validation instead of claiming the Session is autosaved', () => {
    render(
      <SessionEditorView creationCommands={{ finding: recordCreationCommandsFixture('finding'), testware: recordCreationCommandsFixture('testware') }} noteBodyHtml="<p>Body</p>" copyState={{ status: 'idle' }}
        activeProviderAvailable
        activeSession={session}
        busyAction={null}
        canUndoLatestGeneration={false}

        filteredSessions={[session]}
        isBusy={false}
        noteBody={richEditorDocumentFromHtml('<p>Body</p>')}
        noteIsReady
        noteScreenshotCount={0}
        sessionTitle="   "
        sessionTitleValidationError="Session title is required."
        sessionSaveState="invalid"
        noteWordCount={1}
        notice={null}
        error={null}
        pendingAiActions={{}}
        onAiAction={async () => undefined}
        onUndoLatestGeneration={async () => undefined}
        onCopy={async () => undefined}
        onCreateSession={() => undefined} canCreateSession
        onDeleteSession={() => undefined}
        onOpenSession={async () => undefined}
        onSetNoteBody={() => undefined}
        onSetSessionTitle={() => undefined}
        onUploadImage={() => undefined}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Session title is required.')
    expect(screen.getByText('Title required').closest('[role="status"]')).toHaveTextContent('Title required')
    expect(screen.queryByText('Autosaved')).not.toBeInTheDocument()
  })

  it('keeps ordinary creation independent of provider configuration in the Note footer', async () => {
    const user = userEvent.setup()
    render(
      <SessionEditorView creationCommands={{ finding: recordCreationCommandsFixture('finding'), testware: recordCreationCommandsFixture('testware') }} noteBodyHtml="<p>Body</p>" copyState={{ status: 'idle' }}
        activeProviderAvailable
        activeSession={session}
        busyAction={null}
        canUndoLatestGeneration={false}

        filteredSessions={[session]}
        isBusy={false}
        noteBody={richEditorDocumentFromHtml('<p>Body</p>')}
        noteIsReady
        noteScreenshotCount={0}
        sessionTitle="Login session"
        noteWordCount={1}
        notice={null}
        error={null}
        pendingAiActions={{}}
        onAiAction={async () => undefined}
        onUndoLatestGeneration={async () => undefined}
        onCopy={async () => undefined}
        onCreateSession={() => undefined} canCreateSession
        onDeleteSession={() => undefined}
        onOpenSession={async () => undefined}
        onSetNoteBody={() => undefined}
        onSetSessionTitle={() => undefined}
        onUploadImage={() => undefined}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Configure AI execution' })).not.toBeInTheDocument()
    expect(screen.queryByText('gpt-5.5')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create finding' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Create test cases' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Create finding' }))
  })

  it('shows a success state for the copied testware record only', () => {
    render(
      <TestwareView creationCommands={recordCreationCommandsFixture('testware')}
        busyAction={null}
        copyState={{ status: 'succeeded', snapshot: { target: { kind: 'draft', sessionId: draft.sessionId, id: draft.id, action: 'jira-text' }, title: draft.title, bodyHtml: draft.body } }}
        draftScreenshotCounts={{}}
        drafts={[draft]}
        notice={null}
        error={null}
        isBusy={false}
        activeGenerationJob={null}
        updateLocalDraft={() => undefined}
        onCancelGenerationJob={async () => undefined}
        onCopy={async () => undefined}
        onDeleteDraft={() => undefined}
        onSaveDraft={async () => true}
        onDiscardDraft={vi.fn()}
        onUploadImage={() => undefined}
      />,
    )

    const button = screen.getByRole('button', { name: 'Login case copied' })
    expect(button).toHaveTextContent(/Copied|Screenshot copied/)
    expect(button).toBeEnabled()
  })

  it('shows a success state for the copied finding only', () => {
    render(
      <FindingsView creationCommands={recordCreationCommandsFixture('finding')}
        busyAction={null}
        copyState={{ status: 'succeeded', snapshot: { target: { kind: 'finding', sessionId: finding.sessionId, id: finding.id, action: 'jira-text' }, title: finding.title, bodyHtml: finding.body } }}
        findingScreenshotCounts={{}}
        findings={[finding]}
        notice={null}
        error={null}
        isBusy={false}
        activeGenerationJob={null}
        updateLocalFinding={() => undefined}
        onCancelGenerationJob={async () => undefined}
        onCopy={async () => undefined}
        onDeleteFinding={() => undefined}
        onSaveFinding={async () => true}
        onDiscardFinding={vi.fn()}
        onUploadImage={() => undefined}
      />,
    )

    const button = screen.getByRole('button', { name: 'Login finding copied' })
    expect(button).toHaveTextContent(/Copied|Screenshot copied/)
    expect(button).toBeEnabled()
  })

  it('shows a success state for copied note screenshots', () => {
    render(
      <SessionEditorView creationCommands={{ finding: recordCreationCommandsFixture('finding'), testware: recordCreationCommandsFixture('testware') }} noteBodyHtml="<p>Body</p>"
        activeProviderAvailable
        activeSession={session}
        busyAction={null}
        canUndoLatestGeneration={false}
        copyState={{ status: 'succeeded', snapshot: { target: { kind: 'note', sessionId: session.id, action: 'screenshot' }, title: 'Login session', bodyHtml: '<p>Body</p>' } }}
        filteredSessions={[session]}
        isBusy={false}
        noteBody={richEditorDocumentFromHtml('<p>Body</p>')}
        noteIsReady
        noteScreenshotCount={1}
        sessionTitle="Login session"
        noteWordCount={1}
        notice={null}
        error={null}
        pendingAiActions={{}}
        onAiAction={async () => undefined}
        onUndoLatestGeneration={async () => undefined}
        onCopy={async () => undefined}
        onCreateSession={() => undefined} canCreateSession
        onDeleteSession={() => undefined}
        onOpenSession={async () => undefined}
        onSetNoteBody={() => undefined}
        onSetSessionTitle={() => undefined}
        onUploadImage={() => undefined}
      />,
    )

    const button = screen.getByRole('button', { name: 'note Login session screenshot copied' })
    expect(button).toHaveTextContent(/Copied|Screenshot copied/)
    expect(button).toBeEnabled()
  })

  it('shows a success state for copied testware screenshots', () => {
    render(
      <TestwareView creationCommands={recordCreationCommandsFixture('testware')}
        busyAction={null}
        copyState={{ status: 'succeeded', snapshot: { target: { kind: 'draft', sessionId: draft.sessionId, id: draft.id, action: 'screenshot' }, title: draft.title, bodyHtml: draft.body } }}
        draftScreenshotCounts={{ 'draft-1': 1 }}
        drafts={[draft]}
        notice={null}
        error={null}
        isBusy={false}
        activeGenerationJob={null}
        updateLocalDraft={() => undefined}
        onCancelGenerationJob={async () => undefined}
        onCopy={async () => undefined}
        onDeleteDraft={() => undefined}
        onSaveDraft={async () => true}
        onDiscardDraft={vi.fn()}
        onUploadImage={() => undefined}
      />,
    )

    const button = screen.getByRole('button', { name: 'Login case screenshot copied' })
    expect(button).toHaveTextContent(/Copied|Screenshot copied/)
    expect(button).toBeEnabled()
  })

  it('shows a success state for copied finding screenshots', () => {
    render(
      <FindingsView creationCommands={recordCreationCommandsFixture('finding')}
        busyAction={null}
        copyState={{ status: 'succeeded', snapshot: { target: { kind: 'finding', sessionId: finding.sessionId, id: finding.id, action: 'screenshot' }, title: finding.title, bodyHtml: finding.body } }}
        findingScreenshotCounts={{ 'finding-1': 1 }}
        findings={[finding]}
        notice={null}
        error={null}
        isBusy={false}
        activeGenerationJob={null}
        updateLocalFinding={() => undefined}
        onCancelGenerationJob={async () => undefined}
        onCopy={async () => undefined}
        onDeleteFinding={() => undefined}
        onSaveFinding={async () => true}
        onDiscardFinding={vi.fn()}
        onUploadImage={() => undefined}
      />,
    )

    const button = screen.getByRole('button', { name: 'Login finding screenshot copied' })
    expect(button).toHaveTextContent(/Copied|Screenshot copied/)
    expect(button).toBeEnabled()
  })

  it('keeps a testware record editable when save fails', async () => {
    const user = userEvent.setup()
    render(
      <TestwareView creationCommands={recordCreationCommandsFixture('testware')}
        busyAction={null}
        copyState={{ status: 'idle' }}
        draftScreenshotCounts={{}}
        drafts={[draft]}
        notice={null}
        error={null}
        isBusy={false}
        activeGenerationJob={null}
        updateLocalDraft={() => undefined}
        onCancelGenerationJob={async () => undefined}
        onCopy={async () => undefined}
        onDeleteDraft={() => undefined}
        onSaveDraft={async () => false}
        onDiscardDraft={vi.fn()}
        onUploadImage={() => undefined}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByLabelText('Test case title')).toBeInTheDocument())
  })

  it('keeps a finding record editable when save fails', async () => {
    const user = userEvent.setup()
    render(
      <FindingsView creationCommands={recordCreationCommandsFixture('finding')}
        busyAction={null}
        copyState={{ status: 'idle' }}
        findingScreenshotCounts={{}}
        findings={[finding]}
        notice={null}
        error={null}
        isBusy={false}
        activeGenerationJob={null}
        updateLocalFinding={() => undefined}
        onCancelGenerationJob={async () => undefined}
        onCopy={async () => undefined}
        onDeleteFinding={() => undefined}
        onSaveFinding={async () => false}
        onDiscardFinding={vi.fn()}
        onUploadImage={() => undefined}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Finding type')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.getByLabelText('Finding title')).toBeInTheDocument())
  })
})

const session: Session = {
  id: 'session-1',
  title: 'Login session',
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
  bodyJson: null,
  bodyFormat: 'html',
  metadataJson: null,
  createdAt: '2026-06-24T08:00:00Z',
  updatedAt: '2026-06-24T08:00:00Z',
}

const finding: Finding = {
  id: 'finding-1',
  sessionId: 'session-1',
  title: 'Login finding',
  body: '<p>Login fails</p>',
  bodyJson: null,
  bodyFormat: 'html',
  kind: 'bug',
  metadataJson: null,
  createdAt: '2026-06-24T08:00:00Z',
  updatedAt: '2026-06-24T08:00:00Z',
}
