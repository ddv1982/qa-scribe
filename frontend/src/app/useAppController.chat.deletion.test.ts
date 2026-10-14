import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatComposerRequest } from '../bindings'
import { entryFixture, sessionFixture } from '../test/fixtures'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'
import {
  cleanupControllerTest, deferred, getTauriMock, getTauriWindowMock,
  sessionNoteStateFixture, setupControllerTest, useAppController,
} from './useAppController.testHarness'

const api = getTauriMock()
const desktop = getTauriWindowMock()
const next = sessionFixture({ id: 'session-2', title: 'Surviving Session' })

function deletableSession() {
  let deleted = false
  api.deleteSession.mockReset().mockImplementation(async () => { deleted = true; return { pendingFiles: 0 } })
  api.listSessions.mockReset().mockImplementation(async () => deleted ? [next] : [sessionFixture(), next])
  api.openSessionNoteState.mockReset().mockImplementation(async (sessionId: string) => {
    if (deleted && sessionId === 'session-1') throw new Error('Session was deleted')
    return sessionNoteStateFixture({ session: sessionId === next.id ? next : sessionFixture(),
      noteEntry: entryFixture({ id: sessionId === next.id ? 'entry-2' : 'entry-1', sessionId }) })
  })
  api.getChat.mockReset().mockImplementation(async (sessionId: string) => {
    if (deleted && sessionId === 'session-1') throw new Error('Session was deleted')
    return chatFixture({ sessionId, draftId: `chat-${sessionId}` })
  })
  const save = async (request: ChatComposerRequest) => {
    if (deleted && request.scope.sessionId === 'session-1') throw new Error('Session was deleted')
    return chatFixture({ sessionId: request.scope.sessionId, draftId: request.scope.draftId,
      revision: request.scope.expectedRevision + 1, composer: request.composer, mode: request.mode })
  }
  api.saveChatComposer.mockReset().mockImplementation(save)
  return { save }
}

async function confirmSessionDeletion(result: { current: ReturnType<typeof useAppController> }) {
  act(() => result.current.requestDeleteSession())
  await act(async () => { await result.current.confirmDelete() })
}

async function bootWithFakeClock(result: { current: ReturnType<typeof useAppController> }) {
  for (let tick = 0; tick < 20; tick += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    if (result.current.sessionChat.chat?.sessionId === 'session-1') break
  }
  expect(result.current.sessionChat.chat?.sessionId).toBe('session-1')
}

