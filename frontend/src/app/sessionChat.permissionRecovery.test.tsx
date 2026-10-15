import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiProvider } from '../bindings'
import { SessionChatView, type SessionChatViewProps } from '../views/SessionChatView'
import { createSessionChatActions } from './sessionChat.actions'
import { emptyChatSnapshot, type ChatSnapshot, type SessionChatContext } from './sessionChat.types'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'

const api = vi.hoisted(() => ({
  decideChatPermission: vi.fn(), getAiActionJobStatus: vi.fn(), getChat: vi.fn(),
  startChatJob: vi.fn(), saveChatComposer: vi.fn(), cancelAiActionJob: vi.fn(),
}))
vi.mock('../tauri', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tauri')>()
  return { ...actual, ...api, commands: { ...actual.commands, decideChatPermission: api.decideChatPermission } }
})

const composer = 'Keep this unsent testing note'
const providerLabels: Record<AiProvider, string> = {
  claude_code: 'Claude Code', codex_cli: 'Codex', copilot_cli: 'GitHub Copilot',
}
function pending(provider: AiProvider) {
  return chatJobFixture({ progressMessage: 'Waiting for tool permission', pendingPermission: {
    requestId: 'permission-recovery-token', provider, title: 'Read the test fixture?',
    toolName: 'read_resource', serverName: 'qa-mcp', inputJson: '{"resource":"test-plan"}',
  } })
}

const instances: ReturnType<typeof createSessionChatActions>[] = []
async function mountControllerView(provider: AiProvider) {
  let snapshot: ChatSnapshot = emptyChatSnapshot
  let repaint: (() => void) | null = null
  const refreshProviderStatus = vi.fn().mockResolvedValue(undefined)
  // These are the external capabilities consumed by the real Chat factory for
  // permission recovery. Unused Note/Session editing capabilities stay absent.
  const ctx = {
    session: { activeSessionIdRef: { current: 'session-1' } },
    selection: { selectedProvider: provider, selectedModel: 'test-model', selectedReasoningEffort: null },
    provider: { available: true }, providerWarning: null, refreshProviderStatus,
    noteRecovery: { isRetired: () => false, has: () => false, hasPending: () => false },
    feedback: { setError: vi.fn(), setNotice: vi.fn() },
    publish: (value: ChatSnapshot | ((previous: ChatSnapshot) => ChatSnapshot)) => {
      snapshot = typeof value === 'function' ? value(snapshot) : value
      repaint?.()
    },
  } as unknown as SessionChatContext
  const actions = createSessionChatActions(ctx)
  instances.push(actions)
  function props(): SessionChatViewProps {
    return {
      ...snapshot, providerLabel: providerLabels[provider], modelLabel: 'test-model',
      providerAvailable: true, providerReason: '', onConfigureAi: vi.fn(),
      onSetComposer: actions.onSetComposer, onSend: actions.onSend, onRetry: actions.onRetry,
      onCancel: actions.onCancel, onSubmit: actions.onSubmit, onRestart: actions.onRestart,
      onDecidePermission: actions.onDecidePermission, onRecheck: actions.onRecheck,
    }
  }
  const view = render(<SessionChatView {...props()} />)
  repaint = () => view.rerender(<SessionChatView {...props()} />)
  await act(async () => {
    actions.activate('session-1')
    actions.observeJob(pending(provider))
  })
  return { refreshProviderStatus, get snapshot() { return snapshot } }
}

