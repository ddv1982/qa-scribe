import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { deriveChatHandoff } from '../app/sessionChat.presentation'
import { completedChatFixture, chatJobFixture } from '../app/useSessionChat.testSupport'
import { ChatAddedToNote, ChatHandoff } from './ChatHandoff'
import { StartNewConversation, type ChatRestartState } from './StartNewConversation'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function state(patch: Partial<ChatRestartState> = {}) {
  const value: ChatRestartState = {
    chat: completedChatFixture(), composer: '', job: null, loading: false, saving: false, working: false,
    onRestart: vi.fn(async () => {}), ...patch,
  }
  return { ...value, handoff: deriveChatHandoff({ ...value, sessionId: 'session-1', noteEntry: { id: 'note-1', sessionId: 'session-1' } }) }
}
const button = (name: string) => screen.getByRole('button', { name })

it('reviews literal user text and assistant Markdown without any callbacks or automatic confirmation', () => {
  const value = state({ composer: ' ' })
  if (!value.chat) throw new Error('Missing fixture')
  value.chat.messages[0].text = '**Keep literal**\n<script>unsafe()</script>'
  value.chat.messages[1].text = '## Saved answer\n\n**Evidence**'
  value.chat.messages[1].errorMessage = 'Saved error detail'
  const onSubmit = vi.fn(async () => {})
  const onOpenNote = vi.fn()
  const confirm = vi.spyOn(window, 'confirm')
  const { container } = render(<ChatHandoff state={value} onSubmit={onSubmit} onOpenNote={onOpenNote} />)
  fireEvent.click(button('Review saved conversation'))
  const review = screen.getByRole('region', { name: 'Saved conversation' })
  expect(within(review).getByText('You')).toBeVisible()
  expect(within(review).getByText('**Keep literal** <script>unsafe()</script>')).toHaveClass('chat-message-text')
  expect(within(review).getByRole('heading', { name: 'Saved answer' })).toBeVisible()
  expect(within(review).getByText('Evidence').tagName).toBe('STRONG')
  expect(within(review).getByText('Saved error detail')).toBeVisible()
  expect(container.querySelector('script')).toBeNull()
  expect(screen.getByText(/Your unsent message is excluded/)).toBeVisible()
  expect(button('Add conversation to note')).toBeDisabled()
  fireEvent.click(button('Review saved conversation'))
  expect(screen.queryByRole('region', { name: 'Saved conversation' })).toBeNull()
  for (const callback of [onSubmit, onOpenNote, value.onRestart, confirm]) expect(callback).not.toHaveBeenCalled()
})

it('keeps review live across accepted revisions and resets on Session/draft or unavailable history', () => {
  const first = state()
  const props = { onSubmit: vi.fn(async () => {}), onOpenNote: vi.fn() }
  const view = render(<ChatHandoff state={first} {...props} />)
  fireEvent.click(button('Review saved conversation'))
  const updated = state({ chat: completedChatFixture({ revision: 9 }) })
  if (!updated.chat) throw new Error('Missing fixture')
  updated.chat.messages[1].text = 'Updated accepted answer'
  view.rerender(<ChatHandoff state={updated} {...props} />)
  expect(within(screen.getByRole('region', { name: 'Saved conversation' })).getByText('Updated accepted answer')).toBeVisible()
  for (const chat of [completedChatFixture({ draftId: 'next' }), completedChatFixture({ sessionId: 'session-2', draftId: 'next' })]) {
    view.rerender(<ChatHandoff state={{ ...updated, chat }} {...props} />)
    expect(button('Review saved conversation')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('region', { name: 'Saved conversation' })).toBeNull()
    fireEvent.click(button('Review saved conversation'))
  }
  view.rerender(<ChatHandoff state={state({ saving: true })} {...props} />)
  expect(screen.queryByRole('button', { name: 'Review saved conversation' })).toBeNull()
  view.rerender(<ChatHandoff state={first} {...props} />)
  expect(button('Review saved conversation')).toHaveAttribute('aria-expanded', 'false')
})