describe('BlockingR37-02: successful Session deletion retires app-owned Chat work', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('retires dirty composer autosave and permits navigation and native close in the surviving Session', async () => {
    deletableSession()
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.sessionId).toBe('session-1'))
    vi.useFakeTimers()
    act(() => result.current.sessionChat.onSetComposer('Discarded only by explicit Session deletion'))
    await confirmSessionDeletion(result)
    expect(result.current.activeSession?.id).toBe(next.id)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(api.saveChatComposer).not.toHaveBeenCalled()
    await act(async () => { expect(await result.current.saveAllPendingChanges()).toBe(true) })
    await act(async () => { result.current.setActiveView('settings') })
    expect(result.current.activeView).toBe('settings')
    act(() => result.current.sessionChat.onSetComposer('Surviving Session question'))
    const close = { preventDefault: vi.fn() }
    await act(async () => { await desktop.closeRequestedHandler()?.(close) })
    expect(close.preventDefault).toHaveBeenCalled()
    expect(desktop.currentWindow.destroy).toHaveBeenCalledTimes(1)
    expect(api.saveChatComposer).toHaveBeenCalledTimes(1)
    expect(api.saveChatComposer).toHaveBeenCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ sessionId: next.id }), composer: 'Surviving Session question',
    }))
  })

  it('ignores an in-flight composer response and does not drain newer deleted-Session intent into another save', async () => {
    deletableSession()
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.sessionId).toBe('session-1'))
    const save = deferred<ReturnType<typeof chatFixture>>()
    api.saveChatComposer.mockReturnValueOnce(save.promise)
    act(() => result.current.sessionChat.onSetComposer('First save'))
    let flush!: Promise<boolean>
    act(() => { flush = result.current.saveAllPendingChanges() })
    await waitFor(() => expect(api.saveChatComposer).toHaveBeenCalledTimes(1))
    act(() => result.current.sessionChat.onSetComposer('Newer deleted intent'))
    await confirmSessionDeletion(result)
    const event = new Event('beforeunload', { cancelable: true })
    act(() => { window.dispatchEvent(event) })
    const closeDuringSave = { preventDefault: vi.fn() }
    let closeAttempt!: Promise<void>
    act(() => { closeAttempt = Promise.resolve(desktop.closeRequestedHandler()?.(closeDuringSave)) })
    await act(async () => {
      save.resolve(chatFixture({ draftId: 'chat-session-1', revision: 1, composer: 'First save' }))
      await flush
      await closeAttempt
    })
    expect(event.defaultPrevented).toBe(false)
    expect(closeDuringSave.preventDefault).not.toHaveBeenCalled()
    expect(api.saveChatComposer).toHaveBeenCalledTimes(1)
    expect(result.current.sessionChat.chat?.sessionId).toBe(next.id)
    expect(result.current.sessionChat.composer).toBe('')
    await act(async () => { expect(await result.current.saveAllPendingChanges()).toBe(true) })
    const close = { preventDefault: vi.fn() }
    await act(async () => { await desktop.closeRequestedHandler()?.(close) })
    expect(close.preventDefault).not.toHaveBeenCalled()
  })

  it('cancels scheduled Chat polling when core Session deletion succeeds', async () => {
    deletableSession()
    vi.useFakeTimers()
    api.listActiveAiActionJobs.mockResolvedValue([chatJobFixture()])
    api.getAiActionJobStatus.mockResolvedValue(chatJobFixture())
    const { result } = renderHook(() => useAppController())
    await bootWithFakeClock(result)
    expect(result.current.sessionChat.job?.jobId).toBe('job-chat')
    await confirmSessionDeletion(result)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(api.getAiActionJobStatus).not.toHaveBeenCalled()
    expect(result.current.sessionChat.job).toBeNull()
  })

  it('ignores a polling response already in flight instead of recreating or rehydrating a deleted workspace', async () => {
    deletableSession()
    vi.useFakeTimers()
    api.listActiveAiActionJobs.mockResolvedValue([chatJobFixture()])
    const status = deferred<ReturnType<typeof chatJobFixture>>()
    api.getAiActionJobStatus.mockReturnValueOnce(status.promise)
    const { result } = renderHook(() => useAppController())
    await bootWithFakeClock(result)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.getAiActionJobStatus).toHaveBeenCalledTimes(1)
    await confirmSessionDeletion(result)
    api.getChat.mockClear()
    await act(async () => {
      status.resolve(chatJobFixture({ state: 'completed' }))
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(api.getChat).not.toHaveBeenCalledWith('session-1')
    expect(api.getAiActionJobStatus).toHaveBeenCalledTimes(1)
    expect(result.current.sessionChat.chat?.sessionId).toBe(next.id)
    await act(async () => { expect(await result.current.saveAllPendingChanges()).toBe(true) })
  })

  it('keeps failed deletion composer intent protected and allows persistence retry', async () => {
    const model = deletableSession()
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.sessionId).toBe('session-1'))
    vi.useFakeTimers()
    act(() => result.current.sessionChat.onSetComposer('Must survive failed deletion'))
    api.deleteSession.mockRejectedValueOnce(new Error('Delete failed'))
    await confirmSessionDeletion(result)
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.sessionChat.composer).toBe('Must survive failed deletion')
    api.saveChatComposer.mockRejectedValue(new Error('Composer disk unavailable'))
    const close = { preventDefault: vi.fn() }
    await act(async () => { await desktop.closeRequestedHandler()?.(close) })
    expect(close.preventDefault).toHaveBeenCalled()
    expect(desktop.currentWindow.destroy).not.toHaveBeenCalled()
    expect(result.current.sessionChat.composer).toBe('Must survive failed deletion')
    api.saveChatComposer.mockImplementation(model.save)
    await act(async () => { expect(await result.current.saveAllPendingChanges()).toBe(true) })
    expect(api.saveChatComposer).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: expect.objectContaining({ sessionId: 'session-1' }), composer: 'Must survive failed deletion',
    }))
  })

  it('retires Chat work immediately after core deletion even if subsequent Session Library refresh fails', async () => {
    deletableSession()
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.sessionId).toBe('session-1'))
    vi.useFakeTimers()
    act(() => result.current.sessionChat.onSetComposer('Retire on durable deletion'))
    api.listSessions.mockRejectedValueOnce(new Error('Library refresh unavailable'))
    await confirmSessionDeletion(result)
    expect(result.current.activeSession).toBeNull()
    expect(result.current.error).toContain('Library refresh unavailable')
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(api.saveChatComposer).not.toHaveBeenCalled()
    await act(async () => { expect(await result.current.saveAllPendingChanges()).toBe(true) })
    const event = new Event('beforeunload', { cancelable: true })
    act(() => { window.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
  })
})
