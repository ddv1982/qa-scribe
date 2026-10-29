import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider, ReportedModel, ChatMessage, ChatState, ChatTurnStatus, GenerationJobStatus } from '../bindings'
import { SessionChatView } from './SessionChatView.testSupport'

type Props = ComponentProps<typeof SessionChatView>
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function message(role: ChatMessage['role'], text: string, status: ChatTurnStatus = 'completed', id: string = role): ChatMessage {
  return { id, turnId: 'turn-1', role, text, images: [], status, errorMessage: null, aiRunId: null, createdAt: '2026-10-14T10:00:00Z' }
}
function chat(messages: ChatMessage[] = []): ChatState {
  return { owner: { kind: 'notes', sessionId: 'session-1' }, archived: false, composerIntent: { kind: 'message' }, lastActiveOrder: 1, lastActiveAt: '2026-10-14T10:00:00Z', sessionId: 'session-1', draftId: 'chat-1', revision: 1, composer: '', composerImages: [], mode: 'chat', aiRuns: [], messages, submission: null }
}
function job(patch: Partial<GenerationJobStatus> = {}): GenerationJobStatus {
  return { chat: { reference: { sessionId: 'session-1', draftId: 'chat-1' } }, jobId: 'job-1', sessionId: 'session-1', action: 'chat', state: 'running', progressMessage: 'Gathering information', aiRunId: null, errorMessage: null, partialText: null, ...patch }
}
function mount(patch: Partial<Props> = {}) {
  const props: Props = {
    chat: chat(), composer: '', job: null, loading: false, saving: false, working: false,
    error: null, providerLabel: 'Codex', modelLabel: 'Provider default', providerAvailable: true, providerReason: '',
    onSetComposer: vi.fn(), onSend: vi.fn(async () => {}), onRetry: vi.fn(async () => {}),
    onCancel: vi.fn(async () => {}), onSubmit: vi.fn(async () => {}), onRestart: vi.fn(async () => {}),
    onConfigureAi: vi.fn(), ...patch,
  }
  return { props, ...render(<SessionChatView {...props} />) }
}
const button = (name: string) => screen.getByRole('button', { name })

