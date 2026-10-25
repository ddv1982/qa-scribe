import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it('clears failed image bookkeeping when Notes restart is confirmed', async () => {
  const { result } = renderHook(() => useAppController())
  await waitFor(() => expect(result.current.sessionChat.chat?.draftId).toBe('chat-session-1'))
  const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'too-large.png', { type: 'image/png' })
  await act(async () => { await result.current.sessionChat.onAttachImages([oversized]) })
  expect(result.current.sessionChat.imageFailures).toHaveLength(1)
  api.restartChat.mockResolvedValue(chatFixture({ draftId: 'replacement-notes', mode: 'chat' }))
  const confirm = result.current.sessionChat.captureRestart!()
  expect(confirm).not.toBeNull()
  await act(async () => { await confirm!() })
  expect(result.current.sessionChat.chat?.draftId).toBe('replacement-notes')
  expect(result.current.sessionChat.imageFailures).toEqual([])
  await act(async () => { expect(await result.current.conversations.flushInputs()).toBe(true) })
  act(() => result.current.setActiveView('settings'))
  expect(result.current.activeView).toBe('settings')
  expect(result.current.pendingNavigationView).toBeNull()
})

it.each(['onRefresh', 'onRecheck'] as const)('recovers initial Notes loading through %s without switching Sessions', async recovery => {
  api.getChat.mockRejectedValueOnce(new Error('Temporary Notes read failure'))
  const { result } = renderHook(() => useAppController())
  await waitFor(() => expect(result.current.error).toContain('Temporary Notes read failure'))
  expect(result.current.sessionChat.chat).toBeNull()
  expect(result.current.sessionChat.loading).toBe(false)
  expect(result.current.sessionChat.error).toContain('Temporary Notes read failure')
  await act(async () => { await result.current.sessionChat[recovery]?.() })
  expect(result.current.sessionChat.chat?.draftId).toBe('chat-session-1')
  expect(result.current.sessionChat.loading).toBe(false)
  expect(result.current.sessionChat.error).toBeNull()
  expect(result.current.error).toBeNull()
  expect(api.getChat).toHaveBeenCalledTimes(2)
  expect(api.startChatJob).not.toHaveBeenCalled()
})
