import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartChatJobResult } from '../bindings'
import { providerStatusFixture, settingsFixture } from '../test/fixtures'
import { chatFixture, chatJobFixture, completedChatFixture } from './useSessionChat.testSupport'
import {
  cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController,
} from './useAppController.testHarness'

const api = getTauriMock()

function startedTurn(): StartChatJobResult {
  return {
    jobId: 'job-chat', turnId: 'turn-1', status: chatJobFixture(),
    chat: chatFixture({ revision: 2, mode: 'chat', messages: [{
      id: 'message-user', turnId: 'turn-1', role: 'user', text: 'What should I capture?', images: [],
      status: 'running', errorMessage: null, aiRunId: 'run-chat', createdAt: '2026-10-14T10:00:00Z',
    }] }),
  }
}

async function hydrateReadyChat(result: { current: ReturnType<typeof useAppController> }) {
  // Boot schedules provider loading in a later timer. Flush React effects
  // between clock ticks, rather than treating advance(0) as app readiness.
  for (let tick = 0; tick < 20; tick += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    if (result.current.activeProvider?.available
      && !result.current.sessionChat.loading
      && result.current.sessionChat.chat?.draftId === 'chat-1'
      && result.current.sessionChat.composer === 'What should I capture?') break
  }
  expect(result.current.activeProvider?.available).toBe(true)
  expect(result.current.sessionChat.loading).toBe(false)
  expect(result.current.sessionChat.chat?.draftId).toBe('chat-1')
  expect(result.current.sessionChat.composer).toBe('What should I capture?')
}