describe('SessionChatView', () => {
  it('formats assistant Markdown while keeping user syntax literal', () => {
    const text = '## Requirements\n\n**Important** and `record_id`\n\n- Parent\n  - Nested\n- [x] Verified\n\n> Context\n\n```sql\nselect 1;\n```\n\n| Check | Result |\n| --- | --- |\n| Linking | Pass |'
    const { container } = mount({ chat: chat([message('user', '**Keep literal**'), message('assistant', text)]) })
    expect(screen.getByRole('heading', { name: 'Requirements', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Important').tagName).toBe('STRONG')
    expect(screen.getByText('record_id').tagName).toBe('CODE')
    expect(container.querySelector('.chat-message-assistant ul ul')).not.toBeNull()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(container.querySelector('blockquote')).toHaveTextContent('Context')
    expect(container.querySelector('pre code')).toHaveTextContent('select 1;')
    expect(screen.getByRole('table')).toHaveTextContent('Linking')
    expect(screen.getByText('**Keep literal**')).toHaveClass('chat-message-text')
  })

  it('formats partial Markdown and settles to one hydrated final response', () => {
    const { props, rerender } = mount({ job: job({ partialText: '## Partial\n\n```js\nlet x = 1' }) })
    expect(screen.getByRole('heading', { name: 'Partial', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('let x = 1').tagName).toBe('CODE')
    const text = '## Partial\n\n```js\nlet x = 1\n```'
    rerender(<SessionChatView {...props} chat={chat([{ ...message('assistant', text), aiRunId: 'run-1' }])} job={job({ state: 'completed', aiRunId: 'run-1', partialText: text })} />)
    expect(screen.getAllByRole('heading', { name: 'Partial', level: 2 })).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Final response pending save' })).not.toBeInTheDocument()
  })

  it('presents recovery without a receipt as an uncertain outcome and disables editing (R46-01)', () => {
    const { props } = mount({ recoveryPending: true, chat: chat(), composer: 'Retained draft' })
    expect(screen.getByRole('status')).toHaveTextContent('Session Note recovery required')
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
    expect(button('Send')).toBeDisabled()
    expect(button('Start new conversation')).toBeDisabled()
    expect(screen.getByText(/submission outcome is uncertain/i)).toBeInTheDocument()
    fireEvent.click(button('Recover Session Note'))
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })
  it('offers canonical Note recovery instead of claiming a finished handoff (R37-01)', () => {
    const submitted = { ...chat([message('user', 'Question'), message('assistant', 'Answer')]), submission: { draftId: 'chat-1', noteId: 'note-1', submittedAt: '2026-10-14T10:05:00Z' } }
    const { props, rerender } = mount({ chat: submitted, recoveryPending: true, error: 'Could not refresh Session Note' })
    expect(button('Start new conversation')).toBeDisabled()
    expect(button('Recover Session Note')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Add conversation to note' })).not.toBeInTheDocument()
    expect(screen.getByText(/stale Note.*write.*protected/i)).toBeInTheDocument()
    expect(screen.queryByText(/Submitted to Session Note\. History is preserved/)).not.toBeInTheDocument()
    fireEvent.click(button('Recover Session Note'))
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
    expect(props.onRestart).not.toHaveBeenCalled()
    rerender(<SessionChatView {...props} working />)
    expect(button('Recover Session Note')).toBeDisabled()
    rerender(<SessionChatView {...props} recoveryPending={false} error={null} />)
    expect(button('Start new conversation')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Recover Session Note' })).not.toBeInTheDocument()
  })

  it('reports unsaved debounce changes instead of saved (R37-03)', () => {
    mount({ dirty: true, composer: 'Not persisted yet' })
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
    expect(screen.getByRole('status')).not.toHaveTextContent('Conversation saved')
  })

  it('reports a save failure while retaining dirty text (R37-03)', () => {
    mount({ dirty: true, composer: 'Keep this text', error: 'Disk write failed' })
    expect(screen.getByRole('status')).toHaveTextContent('Save failed')
    expect(screen.getByRole('alert')).toHaveTextContent('Disk write failed')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Keep this text')
  })

  it('prioritizes an active save over dirty and previous error status (R37-03)', () => {
    mount({ dirty: true, saving: true, error: 'Previous write failed' })
    expect(screen.getByRole('status')).toHaveTextContent('Saving')
    expect(screen.getByRole('status')).not.toHaveTextContent('Save failed')
  })

  it('keeps the saved status when the optional dirty prop is omitted (R37-03)', () => {
    mount()
    expect(screen.getByRole('status')).toHaveTextContent('Conversation saved')
  })

  it('renders a completed hydrated response once, without duplicate partial output (R37-04)', () => {
    const answer = { ...message('assistant', 'Final saved answer'), aiRunId: 'run-1' }
    mount({ chat: chat([message('user', 'Question'), answer]), job: job({ state: 'completed', aiRunId: 'run-1', partialText: 'Final saved answer' }) })
    expect(screen.getAllByText('Final saved answer')).toHaveLength(1)
    expect(screen.queryByRole('region', { name: 'Partial response' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Final response pending save' })).not.toBeInTheDocument()
  })

  it('retains completed output with a pending-save label until its response is hydrated (R37-04)', () => {
    const otherAnswer = { ...message('assistant', 'Earlier answer'), aiRunId: 'run-earlier' }
    mount({ chat: chat([message('user', 'Question'), otherAnswer]), job: job({ state: 'completed', aiRunId: 'run-1', partialText: 'New final answer' }) })
    expect(within(screen.getByRole('region', { name: 'Final response pending save' })).getByText('New final answer')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Partial response' })).not.toBeInTheDocument()
  })

  it('does not treat absent AI Run IDs as an associated saved response (R37-04)', () => {
    mount({ chat: chat([message('assistant', 'Unassociated answer')]), job: job({ state: 'completed', aiRunId: null, partialText: 'Final pending answer' }) })
    expect(within(screen.getByRole('region', { name: 'Final response pending save' })).getByText('Final pending answer')).toBeInTheDocument()
  })

  it('shares empty-output hydration pending with Add and optional review', () => {
    mount({ chat: chat([message('assistant', 'Unassociated saved answer')]), job: job({ state: 'completed', aiRunId: null, partialText: '' }) })
    expect(screen.getByRole('region', { name: 'Final response pending save' })).toHaveTextContent('Waiting for the saved transcript to refresh.')
    expect(button('Add conversation to note')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Review saved conversation' })).toBeNull()
  })

  it.each(['failed', 'cancelled'] as const)('preserves explicitly nonfinal %s partial output (R37-04)', (state) => {
    mount({ chat: chat([message('user', 'Question', state)]), job: job({ state, aiRunId: 'run-1', partialText: 'Incomplete output' }) })
    const partial = screen.getByRole('region', { name: 'Partial response' })
    expect(within(partial).getByText('Incomplete output')).toBeInTheDocument()
    expect(within(partial).getByText('Not a completed transcript message.')).toBeInTheDocument()
  })

  it('labels the transcript and renders role-labelled text without interpreting HTML', () => {
    const { container } = mount({ chat: chat([message('user', '<img src=x onerror=alert(1)>'), message('assistant', 'Check <script>unsafe</script>')]) })
    const transcript = screen.getByRole('region', { name: 'Conversation transcript' })
    expect(within(transcript).getByText('You')).toBeInTheDocument()
    expect(within(transcript).getByText('Assistant')).toBeInTheDocument()
    expect(within(transcript).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(container.querySelector('img, script')).toBeNull()
    expect(screen.getByText(/2 \/ 128 messages/)).toBeInTheDocument()
    expect(screen.getByText(/128 KiB/)).toBeInTheDocument()
  })

  it('provides a controlled multiline composer and sends only with an explicit action', () => {
    const { props } = mount({ composer: 'First line\nSecond line' })
    const composer = screen.getByRole('textbox', { name: 'Message' })
    expect(composer.tagName).toBe('TEXTAREA')
    expect(composer).toHaveValue('First line\nSecond line')
    fireEvent.change(composer, { target: { value: 'Updated\nmessage' } })
    expect(props.onSetComposer).toHaveBeenCalledWith('Updated\nmessage')
    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(props.onSend).not.toHaveBeenCalled()
    fireEvent.click(button('Send'))
    expect(props.onSend).toHaveBeenCalledTimes(1)
  })

  it.each(['ctrlKey', 'metaKey'] as const)('supports %s Enter without sending during IME composition', (modifier) => {
    const { props } = mount({ composer: 'Ready' })
    const composer = screen.getByRole('textbox', { name: 'Message' })
    fireEvent.keyDown(composer, { key: 'Enter', [modifier]: true, isComposing: true })
    expect(props.onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(composer, { key: 'Enter', [modifier]: true })
    expect(props.onSend).toHaveBeenCalledTimes(1)
  })

  it('explains provider unavailability and offers AI configuration', () => {
    const { props } = mount({ composer: 'Question', providerAvailable: false, providerReason: 'Sign in to Codex first' })
    expect(button('Send')).toBeDisabled()
    expect(screen.getByText(/Sign in to Codex first/)).toBeInTheDocument()
    fireEvent.click(button('Configure AI'))
    expect(props.onConfigureAi).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter', ctrlKey: true })
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it.each(['loading', 'saving', 'working'] as const)('blocks mutation while %s and supplies status', (flag) => {
    mount({ chat: chat([message('user', 'Question'), message('assistant', 'Answer')]), composer: 'Question', [flag]: true })
    expect(button('Send')).toBeDisabled()
    expect(button('Add conversation to note')).toBeDisabled()
    expect(button('Start new conversation')).toBeDisabled()
    expect(screen.getByRole('status')).not.toBeEmptyDOMElement()
  })

  it('shows loading and durable errors without presenting an absent chat as ready', () => {
    mount({ chat: null, loading: true, error: 'Could not load conversation' })
    expect(button('Send')).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load conversation')
  })

  it('separately labels partial output and exposes cancellation for an active turn', () => {
    const { props, container } = mount({ chat: chat([message('user', 'Question'), message('assistant', '', 'running')]), job: job({ partialText: '<b>Partial</b>' }), working: true })
    const partial = screen.getByRole('region', { name: 'Partial response' })
    expect(within(partial).getByText('<b>Partial</b>')).toBeInTheDocument()
    expect(container.querySelector('b')).toBeNull()
    expect(button('Send')).toBeDisabled()
    fireEvent.click(button('Cancel response'))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not allow repeated cancellation while cancellation is pending', () => {
    mount({ job: job({ state: 'cancelling' }), working: true })
    expect(button('Cancel response')).toBeDisabled()
    expect(screen.getByText(/Cancelling/)).toBeInTheDocument()
  })

  it.each(['failed', 'cancelled', 'interrupted'] as const)('labels a %s latest turn and requires retry before another user message', (status) => {
    const { props, rerender } = mount({ chat: chat([message('user', 'Question', status)]), composer: 'Do not bypass this turn' })
    expect(screen.getByText(new RegExp(status, 'i'))).toBeInTheDocument()
    expect(button('Send')).toBeDisabled()
    expect(button('Add conversation to note')).toBeDisabled()
    expect(screen.getByText(/Retry.*before sending/i)).toBeInTheDocument()
    expect(button('Retry response')).toBeDisabled()
    expect(screen.getByText(/Clear.*unsent message.*retry/i)).toBeInTheDocument()
    rerender(<SessionChatView {...props} composer="" />)
    fireEvent.click(button('Retry response'))
    expect(props.onRetry).toHaveBeenCalledTimes(1)
    expect(props.onSetComposer).not.toHaveBeenCalled()
  })

  it('explains explicit new-conversation recovery for unresolved earlier history (advisoryR26-01)', () => {
    mount({ chat: chat([message('user', 'Old question', 'failed'), message('user', 'Later question', 'completed', 'user-2'), message('assistant', 'Later answer', 'completed', 'assistant-2')]), composer: 'Next' })
    expect(button('Send')).toBeDisabled()
    expect(button('Add conversation to note')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Retry response' })).not.toBeInTheDocument()
    expect(screen.getByText(/earlier.*new conversation/i)).toBeInTheDocument()
  })

  it('submits only completed nonempty history with a literally empty composer', () => {
    const completed = chat([message('user', 'Question'), message('assistant', 'Answer')])
    const { props, rerender } = mount({ chat: completed })
    fireEvent.click(button('Add conversation to note'))
    expect(props.onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/does not generate test cases/i)).toBeInTheDocument()
    rerender(<SessionChatView {...props} composer=" " />)
    expect(button('Add conversation to note')).toBeDisabled()
    expect(screen.getByText(/Send or clear.*message/i)).toBeInTheDocument()
    rerender(<SessionChatView {...props} chat={chat()} />)
    expect(screen.queryByRole('button', { name: 'Add conversation to note' })).not.toBeInTheDocument()
  })

  it('preserves submitted history and offers an explicit new conversation', () => {
    const submitted = { ...chat([message('user', 'Question'), message('assistant', 'Answer')]), submission: { draftId: 'chat-1', noteId: 'note-1', submittedAt: '2026-10-14T10:05:00Z' } }
    mount({ chat: submitted })
    expect(screen.getByText(/Conversation added to note/)).toBeInTheDocument()
    expect(screen.getByText('Answer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review saved conversation' })).not.toBeInTheDocument()
    expect(button('Open updated Note').closest('.chat-completion')).not.toBeNull()
    expect(button('Open updated Note')).toBeEnabled()
    expect(button('Start new conversation')).toBeEnabled()
  })

  it.each([
    { composer: 'Unsent message' },
    { chat: chat([message('user', 'Existing message')]) },
  ])('requires explicit confirmation before replacing nonempty conversation state', (patch) => {
    const { props } = mount(patch)
    fireEvent.click(button('Start new conversation'))
    const dialog = screen.getByRole('dialog', { name: 'Start a new conversation?' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(props.onRestart).not.toHaveBeenCalled()
    expect(props.onSetComposer).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start new conversation' }))
    expect(props.onRestart).toHaveBeenCalledTimes(1)
  })

  it('does not require confirmation for an empty conversation', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { props } = mount()
    fireEvent.click(button('Start new conversation'))
    expect(confirm).not.toHaveBeenCalled()
    expect(props.onRestart).toHaveBeenCalledTimes(1)
  })

  it('enforces UTF-8 message limits instead of character counts', () => {
    mount({ composer: 'é'.repeat(8193) })
    expect(button('Send')).toBeDisabled()
    expect(screen.getByText(/16 KiB/)).toBeInTheDocument()
  })

  it('reserves both user and assistant slots at the transcript message limit', () => {
    mount({ chat: chat(Array.from({ length: 127 }, (_, index) => message(index % 2 ? 'assistant' : 'user', 'x', 'completed', `message-${index}`))), composer: 'Next' })
    expect(button('Send')).toBeDisabled()
    expect(screen.getByText(/127 \/ 128 messages/)).toBeInTheDocument()
    expect(screen.getByText(/limit.*new conversation/i)).toBeInTheDocument()
  })

  it('blocks messages that would exceed the total transcript byte limit', () => {
    mount({ chat: chat(Array.from({ length: 8 }, (_, index) => message(index % 2 ? 'assistant' : 'user', 'a'.repeat(16384), 'completed', `message-${index}`))), composer: 'Next' })
    expect(button('Send')).toBeDisabled()
    expect(screen.getByText(/limit.*new conversation/i)).toBeInTheDocument()
  })

  it('does not send an empty or whitespace-only message', () => {
    const { props } = mount({ composer: ' \n ' })
    expect(button('Send')).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter', metaKey: true })
    expect(props.onSend).not.toHaveBeenCalled()
  })
})

const reportCases: { provider: AiProvider; providerLabel: string; report: ReportedModel; label: string }[] = [
  { provider: 'claude_code', providerLabel: 'Claude Code', report: { source: 'claudeInitialization', id: 'reported-model' }, label: 'Initialization metadata' },
  { provider: 'claude_code', providerLabel: 'Claude Code', report: { source: 'claudeAssistantMessage', id: 'reported-model' }, label: 'Response metadata' },
  { provider: 'codex_cli', providerLabel: 'Codex', report: { source: 'codexThreadConfiguration', id: 'reported-model' }, label: 'Thread configuration' },
]

it.each(reportCases)('preserves saved $label provenance after the next preference changes', ({ provider, providerLabel, report, label }) => {
  const history = chat([{ ...message('assistant', 'Saved answer'), aiRunId: 'prior-run' }])
  history.aiRuns = [{ id: 'prior-run', sessionId: 'session-1', generationContextId: null,
    provider, modelSelection: { kind: 'recorded', requested: { kind: 'explicit', id: 'saved-alias' }, reported: report }, reasoningEffort: null,
    promptVersion: 'chat-v1', status: 'completed', errorMessage: null, createdAt: 'old', completedAt: 'old' }]
  const { props, rerender } = mount({ chat: history, providerLabel: 'Codex', modelLabel: 'next-codex' })
  const evidence = screen.getByText(new RegExp(`${providerLabel} · Requested · saved-alias`))
  expect(evidence).toHaveTextContent(`${providerLabel} · Requested · saved-alias`)
  expect(evidence).toHaveTextContent(`CLI report · reported-model · ${label}`)
  rerender(<SessionChatView {...props} providerLabel="GitHub Copilot" modelLabel="auto" />)
  const retainedEvidence = screen.getByText(new RegExp(`${providerLabel} · Requested · saved-alias`))
  expect(retainedEvidence).toHaveTextContent(`CLI report · reported-model · ${label}`)
  expect(screen.getByText('Next invocation · GitHub Copilot · auto')).toBeInTheDocument()
})

it('keeps missing and legacy historical model evidence explicit', () => {
  const history = chat([{ ...message('assistant', 'Saved answer'), aiRunId: 'prior-run' }])
  history.aiRuns = [{ id: 'prior-run', sessionId: 'session-1', generationContextId: null,
    provider: 'codex_cli', modelSelection: { kind: 'recorded', requested: { kind: 'default' }, reported: null },
    reasoningEffort: null, promptVersion: 'chat-v1', status: 'completed', errorMessage: null, createdAt: 'old', completedAt: 'old' }]
  const { props, rerender } = mount({ chat: history })
  expect(screen.getByText(/Codex · Requested · CLI Default/)).toHaveTextContent('CLI report · Unknown')
  history.aiRuns[0] = { ...history.aiRuns[0], modelSelection: { kind: 'legacy', value: 'old-ambiguous' } }
  rerender(<SessionChatView {...props} chat={history} />)
  expect(screen.getByText('Codex · Legacy model · old-ambiguous · Source unknown')).toBeInTheDocument()
})
