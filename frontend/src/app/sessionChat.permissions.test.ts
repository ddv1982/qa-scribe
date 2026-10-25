import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider, ChatPermissionDecision, ChatRef, ChatState, GenerationJobStatus } from '../bindings'
import { createSessionChatActions } from './sessionChat.actions'
import { emptyChatSnapshot, type ChatSnapshot, type SessionChatContext } from './sessionChat.types'
import { chatFixture, chatJobFixture, completedChatFixture } from './useSessionChat.testSupport'

const api = vi.hoisted(() => ({
  decideChatPermission: vi.fn(), getConversation: vi.fn<(reference: ChatRef) => Promise<ChatState>>(), getChat: vi.fn<(sessionId: string) => Promise<ChatState>>(), getAiActionJobStatus: vi.fn(),
  cancelAiActionJob: vi.fn(), startChatJob: vi.fn(), saveChatComposer: vi.fn(), listActiveAiActionJobs: vi.fn(),
}))
vi.mock('../tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tauri')>()
  return { ...actual, ...api, commands: { ...actual.commands, decideChatPermission: api.decideChatPermission } }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function pending(provider: AiProvider = 'claude_code', patch: Partial<GenerationJobStatus> = {}) {
  return chatJobFixture({ pendingPermission: {
    requestId: 'permission-1', provider, title: 'Read test data', toolName: 'read',
    serverName: 'qa', inputJson: '{"path":"fixture.json"}',
  }, ...patch })
}
const stopped: GenerationJobStatus = chatJobFixture({ state: 'cancelled', pendingPermission: null })
const clean: GenerationJobStatus = chatJobFixture({ pendingPermission: null })
// Temporary compatibility until the backend regenerates ChatPermissionDecision.
const approveAll: ChatPermissionDecision = 'approveAll'

async function harness(provider: AiProvider = 'claude_code') {
  let snapshot: ChatSnapshot = emptyChatSnapshot
  const retired = new Set<string>()
  // Actions use only these capabilities for this slice. The production context
  // has additional Session/Note fields which these permission tests never use.
  const ctx = {
    session: { activeSessionIdRef: { current: 'session-1' } },
    selection: { selectedProvider: provider, selectedModel: 'test-model', selectedReasoningEffort: null },
    provider: { available: true }, providerWarning: null,
    noteRecovery: { isRetired: (id: string) => retired.has(id), has: () => false, hasPending: () => false },
    feedback: { setError: vi.fn(), setNotice: vi.fn() },
    refreshProviderStatus: vi.fn().mockResolvedValue(undefined),
    publish: (value: ChatSnapshot | ((previous: ChatSnapshot) => ChatSnapshot)) => {
      snapshot = typeof value === 'function' ? value(snapshot) : value
    },
  } as unknown as SessionChatContext
  const actions = createSessionChatActions(ctx)
  await actions.activate('session-1')
  actions.observeJob(pending(provider))
  return { actions, ctx, retired, get snapshot() { return snapshot } }
}
let instances: Awaited<ReturnType<typeof harness>>[] = []
async function setup(provider?: AiProvider) {
  const instance = await harness(provider)
  instances.push(instance)
  return instance
}

