import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  FormatToolbar: () => <div data-testid="format-toolbar" />,
  RichTextEditor: ({ ariaLabel }: { ariaLabel?: string }) => <div role="textbox" aria-label={ariaLabel} />,
}))

import { draftFixture, recordCreationCommandsFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromHtml } from '../editor/editorDocument'
import { SessionEditorView } from './SessionEditorView'
import { TestwareView } from './TestwareView'

afterEach(cleanup)

const variantOf = (button: HTMLElement) => [...button.classList].find((name) => name.startsWith('action-button--') && !['action-button--regular', 'action-button--compact', 'action-button--icon-only'].includes(name))?.slice('action-button--'.length)

function renderNote(overrides: Partial<ComponentProps<typeof SessionEditorView>> = {}) {
  const session = sessionFixture()
  return render(<SessionEditorView creationCommands={{ finding: recordCreationCommandsFixture('finding'), testware: recordCreationCommandsFixture('testware') }}
    noteBodyHtml="<p>Body</p>" activeProviderAvailable activeSession={session} busyAction={null} canUndoLatestGeneration={false}
    copyState={{ status: 'idle' }} filteredSessions={[session]} isBusy={false} noteBody={richEditorDocumentFromHtml('<p>Body</p>')} noteIsReady
    noteScreenshotCount={0} sessionTitle={session.title} noteWordCount={1} notice={null} error={null} pendingAiActions={{}}
    onAiAction={async () => {}} onUndoLatestGeneration={async () => {}} onCopy={async () => {}} onCreateSession={() => {}} canCreateSession
    onDeleteSession={() => {}} onOpenSession={async () => {}} onSetNoteBody={() => {}} onSetSessionTitle={() => {}} onUploadImage={() => {}}
    onSetSessionMode={() => {}} {...overrides} />)
}

function renderRecord(overrides: Partial<ComponentProps<typeof TestwareView>> = {}) {
  const draft = draftFixture({ id: 'draft-1', title: 'Checkout cases' })
  return render(<TestwareView creationCommands={recordCreationCommandsFixture('testware')} busyAction={null} copyState={{ status: 'idle' }}
    draftScreenshotCounts={{}} drafts={[draft]} notice={null} error={null} isBusy={false} activeGenerationJob={null}
    updateLocalDraft={vi.fn()} onCancelGenerationJob={async () => undefined} onCopy={async () => undefined} onDeleteDraft={vi.fn()}
    onSaveDraft={async () => true} onDiscardDraft={vi.fn()} onUploadImage={vi.fn()}
    recordChat={{ onAskAi: vi.fn(), onSelectRecord: vi.fn() }} {...overrides} />)
}

describe('Note action bar (R2, R3)', () => {
  it('uses one bordered variant for every Note action', () => {
    renderNote()
    const bar = screen.getByRole('contentinfo', { name: 'Note actions' })
    const variants = within(bar).getAllByRole('button').map(variantOf)
    expect(variants).toEqual(['secondary', 'secondary', 'secondary', 'secondary'])
  })

  it('renders the Summarize busy state through the shared loading slot', () => {
    renderNote({ pendingAiActions: { summary: true } })
    const summarize = screen.getByRole('button', { name: 'Summarizing' })
    expect(summarize).toHaveAttribute('aria-busy', 'true')
    expect(summarize.querySelectorAll('.action-button-icon')).toHaveLength(1)
  })

  it('marks Ask AI expanded while the notes panel is open', () => {
    renderNote({ sessionMode: 'write_note' })
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveAttribute('aria-expanded', 'false')
    cleanup()
    renderNote({ sessionMode: 'chat' })
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('Record toolbar (R1, R2, R3)', () => {
  it('keeps every toolbar button at the regular size with no filled Edit', () => {
    renderRecord()
    const actions = document.querySelector<HTMLElement>('.record-actions')!
    const buttons = within(actions).getAllByRole('button')
    expect(buttons.filter((button) => button.classList.contains('action-button--compact'))).toEqual([])
    expect(variantOf(screen.getByRole('button', { name: 'Edit' }))).toBe('secondary')
    expect(variantOf(screen.getByRole('button', { name: 'Ask AI' }))).toBe('secondary')
  })

  it('marks Ask AI expanded only for the record whose panel is open', () => {
    renderRecord({ recordChat: { onAskAi: vi.fn(), onSelectRecord: vi.fn(), openRecordId: 'draft-1' } })
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveAttribute('aria-expanded', 'true')
    cleanup()
    renderRecord({ recordChat: { onAskAi: vi.fn(), onSelectRecord: vi.fn(), openRecordId: 'other' } })
    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('Record search scope (R5)', () => {
  it('names the Session scope in the search placeholder', () => {
    renderRecord()
    expect(screen.getByRole('textbox', { name: 'Search Test cases' })).toHaveAttribute('placeholder', 'Search test cases in this Session…')
  })
})

describe('Ask AI transcript (R6)', () => {
  it('shows no model meta line when the answer has no recorded run', async () => {
    const { ChatMessageList } = await import('./ChatMessageList')
    const { completedChatFixture } = await import('../app/useSessionChat.testSupport')
    const chat = completedChatFixture()
    render(<ChatMessageList messages={chat.messages.map((message) => ({ ...message, aiRunId: 'missing-run' }))} aiRuns={[]} />)
    expect(screen.queryByText('Model evidence unavailable')).toBeNull()
    expect(document.querySelector('.chat-model-evidence')).toBeNull()
  })
})
