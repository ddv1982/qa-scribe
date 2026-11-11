import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { deriveChatHandoff, handoffDuringRecordWrites } from '../app/sessionChat.presentation'
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



it('keeps the unsent explanation and disabled Add across composer and mode saves', () => {
  const props = { onSubmit: vi.fn(async () => {}), onOpenNote: vi.fn() }
  const composer = 'Keep this unsent question'
  const view = render(<ChatHandoff state={state({ composer })} {...props} />)
  for (const saving of [true, false, true, false]) {
    view.rerender(<ChatHandoff state={state({ composer, saving })} {...props} />)
    expect(screen.getByText('Send or clear the unsent message before adding the conversation.')).toBeVisible()
    expect(screen.getByText(/Your unsent message is excluded/)).toHaveClass('sr-only')
    expect(button('Add conversation to note')).toBeDisabled()
    fireEvent.click(button('Add conversation to note'))
  }
  expect(props.onSubmit).not.toHaveBeenCalled()
})

it('disables Add with no unsent message during autosave', () => {
  const onSubmit = vi.fn(async () => {})
  render(<ChatHandoff state={state({ saving: true })} onSubmit={onSubmit} onOpenNote={vi.fn()} />)
  expect(button('Add conversation to note')).toBeDisabled()
  fireEvent.click(button('Add conversation to note'))
  expect(onSubmit).not.toHaveBeenCalled()
})

it('adds normally once without review or confirmation', () => {
  const onSubmit = vi.fn(async () => {})
  const confirm = vi.spyOn(window, 'confirm')
  render(<ChatHandoff state={state()} onSubmit={onSubmit} onOpenNote={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'Review saved conversation' })).not.toBeInTheDocument()
  expect(button('Add conversation to note')).toHaveAccessibleDescription(/existing note stays intact/i)
  fireEvent.click(button('Add conversation to note'))
  expect(onSubmit).toHaveBeenCalledTimes(1)
  expect(confirm).not.toHaveBeenCalled()
})

it('uses navigation for the updated Note without repeating the transcript or handoff explanation', () => {
  const value = state({ chat: completedChatFixture({ submission: { draftId: 'chat-1', noteId: 'note-1', submittedAt: 'saved' } }) })
  const onSubmit = vi.fn(async () => {})
  const onOpenNote = vi.fn()
  const view = render(<ChatHandoff state={value} onSubmit={onSubmit} onOpenNote={onOpenNote} />)
  fireEvent.click(button('Open updated Note'))
  expect(screen.queryByRole('button', { name: 'Review saved conversation' })).not.toBeInTheDocument()
  expect(screen.queryByText(/Your existing Note stays intact/)).not.toBeInTheDocument()
  expect(screen.getByText('Conversation added to note')).toBeVisible()
  expect(onOpenNote).toHaveBeenCalledTimes(1)
  expect(onSubmit).not.toHaveBeenCalled()
  view.rerender(<ChatAddedToNote state={value} />)
  expect(screen.getByLabelText('Conversation added')).not.toHaveTextContent('Which build?')
  expect(button('Start new conversation')).toBeEnabled()
})

it.each([false, true])('shares cancel/accept and exact submitted=%s confirmation semantics on both displays', submitted => {
  const value = state({ chat: completedChatFixture({ submission: submitted ? { draftId: 'chat-1', noteId: 'note-1', submittedAt: 'saved' } : null }) })
  const view = render(submitted ? <ChatAddedToNote state={value} /> : <StartNewConversation state={value} />)
  const trigger = button('Start new conversation')
  trigger.focus()
  fireEvent.click(trigger)
  let dialog = screen.getByRole('dialog', { name: 'Start a new conversation?' })
  expect(dialog).toHaveTextContent(submitted
    ? 'Submitted history remains saved. Any unsent message will be discarded.'
    : 'This replaces the current conversation and discards any unsent message. Submit completed messages to the Session Note first if you want to keep them.')
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  expect(value.onRestart).not.toHaveBeenCalled()
  fireEvent(dialog, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  view.rerender(submitted ? <ChatAddedToNote state={value} /> : <StartNewConversation state={value} />)
  fireEvent.click(button('Start new conversation'))
  dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Start new conversation' }))
  expect(value.onRestart).toHaveBeenCalledTimes(1)
})

it.each([
  { composer: 'New unsent message' },
  { chat: completedChatFixture({ draftId: 'chat-2' }) },
  { job: chatJobFixture() },
  { permissionRecoveryPending: true },
])('rejects a stale restart dialog after work changes', patch => {
  const value = state()
  const view = render(<StartNewConversation state={value} />)
  fireEvent.click(button('Start new conversation'))
  view.rerender(<StartNewConversation state={{ ...value, ...patch }} />)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start new conversation' }))
  expect(value.onRestart).not.toHaveBeenCalled()
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



it('retains the added banner through record writes and disables only prospective Add', () => {
  const added = state({ chat: completedChatFixture({ submission: { draftId: 'chat-1', noteId: 'note-1', submittedAt: 'saved' } }) })
  const onSubmit = vi.fn(async () => {})
  const props = { onSubmit, onOpenNote: vi.fn() }
  const view = render(<><ChatAddedToNote state={added} /><ChatHandoff state={added} {...props} /></>)
  const banner = screen.getByLabelText('Conversation added')
  for (const pending of [true, false]) {
    const value = { ...added, handoff: handoffDuringRecordWrites(added.handoff, pending) }
    view.rerender(<><ChatAddedToNote state={value} /><ChatHandoff state={value} {...props} /></>)
    expect(screen.getByLabelText('Conversation added')).toBe(banner)
    expect(button('Open updated Note')).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Add conversation to note' })).not.toBeInTheDocument()
  }
  const prospective = state()
  view.rerender(<ChatHandoff state={{ ...prospective, handoff: handoffDuringRecordWrites(prospective.handoff, true) }} {...props} />)
  expect(button('Add conversation to note')).toBeDisabled()
  fireEvent.click(button('Add conversation to note'))
  expect(onSubmit).not.toHaveBeenCalled()
  view.rerender(<ChatHandoff state={prospective} {...props} />)
  expect(button('Add conversation to note')).toBeEnabled()
})