describe('Session Chat explicit permission authority', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    api.getChat.mockResolvedValue(chatFixture())
    api.getConversation.mockImplementation(async reference => { const chat = await api.getChat(reference.sessionId); if (chat.draftId !== reference.draftId) throw new Error('Wrong exact draft'); return chat })
    api.listActiveAiActionJobs.mockResolvedValue([])
    api.getAiActionJobStatus.mockResolvedValue(pending())
    api.decideChatPermission.mockResolvedValue(clean)
    api.cancelAiActionJob.mockResolvedValue(stopped)
  })
  afterEach(() => {
    for (const instance of instances) instance.actions.dispose()
    instances = []
    vi.useRealTimers()
  })

  it.each(['claude_code', 'codex_cli', 'copilot_cli'] as const)('sends only the exact %s request identity and explicit decision', async (provider) => {
    const h = await setup(provider)
    await h.actions.onDecidePermission('permission-1', 'approve')
    expect(api.decideChatPermission).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-chat', sessionId: 'session-1', provider, requestId: 'permission-1', decision: 'approve',
    })
    expect(h.snapshot.job?.pendingPermission).toBeFalsy()
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(api.saveChatComposer).not.toHaveBeenCalled()
  })

  it.each(['claude_code', 'codex_cli', 'copilot_cli'] as const)('dispatches bulk approval with the exact %s response identity only once', async (provider) => {
    const gate = deferred<GenerationJobStatus>()
    api.decideChatPermission.mockReturnValue(gate.promise)
    const h = await setup(provider)
    const first = h.actions.onDecidePermission('permission-1', approveAll)
    const duplicate = h.actions.onDecidePermission('permission-1', approveAll)
    expect(h.snapshot.permissionWorking).toBe(true)
    expect(api.decideChatPermission).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-chat', sessionId: 'session-1', provider, requestId: 'permission-1', decision: 'approveAll',
    })
    gate.resolve(clean)
    await Promise.all([first, duplicate])
    h.actions.observeJob(pending(provider))
    await h.actions.onDecidePermission('permission-1', approveAll)
    expect(h.snapshot.job?.pendingPermission).toBeFalsy()
    expect(h.snapshot.permissionWorking).toBe(false)
    expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(api.saveChatComposer).not.toHaveBeenCalled()
  })

  it.each(['claude_code', 'codex_cli', 'copilot_cli'] as const)('refuses unavailable %s bulk approval before invoking or suppressing the token', async (provider) => {
    const status = pending(provider)
    const request = Object.assign(status.pendingPermission!, { canApprove: false })
    const h = await setup(provider)
    await Promise.resolve()
    h.actions.observeJob(status)
    const forged = h.actions.onDecidePermission(request.requestId, approveAll)
    expect(api.decideChatPermission).not.toHaveBeenCalled()
    expect(h.snapshot.permissionWorking).toBe(false)
    expect(h.snapshot.job?.pendingPermission).toEqual(request)
    h.actions.observeJob(status)
    expect(h.snapshot.job?.pendingPermission).toEqual(request)
    await forged
    expect(api.getAiActionJobStatus).not.toHaveBeenCalled()
    await h.actions.onDecidePermission(request.requestId, 'deny')
    expect(api.decideChatPermission).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-chat', sessionId: 'session-1', provider, requestId: request.requestId, decision: 'deny',
    })
  })

  it.each(['forged', 'stale', 'session', 'disposed', 'retired', 'terminal'] as const)('refuses %s bulk authority before invoke', async (change) => {
    const h = await setup()
    if (change === 'stale') h.actions.observeJob(pending('claude_code', { pendingPermission: { ...pending().pendingPermission!, requestId: 'permission-2' } }))
    if (change === 'session') h.ctx.session.activeSessionIdRef.current = 'session-2'
    if (change === 'disposed') h.actions.dispose()
    if (change === 'retired') { h.retired.add('session-1'); h.actions.retire('session-1') }
    if (change === 'terminal') h.actions.observeJob(stopped)
    await h.actions.onDecidePermission(change === 'forged' ? 'forged-token' : 'permission-1', approveAll)
    expect(api.decideChatPermission).not.toHaveBeenCalled()
    expect(h.snapshot.permissionWorking).toBe(false)
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(api.saveChatComposer).not.toHaveBeenCalled()
  })

  it('serializes duplicate clicks and does not replay a resolved token', async () => {
    const gate = deferred<GenerationJobStatus>()
    api.decideChatPermission.mockReturnValue(gate.promise)
    const h = await setup()
    const first = h.actions.onDecidePermission('permission-1', 'deny')
    const duplicate = h.actions.onDecidePermission('permission-1', 'approve')
    expect(h.snapshot.permissionWorking).toBe(true)
    expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
    expect(api.decideChatPermission.mock.calls[0][0]).toMatchObject({ decision: 'deny' })
    gate.resolve(clean)
    await Promise.all([first, duplicate])
    await h.actions.onDecidePermission('permission-1', 'deny')
    expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
    expect(h.snapshot.permissionWorking).toBe(false)
  })

  it('refuses forged reject-only Copilot approval before mutating local permission state, then allows explicit deny (discussion_r4276620738)', async () => {
    const status = pending('copilot_cli')
    const request = Object.assign(status.pendingPermission!, { canApprove: false })
    const h = await setup('copilot_cli')
    await Promise.resolve()
    h.actions.observeJob(status)
    const forgedApproval = h.actions.onDecidePermission(request.requestId, 'approve')

    // Check synchronously: even a transient invoke/operation or token suppression
    // is forbidden, not merely an eventual recovery after the backend refuses it.
    expect(api.decideChatPermission).not.toHaveBeenCalled()
    expect(h.snapshot.permissionWorking).toBe(false)
    expect(h.snapshot.job?.pendingPermission).toEqual(request)
    h.actions.observeJob(status)
    expect(h.snapshot.job?.pendingPermission).toEqual(request)
    await forgedApproval
    expect(api.getAiActionJobStatus).not.toHaveBeenCalled()

    const gate = deferred<GenerationJobStatus>()
    api.decideChatPermission.mockReturnValue(gate.promise)
    const denying = h.actions.onDecidePermission(request.requestId, 'deny')
    expect(api.decideChatPermission).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-chat', sessionId: 'session-1', provider: 'copilot_cli',
      requestId: request.requestId, decision: 'deny',
    })
    expect(h.snapshot.permissionWorking).toBe(true)
    gate.resolve(clean)
    await denying
    expect(h.snapshot.permissionWorking).toBe(false)
    expect(h.snapshot.job?.pendingPermission).toBeFalsy()
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(api.saveChatComposer).not.toHaveBeenCalled()
  })

  it('allows approval for a legacy Copilot payload without canApprove', async () => {
    const status = pending('copilot_cli')
    expect(status.pendingPermission).not.toHaveProperty('canApprove')
    const h = await setup('copilot_cli')
    h.actions.observeJob(status)
    await h.actions.onDecidePermission('permission-1', 'approve')
    expect(api.decideChatPermission).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-chat', sessionId: 'session-1', provider: 'copilot_cli',
      requestId: 'permission-1', decision: 'approve',
    })
    expect(h.snapshot.job?.pendingPermission).toBeFalsy()
  })

  it('allows Cancel while a permission invoke is awaiting and ignores its late running response', async () => {
    const gate = deferred<GenerationJobStatus>()
    api.decideChatPermission.mockReturnValue(gate.promise)
    const h = await setup()
    const deciding = h.actions.onDecidePermission('permission-1', 'approve')
    await h.actions.onCancel()
    expect(api.cancelAiActionJob).toHaveBeenCalledWith('job-chat')
    expect(h.snapshot.job?.state).toBe('cancelled')
    gate.resolve(clean)
    await deciding
    expect(h.snapshot.job?.state).toBe('cancelled')
    expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
  })

  it('releases the old job permission operation after Cancel so a new job can decide before the old invoke settles', async () => {
    const oldInvoke = deferred<GenerationJobStatus>()
    const newJob = pending('claude_code', {
      jobId: 'job-new-after-cancel',
      pendingPermission: { ...pending().pendingPermission!, requestId: 'permission-new-after-cancel' },
    })
    const newAccepted = { ...newJob, pendingPermission: null }
    api.decideChatPermission.mockReturnValueOnce(oldInvoke.promise).mockResolvedValueOnce(newAccepted)
    const h = await setup()
    const oldDecision = h.actions.onDecidePermission('permission-1', 'approve')
    expect(api.decideChatPermission).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-chat', sessionId: 'session-1', requestId: 'permission-1',
      provider: 'claude_code', decision: 'approve',
    })
    expect(h.snapshot.permissionWorking).toBe(true)

    await h.actions.onCancel()
    expect(api.cancelAiActionJob).toHaveBeenCalledExactlyOnceWith('job-chat')
    expect(h.snapshot.job?.state).toBe('cancelled')
    h.actions.observeJob(newJob)
    expect(h.snapshot.job).toEqual(newJob)

    const newDecision = h.actions.onDecidePermission('permission-new-after-cancel', 'deny')
    // Assert before awaiting: returning the old unresolved operation must fail
    // here, not hide the regression behind a test timeout or resolving it early.
    expect(api.decideChatPermission).toHaveBeenCalledTimes(2)
    expect(api.decideChatPermission).toHaveBeenLastCalledWith({
      jobId: 'job-new-after-cancel', sessionId: 'session-1', requestId: 'permission-new-after-cancel',
      provider: 'claude_code', decision: 'deny',
    })
    expect(newDecision).not.toBe(oldDecision)
    await newDecision
    expect(h.snapshot.job).toEqual(newAccepted)
    expect(h.snapshot.permissionWorking).toBe(false)

    oldInvoke.resolve(clean)
    await oldDecision
    expect(h.snapshot.job).toEqual(newAccepted)
    expect(h.snapshot.permissionWorking).toBe(false)
    expect(api.decideChatPermission).toHaveBeenCalledTimes(2)
    expect(api.startChatJob).not.toHaveBeenCalled()
  })

  it.each(['token', 'session', 'disposed', 'retired', 'terminal'] as const)('rejects %s changes before invoking', async (change) => {
    const h = await setup()
    if (change === 'token') h.actions.observeJob(pending('claude_code', { pendingPermission: { ...pending().pendingPermission!, requestId: 'permission-2' } }))
    if (change === 'session') h.ctx.session.activeSessionIdRef.current = 'session-2'
    if (change === 'disposed') h.actions.dispose()
    if (change === 'retired') { h.retired.add('session-1'); h.actions.retire('session-1') }
    if (change === 'terminal') h.actions.observeJob(stopped)
    await h.actions.onDecidePermission('permission-1', 'approve')
    expect(api.decideChatPermission).not.toHaveBeenCalled()
  })

  it.each(['session', 'token', 'disposed', 'retired', 'foreign-job', 'foreign-session', 'foreign-action'] as const)('does not publish a late decision after %s change', async (change) => {
    const gate = deferred<GenerationJobStatus>()
    api.decideChatPermission.mockReturnValue(gate.promise)
    const h = await setup()
    const deciding = h.actions.onDecidePermission('permission-1', 'approve')
    expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
    // Drain initial hydration before establishing the post-change snapshot.
    await Promise.resolve()
    if (change === 'session') { h.ctx.session.activeSessionIdRef.current = 'session-2'; void h.actions.activate('session-2'); await Promise.resolve() }
    if (change === 'token') h.actions.observeJob(pending('claude_code', { pendingPermission: { ...pending().pendingPermission!, requestId: 'permission-2' } }))
    if (change === 'disposed') h.actions.dispose()
    if (change === 'retired') { h.retired.add('session-1'); h.actions.retire('session-1') }
    const before = h.snapshot.job
    gate.resolve({ ...clean,
      ...(change === 'foreign-job' ? { jobId: 'foreign-job' } : {}),
      ...(change === 'foreign-session' ? { sessionId: 'session-2' } : {}),
      ...(change === 'foreign-action' ? { action: 'session_report' } : {}),
    })
    await deciding
    expect(h.snapshot.job).toEqual(before)
    expect(api.startChatJob).not.toHaveBeenCalled()
  })

  it('suppresses late pending events and polling snapshots after an accepted decision', async () => {
    const h = await setup()
    await h.actions.onDecidePermission('permission-1', 'approve')
    h.actions.observeJob(pending())
    expect(h.snapshot.job?.pendingPermission).toBeFalsy()
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.getAiActionJobStatus).toHaveBeenCalledWith('job-chat')
    expect(h.snapshot.job?.pendingPermission).toBeFalsy()
    expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
  })

  it('suppresses an attempted token during invoke so late pending status cannot invite replay', async () => {
    const gate = deferred<GenerationJobStatus>()
    api.decideChatPermission.mockReturnValue(gate.promise)
    const h = await setup()
    const deciding = h.actions.onDecidePermission('permission-1', 'approve')
    h.actions.observeJob(pending())
    expect(h.snapshot.job?.pendingPermission).toBeFalsy()
    const duplicate = h.actions.onDecidePermission('permission-1', 'deny')
    expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
    gate.resolve(clean)
    await Promise.all([deciding, duplicate])
  })

  it.each([true, false])('recovers failed decisions from authoritative status (still pending: %s), never a model request', async (stillPending) => {
    api.decideChatPermission.mockRejectedValue(new Error('Channel lost'))
    api.getAiActionJobStatus.mockResolvedValue(stillPending ? pending() : clean)
    const h = await setup()
    await h.actions.onDecidePermission('permission-1', 'deny')
    expect(api.getAiActionJobStatus).toHaveBeenCalledWith('job-chat')
    expect(Boolean(h.snapshot.job?.pendingPermission)).toBe(stillPending)
    expect(h.snapshot.error).toContain('Channel lost')
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
    expect(api.startChatJob).not.toHaveBeenCalled()
  })

  it('explicit recheck reloads job status and Chat, uses real provider refresh and does not resubmit', async () => {
    const h = await setup()
    await Promise.resolve()
    api.getChat.mockClear()
    api.getAiActionJobStatus.mockResolvedValue(clean)
    api.getChat.mockResolvedValue(chatFixture({ revision: 8 }))
    await h.actions.onRecheck()
    expect(api.getAiActionJobStatus).toHaveBeenCalledWith('job-chat')
    expect(api.getChat).toHaveBeenCalledWith('session-1')
    expect(h.snapshot.chat?.revision).toBe(8)
    expect(h.snapshot.job?.pendingPermission).toBeFalsy()
    expect(h.ctx.refreshProviderStatus).toHaveBeenCalledTimes(1)
    expect(api.decideChatPermission).not.toHaveBeenCalled()
    expect(api.startChatJob).not.toHaveBeenCalled()
  })


  it.each(['failed', 'running'] as const)('rechecks an uncertain %s send when its previous terminal job was pruned', async status => {
    const initial = completedChatFixture({ composer: 'Next question' })
    const recovered = completedChatFixture({ revision: 4, messages: [...initial.messages, {
      id: 'message-3', turnId: 'turn-2', role: 'user', text: 'Next question', images: [],
      status, errorMessage: status === 'failed' ? 'Provider unavailable' : null, aiRunId: 'run-new', createdAt: 'now',
    }] })
    api.getChat.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('Recovery unavailable')).mockResolvedValue(recovered)
    api.startChatJob.mockRejectedValueOnce(new Error('Start response lost'))
    const h = await setup()
    await vi.advanceTimersByTimeAsync(0)
    h.actions.observeJob(chatJobFixture({ state: 'completed', pendingPermission: null }))
    await Promise.resolve(); await Promise.resolve()
    api.getChat.mockReset().mockRejectedValueOnce(new Error('Recovery unavailable')).mockResolvedValue(recovered)
    await h.actions.onSend()
    expect(h.snapshot.inputRecoveryPending).toBe(true)
    h.actions.onSetComposer('Keep my next draft')
    api.getAiActionJobStatus.mockRejectedValueOnce({ kind: 'notFound', message: 'Job was pruned' })
    api.listActiveAiActionJobs.mockResolvedValue([
      chatJobFixture({ jobId: 'other-session', sessionId: 'session-2' }),
      chatJobFixture({ jobId: 'wrong-turn', aiRunId: 'run-other', chat: { reference: { sessionId: 'session-1', draftId: 'other-chat' } } }),
      chatJobFixture({ jobId: 'job-new', aiRunId: 'run-new', pendingPermission: null }),
    ])
    await h.actions.onRecheck()
    expect(h.snapshot.inputRecoveryPending).toBe(false)
    expect(h.snapshot.chat?.messages).toEqual(recovered.messages)
    expect(h.snapshot.composer).toBe('Keep my next draft')
    expect(api.startChatJob).toHaveBeenCalledOnce()
    expect(api.getChat).toHaveBeenCalledTimes(2)
    if (status === 'running') {
      expect(h.snapshot.job?.jobId).toBe('job-new')
      api.getAiActionJobStatus.mockResolvedValue(chatJobFixture({ jobId: 'job-new', aiRunId: 'run-new', state: 'completed', pendingPermission: null }))
      const completed = completedChatFixture({ revision: 5, messages: [
        ...recovered.messages.map(message => ({ ...message, status: 'completed' as const })),
        { id: 'message-4', turnId: 'turn-2', role: 'assistant', text: 'Which browser?', images: [],
          status: 'completed', errorMessage: null, aiRunId: 'run-new', createdAt: 'later' },
      ] })
      api.getChat.mockResolvedValue(completed)
      await vi.advanceTimersByTimeAsync(1000)
      expect(api.getAiActionJobStatus).toHaveBeenLastCalledWith('job-new')
      expect(h.snapshot.chat?.revision).toBe(5)
      expect(h.snapshot.composer).toBe('Keep my next draft')
    }
  })

  it('keeps missing-job errors visible when no uncertain send needs recovery', async () => {
    const h = await setup()
    await vi.advanceTimersByTimeAsync(0)
    api.getChat.mockClear()
    api.getAiActionJobStatus.mockRejectedValueOnce({ kind: 'notFound', message: 'Job was pruned' })
    await h.actions.onRecheck()
    expect(api.getChat).not.toHaveBeenCalled()
    expect(h.snapshot.error).toContain('Job was pruned')
    expect(api.startChatJob).not.toHaveBeenCalled()
  })

  it('does not invent provider readiness when recheck fails', async () => {
    const h = await setup()
    h.ctx.provider = { ...h.ctx.provider!, available: false, reason: 'Connector disconnected' }
    vi.mocked(h.ctx.refreshProviderStatus!).mockRejectedValue(new Error('Connector disconnected'))
    await h.actions.onRecheck()
    expect(h.ctx.provider.available).toBe(false)
    expect(h.snapshot.error).toContain('Connector disconnected')
    expect(api.startChatJob).not.toHaveBeenCalled()
  })

  it('a new job does not inherit authority and old jobs never replace it', async () => {
    const h = await setup()
    await h.actions.onDecidePermission('permission-1', 'approve')
    h.actions.observeJob(chatJobFixture({ state: 'completed', pendingPermission: null }))
    h.actions.observeJob(pending('claude_code', { jobId: 'job-new' }))
    expect(h.snapshot.job?.jobId).toBe('job-new')
    expect(h.snapshot.job?.pendingPermission?.requestId).toBe('permission-1')
    h.actions.observeJob(pending())
    h.actions.observeJob(stopped)
    expect(h.snapshot.job?.jobId).toBe('job-new')
    await h.actions.onDecidePermission('permission-1', 'deny')
    expect(api.decideChatPermission).toHaveBeenCalledTimes(2)
    expect(api.decideChatPermission).toHaveBeenLastCalledWith({
      jobId: 'job-new', sessionId: 'session-1', requestId: 'permission-1', provider: 'claude_code', decision: 'deny',
    })
  })
})

