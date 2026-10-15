import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider, GenerationJobStatus } from '../bindings'
import { createSessionChatActions } from './sessionChat.actions'
import { emptyChatSnapshot, type ChatSnapshot, type SessionChatContext } from './sessionChat.types'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'

const api = vi.hoisted(() => ({
  decideChatPermission: vi.fn(), getChat: vi.fn(), getAiActionJobStatus: vi.fn(),
  cancelAiActionJob: vi.fn(), startChatJob: vi.fn(), saveChatComposer: vi.fn(),
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

function harness(provider: AiProvider = 'claude_code') {
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
  actions.activate('session-1')
  actions.observeJob(pending(provider))
  return { actions, ctx, retired, get snapshot() { return snapshot } }
}
let instances: ReturnType<typeof harness>[] = []
function setup(provider?: AiProvider) {
  const instance = harness(provider)
  instances.push(instance)
  return instance
}

describe('Session Chat explicit permission authority', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    api.getChat.mockResolvedValue(chatFixture())
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
    const h = setup(provider)
    await h.actions.onDecidePermission('permission-1', 'approve')
    expect(api.decideChatPermission).toHaveBeenCalledExactlyOnceWith({
      jobId: 'job-chat', sessionId: 'session-1', provider, requestId: 'permission-1', decision: 'approve',
    })
    expect(h.snapshot.job?.pendingPermission).toBeFalsy()
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(api.saveChatComposer).not.toHaveBeenCalled()
  })

  it('serializes duplicate clicks and does not replay a resolved token', async () => {
    const gate = deferred<GenerationJobStatus>()
    api.decideChatPermission.mockReturnValue(gate.promise)
    const h = setup()
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
    const h = setup('copilot_cli')
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
    const h = setup('copilot_cli')
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
    const h = setup()
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
    const h = setup()
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

  it.each(['token', 'provider', 'session', 'disposed', 'retired', 'terminal'] as const)('rejects %s changes before invoking', async (change) => {
    const h = setup()
    if (change === 'token') h.actions.observeJob(pending('claude_code', { pendingPermission: { ...pending().pendingPermission!, requestId: 'permission-2' } }))
    if (change === 'provider') h.ctx.selection.selectedProvider = 'codex_cli'
    if (change === 'session') h.ctx.session.activeSessionIdRef.current = 'session-2'
    if (change === 'disposed') h.actions.dispose()
    if (change === 'retired') { h.retired.add('session-1'); h.actions.retire('session-1') }
    if (change === 'terminal') h.actions.observeJob(stopped)
    await h.actions.onDecidePermission('permission-1', 'approve')
    expect(api.decideChatPermission).not.toHaveBeenCalled()
  })

  it.each(['session', 'provider', 'token', 'disposed', 'retired', 'foreign-job', 'foreign-session', 'foreign-action'] as const)('does not publish a late decision after %s change', async (change) => {
    const gate = deferred<GenerationJobStatus>()
    api.decideChatPermission.mockReturnValue(gate.promise)
    const h = setup()
    const deciding = h.actions.onDecidePermission('permission-1', 'approve')
    expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
    // Drain initial hydration before establishing the post-change snapshot.
    await Promise.resolve()
    if (change === 'session') { h.ctx.session.activeSessionIdRef.current = 'session-2'; h.actions.activate('session-2'); await Promise.resolve() }
    if (change === 'provider') h.ctx.selection.selectedProvider = 'codex_cli'
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
    const h = setup()
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
    const h = setup()
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
    const h = setup()
    await h.actions.onDecidePermission('permission-1', 'deny')
    expect(api.getAiActionJobStatus).toHaveBeenCalledWith('job-chat')
    expect(Boolean(h.snapshot.job?.pendingPermission)).toBe(stillPending)
    expect(h.snapshot.error).toContain('Channel lost')
    await vi.advanceTimersByTimeAsync(2000)
    expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
    expect(api.startChatJob).not.toHaveBeenCalled()
  })

  it('explicit recheck reloads job status and Chat, uses real provider refresh and does not resubmit', async () => {
    const h = setup()
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

  it('does not invent provider readiness when recheck fails', async () => {
    const h = setup()
    h.ctx.provider = { ...h.ctx.provider!, available: false, reason: 'Connector disconnected' }
    vi.mocked(h.ctx.refreshProviderStatus!).mockRejectedValue(new Error('Connector disconnected'))
    await h.actions.onRecheck()
    expect(h.ctx.provider.available).toBe(false)
    expect(h.snapshot.error).toContain('Connector disconnected')
    expect(api.startChatJob).not.toHaveBeenCalled()
  })

  it('a new job does not inherit authority and old jobs never replace it', async () => {
    const h = setup()
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