it('adds normally once without review or confirmation', () => {
  const onSubmit = vi.fn(async () => {})
  const confirm = vi.spyOn(window, 'confirm')
  render(<ChatHandoff state={state()} onSubmit={onSubmit} onOpenNote={vi.fn()} />)
  expect(screen.getByText(/Your existing Note stays intact/)).toHaveTextContent('This does not generate test cases.')
  expect(button('Review saved conversation')).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(button('Add conversation to note'))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(confirm).not.toHaveBeenCalled()
})

it('uses navigation for the actual updated Note and keeps saved review after submission', () => {
  const value = state({ chat: completedChatFixture({ submission: { draftId: 'chat-1', noteId: 'note-1', submittedAt: 'saved' } }) })
  const onSubmit = vi.fn(async () => {})
  const onOpenNote = vi.fn()
  const view = render(<ChatHandoff state={value} onSubmit={onSubmit} onOpenNote={onOpenNote} />)
  fireEvent.click(button('Open updated Note'))
  fireEvent.click(button('Review saved conversation'))
  expect(screen.getByRole('region', { name: 'Saved conversation' })).toHaveTextContent('Which build?')
  expect(onOpenNote).toHaveBeenCalledTimes(1)
  expect(onSubmit).not.toHaveBeenCalled()
  view.rerender(<ChatAddedToNote state={value} />)
  expect(screen.getByLabelText('Conversation added')).not.toHaveTextContent('Which build?')
  expect(button('Start new conversation')).toBeEnabled()
})

it.each([false, true])('shares cancel/accept and exact submitted=%s confirmation semantics on both displays', submitted => {
  const value = state({ chat: completedChatFixture({ submission: submitted ? { draftId: 'chat-1', noteId: 'note-1', submittedAt: 'saved' } : null }) })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const view = render(<StartNewConversation state={value} />)
  fireEvent.click(button('Start new conversation'))
  expect(confirm).toHaveBeenLastCalledWith(submitted
    ? 'Start a new conversation? Submitted history remains saved. Any unsent message will be discarded.'
    : 'Start a new conversation? This replaces the current conversation and discards any unsent message. Submit completed messages to the Session Note first if you want to keep them.')
  expect(value.onRestart).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  if (submitted) view.rerender(<ChatAddedToNote state={value} />)
  fireEvent.click(button('Start new conversation'))
  expect(value.onRestart).toHaveBeenCalledTimes(1)
})

it.each(['loading', 'saving', 'working', 'recoveryPending', 'permissionWorking', 'permissionRecoveryPending'] as const)('blocks every restart call site while %s', flag => {
  const value = state({ [flag]: true })
  render(<StartNewConversation state={value} />)
  fireEvent.click(button('Start new conversation'))
  expect(button('Start new conversation')).toBeDisabled()
  expect(value.onRestart).not.toHaveBeenCalled()
})

it.each([
  { job: chatJobFixture({ state: 'starting' }) }, { job: chatJobFixture({ state: 'running' }) },
  { job: chatJobFixture({ state: 'cancelling' }) },
  { chat: completedChatFixture({ messages: [{ ...completedChatFixture().messages[0], status: 'running' }] }) },
])('blocks restart for active jobs and running saved messages', patch => {
  const value = state(patch)
  render(<StartNewConversation state={value} />)
  fireEvent.click(button('Start new conversation'))
  expect(button('Start new conversation')).toBeDisabled()
  expect(value.onRestart).not.toHaveBeenCalled()
})

it('reviews the bounded 128-message transcript without callbacks', () => {
  const chat = completedChatFixture()
  chat.messages = Array.from({ length: 128 }, (_, index) => ({ ...chat.messages[index % 2],
    id: `message-${index}`, text: 'x'.repeat(1024), aiRunId: null }))
  const value = state({ chat })
  const onSubmit = vi.fn(async () => {})
  render(<ChatHandoff state={value} onSubmit={onSubmit} onOpenNote={vi.fn()} />)
  fireEvent.click(button('Review saved conversation'))
  const review = screen.getByRole('region', { name: 'Saved conversation' })
  expect(within(review).getAllByRole('listitem')).toHaveLength(128)
  expect(Array.from(review.querySelectorAll('.chat-message-text')).reduce((total, node) => total + new TextEncoder().encode(node.textContent ?? '').length, 0)).toBe(131072)
  expect(onSubmit).not.toHaveBeenCalled()
  expect(value.onRestart).not.toHaveBeenCalled()
})