describe('app-owned Session Chat turn lifecycle', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('drains composer persistence before sending with the current app AI selection', async () => {
    api.getSettings.mockResolvedValue(settingsFixture({
      selectedAiReasoningEffortsByProvider: { claude_code: null, codex_cli: 'medium', copilot_cli: null },
    }))
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat' }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.draftId).toBe('chat-1'))
    const saving = deferred<ReturnType<typeof chatFixture>>()
    api.saveChatComposer.mockReturnValueOnce(saving.promise)
    api.startChatJob.mockResolvedValue(startedTurn())
    act(() => result.current.sessionChat.onSetComposer('What should I capture?'))
    let send!: Promise<void>
    act(() => { send = result.current.sessionChat.onSend() })
    await waitFor(() => expect(api.saveChatComposer).toHaveBeenCalledTimes(1))
    expect(api.startChatJob).not.toHaveBeenCalled()
    await act(async () => {
      saving.resolve(chatFixture({ revision: 1, mode: 'chat', composer: 'What should I capture?' }))
      await send
    })
    expect(api.startChatJob).toHaveBeenCalledWith(expect.objectContaining({
      scope: { sessionId: 'session-1', draftId: 'chat-1', expectedRevision: 1 },
      provider: result.current.selectedProvider, model: result.current.selectedModel,
      reasoningEffort: 'medium',
    }), expect.any(Function))
    expect(result.current.sessionChat.working).toBe(true)
    expect(result.current.sessionChat.composer).toBe('')
    expect(api.startAiActionJob).not.toHaveBeenCalled()
    expect(api.updateEntry).not.toHaveBeenCalled()
  })

  it('does not send when composer persistence fails', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.sessionId).toBe('session-1'))
    api.saveChatComposer.mockRejectedValue(new Error('Disk unavailable'))
    act(() => result.current.sessionChat.onSetComposer('Keep this'))
    await act(async () => { await result.current.sessionChat.onSend() })
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(result.current.sessionChat.composer).toBe('Keep this')
    expect(result.current.sessionChat.error).toContain('Disk unavailable')
  })

  it('uses provider readiness instead of bypassing the unavailable CLI', async () => {
    const status = providerStatusFixture()
    status.providers[0] = { ...status.providers[0], available: false, status: 'installRequired', reason: 'CLI is not installed' }
    api.getProviderStatus.mockResolvedValue(status)
    api.refreshProviderStatus.mockResolvedValue(status)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.sessionId).toBe('session-1'))
    await waitFor(() => expect(result.current.activeProvider?.available).toBe(false))
    act(() => result.current.sessionChat.onSetComposer('Question'))
    await act(async () => { await result.current.sessionChat.onSend() })
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(result.current.sessionChat.composer).toBe('Question')
    expect(result.current.sessionChat.error).toBeTruthy()
  })

  it('coalesces duplicate sends and retains input typed while start is pending', async () => {
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'What should I capture?' }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composer).toBe('What should I capture?'))
    const start = deferred<StartChatJobResult>()
    api.startChatJob.mockReturnValueOnce(start.promise)
    let send!: Promise<void>
    act(() => { send = result.current.sessionChat.onSend() })
    await waitFor(() => expect(api.startChatJob).toHaveBeenCalledTimes(1))
    await act(async () => { await result.current.sessionChat.onSend() })
    act(() => result.current.sessionChat.onSetComposer('Next follow-up'))
    await act(async () => { start.resolve(startedTurn()); await send })
    expect(api.startChatJob).toHaveBeenCalledTimes(1)
    expect(result.current.sessionChat.composer).toBe('Next follow-up')
  })

  it('recovers a running chat by polling without generation finalizers or automatic retry', async () => {
    vi.useFakeTimers()
    api.listActiveAiActionJobs.mockResolvedValue([chatJobFixture()])
    api.getChat.mockResolvedValue(startedTurn().chat)
    api.getAiActionJobStatus.mockResolvedValue(chatJobFixture({ state: 'completed', partialText: 'Which build?' }))
    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.sessionChat.job?.jobId).toBe('job-chat')
    expect(result.current.sessionChat.working).toBe(true)
    expect(result.current.activeTestwareJob).toBeNull()
    api.getChat.mockResolvedValue(completedChatFixture())
    api.openSessionNoteState.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(api.getAiActionJobStatus).toHaveBeenCalledWith('job-chat')
    expect(result.current.sessionChat.working).toBe(false)
    expect(result.current.sessionChat.chat?.messages[1]?.text).toBe('Which build?')
    expect(result.current.notice).not.toBe('Generation finished')
    expect(api.openSessionNoteState).not.toHaveBeenCalled()
    expect(api.updateEntry).not.toHaveBeenCalled()
    expect(api.startAiActionJob).not.toHaveBeenCalled()
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(result.current.testwareDraftCount).toBe(0)
  })

  it('polls a newly started turn when its Channel no longer delivers events', async () => {
    vi.useFakeTimers()
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'What should I capture?' }))
    api.startChatJob.mockResolvedValue(startedTurn())
    const { result } = renderHook(() => useAppController())
    await hydrateReadyChat(result)
    await act(async () => { await result.current.sessionChat.onSend() })
    expect(api.startChatJob).toHaveBeenCalledTimes(1)
    expect(result.current.sessionChat.error).toBeNull()
    expect(result.current.sessionChat.job?.jobId).toBe('job-chat')
    expect(result.current.sessionChat.working).toBe(true)
    api.getAiActionJobStatus.mockResolvedValue(chatJobFixture({ state: 'completed' }))
    api.getChat.mockResolvedValue(completedChatFixture())
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(api.getAiActionJobStatus).toHaveBeenCalledWith('job-chat')
    expect(result.current.sessionChat.working).toBe(false)
    expect(result.current.sessionChat.chat?.messages).toHaveLength(2)
  })

  it('cancels the active chat job and explicitly retries its unresolved turn', async () => {
    api.listActiveAiActionJobs.mockResolvedValue([chatJobFixture()])
    api.getChat.mockResolvedValue(startedTurn().chat)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.job?.jobId).toBe('job-chat'))
    api.cancelAiActionJob.mockResolvedValue(chatJobFixture({ state: 'cancelled' }))
    const cancelled = chatFixture({ revision: 3, mode: 'chat', messages: startedTurn().chat.messages.map(
      (message) => ({ ...message, status: 'cancelled' as const }),
    ) })
    api.getChat.mockResolvedValue(cancelled)
    await act(async () => { await result.current.sessionChat.onCancel() })
    expect(api.cancelAiActionJob).toHaveBeenCalledWith('job-chat')
    await waitFor(() => expect(result.current.sessionChat.working).toBe(false))
    expect(api.startChatJob).not.toHaveBeenCalled()
    api.startChatJob.mockResolvedValue(startedTurn())
    await act(async () => { await result.current.sessionChat.onRetry() })
    expect(api.startChatJob).toHaveBeenCalledWith(expect.objectContaining({
      scope: { sessionId: 'session-1', draftId: 'chat-1', expectedRevision: 3 }, retry: true,
    }), expect.any(Function))
  })

  it('starts a new conversation explicitly after submission, without generating Testware', async () => {
    api.getChat.mockResolvedValue(completedChatFixture({ submission: {
      draftId: 'chat-1', noteId: 'entry-1', submittedAt: '2026-10-14T10:00:00Z',
    } }))
    api.restartChat.mockResolvedValue(chatFixture({ draftId: 'chat-2', mode: 'chat' }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.submission?.draftId).toBe('chat-1'))
    await act(async () => { await result.current.sessionChat.onRestart() })
    expect(api.restartChat).toHaveBeenCalledWith({ scope: {
      sessionId: 'session-1', draftId: 'chat-1', expectedRevision: 3,
    } })
    expect(result.current.sessionChat.chat?.draftId).toBe('chat-2')
    expect(result.current.sessionChat.composer).toBe('')
    expect(result.current.sessionMode).toBe('chat')
    expect(api.updateEntry).not.toHaveBeenCalled()
    expect(api.startAiActionJob).not.toHaveBeenCalled()
  })

  it('requires explicit retry instead of sending a new user message over an unresolved latest turn', async () => {
    const failed = completedChatFixture()
    failed.messages = failed.messages.map((message) => ({ ...message, status: 'failed' }))
    api.getChat.mockResolvedValue(failed)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(3))
    act(() => result.current.sessionChat.onSetComposer('A different question'))
    await act(async () => { await result.current.sessionChat.onSend() })
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(result.current.sessionChat.error).toContain('Retry that turn explicitly')
    expect(result.current.sessionChat.composer).toBe('A different question')
  })

  it('explains that an earlier failed turn requires a new conversation', async () => {
    const earlier = completedChatFixture()
    earlier.messages[0].status = 'failed'
    earlier.messages.push({ ...earlier.messages[1], id: 'message-3', turnId: 'later-turn' })
    api.getChat.mockResolvedValue(earlier)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.error).toContain('Start a new conversation'))
    await act(async () => { await result.current.sessionChat.onRetry() })
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(result.current.sessionChat.error).toContain('earlier turn')
  })

  it('preserves already-dirty composer input across terminal-job hydration', async () => {
    vi.useFakeTimers()
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'What should I capture?' }))
    api.startChatJob.mockResolvedValue(startedTurn())
    const { result } = renderHook(() => useAppController())
    await hydrateReadyChat(result)
    await act(async () => { await result.current.sessionChat.onSend() })
    expect(api.startChatJob).toHaveBeenCalledTimes(1)
    expect(result.current.sessionChat.error).toBeNull()
    expect(result.current.sessionChat.job?.jobId).toBe('job-chat')
    expect(result.current.sessionChat.working).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    act(() => result.current.sessionChat.onSetComposer('Follow-up still being typed'))
    api.getAiActionJobStatus.mockResolvedValue(chatJobFixture({ state: 'completed' }))
    api.getChat.mockResolvedValue(completedChatFixture())
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(api.getAiActionJobStatus).toHaveBeenCalledWith('job-chat')
    expect(result.current.sessionChat.working).toBe(false)
    expect(result.current.sessionChat.composer).toBe('Follow-up still being typed')
    expect(result.current.sessionChat.chat?.messages).toHaveLength(2)
  })
})
