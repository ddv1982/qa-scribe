import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StartNewConversation } from '../views/StartNewConversation'
import { createSessionChatActions } from './sessionChat.actions'
import { emptyChatSnapshot, type ChatSnapshot, type SessionChatContext } from './sessionChat.types'
import { chatFixture, chatJobFixture, completedChatFixture } from './useSessionChat.testSupport'
import type { ChatComposerRequest, ChatState } from '../bindings'
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}

const api = vi.hoisted(() => ({ getConversation: vi.fn(), getChat: vi.fn(), saveChatComposer: vi.fn(), restartChat: vi.fn(), updateEntry: vi.fn(), submitChat: vi.fn() }))
vi.mock('../tauri', async (original) => ({ ...await original<object>(), ...api }))
const instances: ReturnType<typeof createSessionChatActions>[] = []
let durable: ChatState
let recovery = false
let sessionId: string | null

async function mount() {
  let snapshot: ChatSnapshot = emptyChatSnapshot
  let repaint = () => {}
  const actions = createSessionChatActions({
    session: { activeSessionIdRef: { get current() { return sessionId } } },
    noteRecovery: { isRetired: () => false, has: () => recovery, hasPending: () => recovery },
    feedback: { setError: vi.fn(), setNotice: vi.fn() },
    selection: { selectedProvider: 'codex_cli' },
    publish: (next: ChatSnapshot) => { snapshot = next; repaint() },
  } as unknown as SessionChatContext)
  instances.push(actions)
  const props = () => ({ ...snapshot, onRestart: actions.onRestart, captureRestart: actions.captureRestart })
  const view = render(<StartNewConversation state={props()} />)
  repaint = () => view.rerender(<StartNewConversation state={props()} />)
  await act(async () => { void actions.activate('session-1') })
  function open() { fireEvent.click(screen.getByRole('button', { name: 'Start new conversation' })) }
  function confirm() { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Start new conversation' })) }
  return { actions, open, confirm, get snapshot() { return snapshot } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  sessionId = 'session-1'; recovery = false
  durable = completedChatFixture({ mode: 'write_note', composer: 'Controlled dark unsent message' })
  api.getChat.mockImplementation(async () => structuredClone(durable))
  api.getConversation.mockImplementation(async () => structuredClone(durable))
  api.saveChatComposer.mockImplementation(async (request: ChatComposerRequest) => {
    durable = { ...durable, composer: request.composer, mode: request.mode, revision: request.scope.expectedRevision + 1 }
    return structuredClone(durable)
  })
  api.restartChat.mockImplementation(async () => {
    durable = chatFixture({ draftId: 'new-chat', mode: 'chat' })
    return durable
  })
})
afterEach(() => { instances.splice(0).forEach(actions => actions.dispose()); cleanup(); vi.useRealTimers() })

it('confirms the captured conversation after its own mode autosave completes while the dialog is open', async () => {
  const h = await mount()
  act(() => h.actions.setMode('chat'))
  h.open()
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(h.snapshot.saving).toBe(false)
  expect(h.snapshot.chat?.revision).toBe(4)
  expect(h.snapshot.composer).toBe('Controlled dark unsent message')
  await act(async () => { h.confirm() })
  expect(api.restartChat).toHaveBeenCalledExactlyOnceWith({ scope: { sessionId: 'session-1', draftId: 'chat-1', expectedRevision: 4 } })
  expect(h.snapshot.chat?.draftId).toBe('new-chat')
  expect(h.snapshot.composer).toBe('')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.updateEntry).not.toHaveBeenCalled()
  expect(api.submitChat).not.toHaveBeenCalled()
})

it('settles an autosave that began after opening confirmation before restarting exactly that conversation', async () => {
  const h = await mount()
  const saved = deferred<ChatState>()
  api.saveChatComposer.mockReturnValueOnce(saved.promise)
  act(() => h.actions.setMode('chat'))
  h.open()
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(h.snapshot.saving).toBe(true)
  await act(async () => { h.confirm() })
  expect(api.restartChat).not.toHaveBeenCalled()
  expect(h.snapshot.composer).toBe('Controlled dark unsent message')
  await act(async () => { saved.resolve(completedChatFixture({ revision: 4, mode: 'chat', composer: 'Controlled dark unsent message' })) })
  expect(api.restartChat).toHaveBeenCalledOnce()
  expect(h.snapshot.chat?.draftId).toBe('new-chat')
  expect(h.snapshot.composer).toBe('')
  expect(api.updateEntry).not.toHaveBeenCalled()
})

it('permits a byte-equivalent refresh of the same conversation', async () => {
  const h = await mount()
  h.open()
  await act(async () => { void h.actions.activate('session-1') })
  await act(async () => { h.confirm() })
  expect(h.snapshot.chat?.draftId).toBe('new-chat')
  expect(api.restartChat).toHaveBeenCalledOnce()
})