describe('controller-to-view permission recovery (F4retry2, R57-01)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetAllMocks()
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer }))
  })
  afterEach(() => {
    for (const actions of instances) actions.dispose()
    instances.length = 0
    cleanup()
    vi.useRealTimers()
  })

  it.each((['claude_code', 'codex_cli', 'copilot_cli'] as const).flatMap((provider) =>
    (['untouched', 'edited', 'autosaved'] as const).map((draftState) => [provider, draftState] as const)))(
    'recovers the suppressed %s token with an %s composer without replaying a decision',
    async (provider, draftState) => {
      const canonical = pending(provider)
      api.decideChatPermission.mockRejectedValueOnce(new Error('Permission transport lost'))
        .mockResolvedValueOnce(chatJobFixture({ pendingPermission: null }))
      api.getAiActionJobStatus.mockRejectedValueOnce(new Error('JobStore temporarily unreachable'))
        .mockResolvedValue(canonical)
      const h = await mountControllerView(provider)
      const payload = { jobId: canonical.jobId, sessionId: canonical.sessionId,
        requestId: canonical.pendingPermission!.requestId, provider }
      const panel = () => screen.getByRole('region', { name: 'Tool permission' })
      expect(within(panel()).getByText('Read the test fixture?')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(composer)

      // Both failures occur through the actual view callback and controller.
      await act(async () => { fireEvent.click(within(panel()).getByRole('button', { name: 'Approve once' })) })
      expect(api.decideChatPermission).toHaveBeenCalledExactlyOnceWith({ ...payload, decision: 'approve' })
      expect(api.getAiActionJobStatus).toHaveBeenCalledExactlyOnceWith(canonical.jobId)
      expect(screen.getByRole('alert')).toHaveTextContent('Permission transport lost')
      expect(screen.queryByRole('region', { name: 'Tool permission' })).not.toBeInTheDocument()
      expect(h.snapshot.permissionWorking).toBe(false)

      // The normal polling path receives the original canonical token, but
      // cannot turn an ambiguous decision failure into implicit permission replay.
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(api.getAiActionJobStatus).toHaveBeenCalledTimes(2)
      expect(api.getAiActionJobStatus).toHaveBeenLastCalledWith(canonical.jobId)
      expect(h.snapshot.job?.state).toBe('running')
      expect(h.snapshot.working).toBe(true)
      expect(h.snapshot.job?.pendingPermission).toBeFalsy()
      expect(screen.queryByRole('region', { name: 'Tool permission' })).not.toBeInTheDocument()
      expect(screen.getByRole('alert')).toHaveTextContent('Permission transport lost')
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel response' })).toBeEnabled()
      expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
      expect(api.startChatJob).not.toHaveBeenCalled()
      expect(api.saveChatComposer).not.toHaveBeenCalled()
      expect(h.refreshProviderStatus).not.toHaveBeenCalled()

      let authoredComposer = composer
      if (draftState !== 'untouched') {
        authoredComposer = 'New authored testing context after the lost response'
        api.saveChatComposer.mockResolvedValue(chatFixture({ mode: 'chat', composer: authoredComposer, revision: 1 }))
        await act(async () => { fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: authoredComposer } }) })
        expect(h.snapshot.error).toBeNull()
        if (draftState === 'autosaved') {
          await act(async () => { await vi.advanceTimersByTimeAsync(500) })
          expect(api.saveChatComposer).toHaveBeenCalledTimes(1)
          expect(h.snapshot.dirty).toBe(false)
          api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: authoredComposer, revision: 1 }))
        }
        expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(authoredComposer)
        expect(screen.queryByRole('region', { name: 'Tool permission' })).not.toBeInTheDocument()
      }

      // R57-01: busy/running must not make the only recovery route unreachable.
      // Do not bypass this button by manually calling the controller's recheck.
      const recheck = screen.getByRole('button', { name: 'Recheck status' })
      expect(recheck).toBeEnabled()
      recheck.focus()
      expect(recheck).toHaveFocus()
      await act(async () => { fireEvent.click(recheck) })
      expect(api.getAiActionJobStatus).toHaveBeenCalledTimes(3)
      expect(api.getChat).toHaveBeenCalledTimes(2)
      expect(h.refreshProviderStatus).toHaveBeenCalledTimes(1)
      expect(h.snapshot.job?.pendingPermission).toEqual(canonical.pendingPermission)
      expect(within(panel()).getByRole('button', { name: 'Approve once' })).toBeEnabled()
      expect(within(panel()).getByRole('button', { name: 'Deny' })).toBeEnabled()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(api.decideChatPermission).toHaveBeenCalledTimes(1)
      expect(api.startChatJob).not.toHaveBeenCalled()

      // Only a NEW explicit decision, with unchanged job/Session/token/provider
      // identity, may resume the permission exchange after authoritative recovery.
      await act(async () => { fireEvent.click(within(panel()).getByRole('button', { name: 'Deny' })) })
      expect(api.decideChatPermission).toHaveBeenCalledTimes(2)
      expect(api.decideChatPermission).toHaveBeenLastCalledWith({ ...payload, decision: 'deny' })
      expect(screen.queryByRole('region', { name: 'Tool permission' })).not.toBeInTheDocument()
      expect(h.snapshot.job?.pendingPermission).toBeFalsy()
      expect(api.getAiActionJobStatus).toHaveBeenCalledTimes(3)
      expect(api.startChatJob).not.toHaveBeenCalled()
      expect(api.saveChatComposer).toHaveBeenCalledTimes(draftState === 'autosaved' ? 1 : 0)
      expect(h.snapshot.composer).toBe(authoredComposer)
      expect(h.snapshot.chat?.composer).toBe(draftState === 'autosaved' ? authoredComposer : composer)
      expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(authoredComposer)
    },
  )
})
