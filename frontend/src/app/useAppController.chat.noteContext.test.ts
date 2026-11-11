import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it('saves on-screen Note edits before a Notes send so the AI reads the current Note', async () => {
  api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'Make the setup clearer' }))
  api.startChatJob.mockResolvedValue({ jobId: 'job-chat', turnId: 'turn-1', status: chatJobFixture(),
    chat: chatFixture({ mode: 'chat', revision: 1, messages: [{ id: 'message-1', turnId: 'turn-1', role: 'user',
      text: 'Make the setup clearer', images: [], status: 'running', errorMessage: null, aiRunId: null, createdAt: 'now' }] }) })
  const { result } = renderHook(() => useAppController())
  await waitFor(() => expect(result.current.sessionChat.composer).toBe('Make the setup clearer'))
  await waitFor(() => expect(result.current.activeProvider?.available).toBe(true))
  act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Edited just before asking 6131')))
  await act(async () => { await result.current.sessionChat.onSend() })
  expect(api.startChatJob).toHaveBeenCalledOnce()
  const saved = api.updateEntry.mock.calls.find(call => JSON.stringify(call).includes('Edited just before asking 6131'))
  expect(saved).toBeDefined()
  expect(api.updateEntry.mock.invocationCallOrder[api.updateEntry.mock.calls.indexOf(saved!)]).toBeLessThan(api.startChatJob.mock.invocationCallOrder[0])
})

it('keeps the message and does not ask AI when the on-screen Note cannot be saved', async () => {
  api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'Make the setup clearer' }))
  const { result } = renderHook(() => useAppController())
  await waitFor(() => expect(result.current.sessionChat.composer).toBe('Make the setup clearer'))
  await waitFor(() => expect(result.current.activeProvider?.available).toBe(true))
  api.updateEntry.mockRejectedValue(new Error('disk full'))
  act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Unsaved edit 7720')))
  await act(async () => { await result.current.sessionChat.onSend() })
  await act(async () => { await result.current.sessionChat.onRetry() })
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(result.current.sessionChat.composer).toBe('Make the setup clearer')
  expect(result.current.error).toBeTruthy()
})

it('keeps the specific save error instead of replacing it with the generic reason', async () => {
  api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'Make the setup clearer' }))
  const { result } = renderHook(() => useAppController())
  await waitFor(() => expect(result.current.sessionChat.composer).toBe('Make the setup clearer'))
  await waitFor(() => expect(result.current.activeProvider?.available).toBe(true))
  act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('x'.repeat(100_001))))
  await act(async () => { await result.current.sessionChat.onSend() })
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(result.current.error).toMatch(/too large to autosave/)
})
