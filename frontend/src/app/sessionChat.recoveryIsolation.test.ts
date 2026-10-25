import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSessionChatActions } from './sessionChat.actions'
import type { SessionChatContext } from './sessionChat.types'
import { chatFixture } from './useSessionChat.testSupport'
import type { ChatComposerRequest, ChatRef, ChatState } from '../bindings'

const api = vi.hoisted(() => ({ getChat: vi.fn(), getConversation: vi.fn(), activateConversation: vi.fn(), startChatJob: vi.fn(), restartChat: vi.fn(), saveChatComposer: vi.fn(), listActiveAiActionJobs: vi.fn() }))
vi.mock('../tauri', async original => ({ ...await original<typeof import('../tauri')>(), ...api }))
const A = { sessionId: 'session-1', draftId: 'notes-A' }
const B = { sessionId: 'session-1', draftId: 'record-B' }
let rows: Map<string, ChatState>
let engine: ReturnType<typeof createSessionChatActions>
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetAllMocks()
  rows = new Map([[A.draftId, chatFixture({ ...A, mode: 'chat' })], [B.draftId, chatFixture({ ...B, mode: 'chat', owner: { kind: 'record', sessionId: B.sessionId, record: { kind: 'finding', recordId: 'source-B' } } })]])
  api.getChat.mockImplementation(async () => rows.get(A.draftId))
  api.getConversation.mockImplementation(async (ref: ChatRef) => structuredClone(rows.get(ref.draftId)))
  api.activateConversation.mockImplementation(async (ref: ChatRef) => structuredClone(rows.get(ref.draftId)))
  api.saveChatComposer.mockImplementation(async (request: ChatComposerRequest) => {
    const chat = { ...rows.get(request.scope.draftId)!, composer: request.composer, composerIntent: request.intent ?? { kind: 'message' as const }, mode: request.mode, revision: request.scope.expectedRevision + 1 }
    rows.set(chat.draftId, chat)
    return chat
  })
  api.listActiveAiActionJobs.mockResolvedValue([])
  api.restartChat.mockImplementation(async () => chatFixture({ sessionId: A.sessionId, draftId: 'replacement-notes' }))
  engine = createSessionChatActions({ session: { activeSessionIdRef: { current: A.sessionId } }, noteRecovery: { isRetired: () => false, has: () => false, hasPending: () => false }, feedback: { setError: vi.fn(), setNotice: vi.fn() }, publish: vi.fn(), selection: { selectedProvider: 'codex_cli', selectedModel: 'fixture', selectedReasoningEffort: null }, provider: { available: true }, providerWarning: null, captureContext: () => ({ kind: 'session' }) } as unknown as SessionChatContext)
  await engine.activate(A.sessionId)
})
afterEach(() => { engine.dispose(); vi.useRealTimers() })

it.each([A, B].flatMap(reference => [false, true].map(refreshBeforeFailure => ({ reference, refreshBeforeFailure }))))('recovers a completed Retry in $reference.draftId, earlier refresh $refreshBeforeFailure', async ({ reference, refreshBeforeFailure }) => {
  const user = { id: 'same-user', turnId: 'old-attempt', role: 'user' as const, text: 'Literal retained retry question', images: [], status: 'failed' as const, errorMessage: 'fixture failure', aiRunId: 'old-run', createdAt: 'then' }
  rows.set(reference.draftId, { ...rows.get(reference.draftId)!, revision: 2, messages: [user] })
  const handle = await engine.select(reference)
  api.startChatJob.mockImplementation(async () => {
    rows.set(reference.draftId, { ...rows.get(reference.draftId)!, revision: 4, messages: [{ ...user, turnId: 'retry-attempt', status: 'completed', errorMessage: null, aiRunId: 'retry-run' }, { id: 'assistant-retry', turnId: 'retry-attempt', role: 'assistant', text: 'Literal recovered reply', images: [], status: 'completed', errorMessage: null, aiRunId: 'retry-run', createdAt: 'now' }] })
    if (refreshBeforeFailure) await handle.refresh()
    throw new Error('Start response and Channel lost')
  })
  await handle.retry(); await handle.recheck()
  expect(handle.snapshot().chat?.messages.at(-1)?.text).toBe('Literal recovered reply')
  expect(handle.snapshot().inputRecoveryPending).toBe(false)
  expect(handle.snapshot().error).toBeNull()
  expect(api.startChatJob).toHaveBeenCalledTimes(1)
})

it('retains suppression when an exact Retry read still shows only the failed attempt', async () => {
  rows.set(A.draftId, { ...rows.get(A.draftId)!, messages: [{ id: 'same-user', turnId: 'old-attempt', role: 'user', text: 'Literal failed question', images: [], status: 'failed', errorMessage: 'Failure', aiRunId: 'old-run', createdAt: 'then' }] })
  const handle = await engine.select(A)
  api.startChatJob.mockRejectedValue(new Error('Lost start response'))
  await handle.retry(); await handle.recheck(); await handle.retry()
  expect(handle.snapshot().inputRecoveryPending).toBe(true)
  expect(handle.snapshot().chat?.messages[0].turnId).toBe('old-attempt')
  expect(api.startChatJob).toHaveBeenCalledTimes(1)
})

it('rejects a restart confirmation after conversation A to B to A selection', async () => {
  const handle = engine.bind(A)
  const confirm = handle.captureRestart()
  expect(confirm).not.toBeNull()
  await engine.select(B); await engine.select(A); await confirm!()
  expect(api.restartChat).not.toHaveBeenCalled()
  expect(handle.snapshot().chat?.draftId).toBe(A.draftId)
})

it('rejects conversation ABA while confirmed restart awaits its composer save', async () => {
  const handle = engine.bind(A)
  handle.setMode('write_note')
  const saving = deferred<void>(), saved = deferred<ChatState>()
  api.saveChatComposer.mockImplementationOnce(() => { saving.resolve(); return saved.promise })
  const confirm = handle.captureRestart()
  expect(confirm).not.toBeNull()
  const pending = confirm!()
  await saving.promise
  await engine.select(B); await engine.select(A)
  saved.resolve({ ...rows.get(A.draftId)!, revision: 1, mode: 'write_note' })
  await pending
  expect(api.restartChat).not.toHaveBeenCalled()
  expect(handle.snapshot().chat?.draftId).toBe(A.draftId)
})

it.each(['refresh', 'select', 'activate'] as const)('permits same-conversation %s while confirmation is open', async operation => {
  const handle = engine.bind(A)
  const confirm = handle.captureRestart()
  expect(confirm).not.toBeNull()
  if (operation === 'refresh') await handle.refresh()
  if (operation === 'select') await engine.select(A)
  if (operation === 'activate') await engine.activate(A.sessionId)
  await confirm!()
  expect(api.restartChat).toHaveBeenCalledExactlyOnceWith({ scope: { ...A, expectedRevision: 0 } })
})
