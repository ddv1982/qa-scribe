import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, sessionFixture } from '../test/fixtures'
import { chatFixture } from './useSessionChat.testSupport'
import {
  cleanupControllerTest, deferred, getTauriMock, getTauriWindowMock,
  sessionNoteStateFixture, setupControllerTest, useAppController,
} from './useAppController.testHarness'

const api = getTauriMock()
const desktop = getTauriWindowMock()

describe('app-owned Session Chat persistence', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('hydrates durable mode and composer without writing the Session Note', async () => {
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'Unsaved investigation question' }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composer).toBe('Unsaved investigation question'))
    expect(result.current.sessionMode).toBe('chat')
    expect(result.current.sessionChat.loading).toBe(false)
    expect(api.updateEntry).not.toHaveBeenCalled()
    expect(api.startChatJob).not.toHaveBeenCalled()
  })

  it('does not overwrite input authored while initial hydration is pending', async () => {
    const hydration = deferred<ReturnType<typeof chatFixture>>()
    api.getChat.mockReturnValueOnce(hydration.promise)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(api.getChat).toHaveBeenCalledWith('session-1'))
    act(() => result.current.sessionChat.onSetComposer('Newer tester input'))
    await act(async () => { hydration.resolve(chatFixture({ revision: 4, composer: 'Older disk input' })) })
    expect(result.current.sessionChat.composer).toBe('Newer tester input')
    await act(async () => { await result.current.saveAllPendingChanges() })
    expect(api.saveChatComposer).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { sessionId: 'session-1', draftId: 'chat-1', expectedRevision: 4 },
      composer: 'Newer tester input',
    }))
  })

  it('ignores hydration for a Session that is no longer active', async () => {
    const hydration = deferred<ReturnType<typeof chatFixture>>()
    api.getChat.mockReturnValueOnce(hydration.promise)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(api.getChat).toHaveBeenCalledWith('session-1'))
    const next = sessionFixture({ id: 'session-2' })
    api.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({
      session: next, noteEntry: entryFixture({ id: 'entry-2', sessionId: next.id }),
    }))
    api.getChat.mockResolvedValueOnce(chatFixture({ sessionId: next.id, draftId: 'chat-2', composer: 'Second Session' }))
    await act(async () => { await result.current.openSession(next) })
    await waitFor(() => expect(result.current.sessionChat.composer).toBe('Second Session'))
    await act(async () => { hydration.resolve(chatFixture({ composer: 'Late first Session' })) })
    expect(result.current.activeSession?.id).toBe('session-2')
    expect(result.current.sessionChat.chat?.sessionId).toBe('session-2')
    expect(result.current.sessionChat.composer).toBe('Second Session')
  })

  it('serializes saves and preserves newer input when an older save resolves', async () => {
    api.getChat.mockResolvedValue(chatFixture())
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.draftId).toBe('chat-1'))
    const first = deferred<ReturnType<typeof chatFixture>>()
    api.saveChatComposer.mockReturnValueOnce(first.promise)
    act(() => result.current.sessionChat.onSetComposer('First edit'))
    let flush!: Promise<boolean>
    act(() => { flush = result.current.saveAllPendingChanges() })
    await waitFor(() => expect(api.saveChatComposer).toHaveBeenCalledTimes(1))
    act(() => result.current.sessionChat.onSetComposer('Newer edit'))
    await act(async () => {
      first.resolve(chatFixture({ revision: 1, composer: 'First edit' }))
      await flush
    })
    expect(result.current.sessionChat.composer).toBe('Newer edit')
    expect(api.saveChatComposer).toHaveBeenCalledTimes(2)
    expect(api.saveChatComposer).toHaveBeenLastCalledWith({
      scope: { sessionId: 'session-1', draftId: 'chat-1', expectedRevision: 1 },
      composer: 'Newer edit', mode: 'write_note',
    })
  })

  it('flushes composer before navigating and leaves the source active when persistence fails', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.sessionId).toBe('session-1'))
    act(() => result.current.sessionChat.onSetComposer('Keep this question'))
    api.saveChatComposer.mockRejectedValue(new Error('Disk unavailable'))
    const next = sessionFixture({ id: 'session-2' })
    api.openSessionNoteState.mockClear()
    await act(async () => { await result.current.openSession(next) })
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(api.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
    expect(result.current.sessionChat.composer).toBe('Keep this question')
    const event = new Event('beforeunload', { cancelable: true })
    await act(async () => { window.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
  })

  it('keeps desktop close protected after failed composer saves, then permits a successful retry', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.sessionId).toBe('session-1'))
    await waitFor(() => expect(desktop.closeRequestedHandler()).toBeTruthy())
    act(() => result.current.sessionChat.onSetComposer('Keep on close'))
    api.saveChatComposer.mockRejectedValueOnce(new Error('Disk unavailable'))
    const close = { preventDefault: vi.fn() }
    await act(async () => { await desktop.closeRequestedHandler()?.(close) })
    expect(close.preventDefault).toHaveBeenCalled()
    expect(desktop.currentWindow.destroy).not.toHaveBeenCalled()
    expect(result.current.sessionChat.composer).toBe('Keep on close')
    await act(async () => { await desktop.closeRequestedHandler()?.(close) })
    expect(desktop.currentWindow.destroy).toHaveBeenCalledTimes(1)
    expect(api.saveChatComposer).toHaveBeenLastCalledWith(expect.objectContaining({ composer: 'Keep on close' }))
  })

  it('persists mode selection on editable chat', async () => {
    api.getChat.mockResolvedValue(chatFixture())
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.draftId).toBe('chat-1'))
    await act(async () => { result.current.setSessionMode('chat'); await result.current.saveAllPendingChanges() })
    expect(api.saveChatComposer).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'chat' }))
    expect(result.current.sessionMode).toBe('chat')
  })

  it('allows local mode selection for submitted chat without saving immutable history', async () => {
    api.getChat.mockResolvedValue(chatFixture({ submission: {
      draftId: 'chat-1', noteId: 'entry-1', submittedAt: '2026-10-14T10:00:00Z',
    } }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.submission?.draftId).toBe('chat-1'))
    await act(async () => { result.current.setSessionMode('chat'); await result.current.saveAllPendingChanges() })
    expect(result.current.sessionMode).toBe('chat')
    expect(api.saveChatComposer).not.toHaveBeenCalled()
  })
})