it.each(['composer', 'mode', 'history', 'runs', 'submission', 'draft'] as const)('rejects durable %s ABA while confirmation is open', async field => {
  const h = await mount()
  h.open()
  const original = structuredClone(durable)
  const changed = {
    composer: { composer: 'Different authored work' }, mode: { mode: 'chat' as const },
    history: { messages: [{ ...durable.messages[0], text: 'New history' }] },
    runs: { aiRuns: [{ id: 'foreign-run' }] as ChatState['aiRuns'] },
    submission: { submission: { draftId: 'chat-1', noteId: 'note-1', submittedAt: 'new' } },
    draft: { draftId: 'another-chat' },
  }[field]
  durable = { ...durable, ...changed, revision: 4 }
  await act(async () => { void h.actions.activate('session-1') })
  durable = { ...original, revision: 5 }
  await act(async () => { void h.actions.activate('session-1') })
  await act(async () => { h.confirm() })
  expect(api.restartChat).not.toHaveBeenCalled()
  expect(h.snapshot.chat?.draftId).toBe('chat-1')
  expect(h.snapshot.composer).toBe(original.composer)
})

it.each(['input', 'mode', 'session', 'job', 'recovery'] as const)('protects %s while a confirmed restart settles its pending save', async field => {
  const h = await mount()
  const saved = deferred<ChatState>()
  api.saveChatComposer.mockReturnValueOnce(saved.promise)
  act(() => h.actions.setMode('chat'))
  h.open()
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  await act(async () => { h.confirm() })
  act(() => {
    if (field === 'mode') { h.actions.setMode('write_note'); h.actions.setMode('chat') }
    if (field === 'session') { sessionId = 'session-2'; void h.actions.activate('session-2'); sessionId = 'session-1'; void h.actions.activate('session-1') }
    if (field === 'job') h.actions.observeJob(chatJobFixture())
    if (field === 'recovery') recovery = true
    if (field === 'input') h.actions.onSetComposer('New work after confirming')
  })
  await act(async () => { saved.resolve(completedChatFixture({ mode: 'chat', revision: 4, composer: 'Controlled dark unsent message' })) })
  // A confirmed restart locks composer input; an attempted edit cannot race it.
  if (field === 'input') {
    expect(h.snapshot.composer).toBe('')
    expect(api.restartChat).toHaveBeenCalledOnce()
  } else {
    expect(api.restartChat).not.toHaveBeenCalled()
    expect(h.snapshot.chat?.draftId).toBe('chat-1')
    expect(h.snapshot.composer).toBe('Controlled dark unsent message')
  }
})

it('keeps Cancel independent from autosave and refuses opening a dialog during an existing save', async () => {
  const h = await mount()
  act(() => h.actions.setMode('chat'))
  h.open()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  expect(api.restartChat).not.toHaveBeenCalled()
  expect(h.snapshot.composer).toBe('Controlled dark unsent message')
  const saved = deferred<ChatState>()
  api.saveChatComposer.mockReturnValueOnce(saved.promise)
  act(() => h.actions.setMode('write_note'))
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  h.open()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await act(async () => { saved.resolve({ ...durable, mode: 'write_note', revision: 5 }) })
})


it('does not discard a foreign persisted composer hidden behind dirty local input', async () => {
  const h = await mount()
  act(() => h.actions.onSetComposer('Local confirmed input'))
  h.open()
  durable = { ...durable, composer: 'Foreign persisted input', revision: 4 }
  await act(async () => { void h.actions.activate('session-1') })
  expect(h.snapshot.composer).toBe('Local confirmed input')
  await act(async () => { h.confirm() })
  expect(api.restartChat).not.toHaveBeenCalled()
  expect(h.snapshot.chat?.draftId).toBe('chat-1')
  expect(h.snapshot.composer).toBe('Local confirmed input')
})

it('retains the conversation and surfaces a pending-save failure after explicit confirmation', async () => {
  const h = await mount()
  let reject!: (cause: Error) => void
  api.saveChatComposer.mockReturnValueOnce(new Promise<ChatState>((_resolve, fail) => { reject = fail }))
  act(() => h.actions.setMode('chat'))
  h.open()
  await act(async () => { await vi.advanceTimersByTimeAsync(500) })
  await act(async () => { h.confirm() })
  await act(async () => { reject(new Error('Persistence unavailable')) })
  expect(api.restartChat).not.toHaveBeenCalled()
  expect(h.snapshot.chat?.draftId).toBe('chat-1')
  expect(h.snapshot.composer).toBe('Controlled dark unsent message')
  expect(h.snapshot.error).toContain('Persistence unavailable')
})