it('keeps the captured execution provider when the global next-provider preference changes', async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  api.getChat.mockResolvedValue(chatFixture())
  api.getConversation.mockResolvedValue(chatFixture())
  api.decideChatPermission.mockResolvedValue(clean)
  const h = await setup('claude_code')
  h.ctx.selection.selectedProvider = 'codex_cli'
  await h.actions.onDecidePermission('permission-1', 'approve')
  expect(api.decideChatPermission).toHaveBeenLastCalledWith({ jobId: 'job-chat', sessionId: 'session-1', requestId: 'permission-1', provider: 'claude_code', decision: 'approve' })
  expect(h.snapshot.job?.pendingPermission).toBeNull()
  h.actions.dispose(); vi.useRealTimers()
})

it.each(['success', 'catch', 'recheck', 'enumeration', 'terminal'] as const)('wrong-provider %s cannot release attempted-token suppression', async lane => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  api.getChat.mockResolvedValue(chatFixture())
  api.getConversation.mockResolvedValue(chatFixture())
  const foreign = pending('codex_cli', lane === 'terminal' ? { state: 'completed' } : {})
  const gate = deferred<GenerationJobStatus>()
  api.decideChatPermission.mockReturnValue(gate.promise)
  api.getAiActionJobStatus.mockResolvedValue(foreign)
  api.listActiveAiActionJobs.mockResolvedValue([foreign])
  const h = await setup('claude_code')
  const deciding = h.actions.onDecidePermission('permission-1', 'approve')
  if (lane === 'catch') gate.reject(new Error('Lost response'))
  else gate.resolve(foreign)
  await deciding
  if (lane === 'recheck' || lane === 'enumeration') await h.actions.onRecheck()
  if (lane === 'terminal') h.actions.observeJob(foreign)
  h.actions.observeJob(pending('claude_code'))
  await h.actions.onDecidePermission('permission-1', 'approve')
  expect(h.snapshot.job?.pendingPermission).toBeNull()
  expect(h.snapshot.job?.state).toBe('running')
  expect(h.snapshot.permissionRecoveryPending).toBe(true)
  expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
  h.actions.dispose(); vi.useRealTimers()
})
