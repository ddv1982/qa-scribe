import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppSettings } from '../bindings'
import { entryFixture, generationStatusFixture, settingsFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, getTauriWindowMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
beforeEach(() => {
  setupControllerTest()
  api.updateSettings.mockImplementation(async (settings: AppSettings) => settings)
})
afterEach(cleanupControllerTest)

async function ready() {
  const rendered = renderHook(() => useAppController())
  await waitFor(() => expect(rendered.result.current.activeProvider?.available).toBe(true))
  await waitFor(() => expect(rendered.result.current.noteIsReady).toBe(true))
  return rendered
}

it('captures Chat selection before awaiting the composer save', async () => {
  api.getChat.mockResolvedValue(chatFixture({ mode: 'chat' }))
  const { result } = await ready()
  await waitFor(() => expect(result.current.sessionChat.chat?.draftId).toBe('chat-1'))
  const saved = deferred<ReturnType<typeof chatFixture>>()
  api.saveChatComposer.mockReturnValueOnce(saved.promise)
  api.startChatJob.mockResolvedValue({ jobId: 'job-chat', turnId: 'turn-1', status: chatJobFixture(), chat: chatFixture({ revision: 2, mode: 'chat' }) })
  act(() => result.current.sessionChat.onSetComposer('Question'))
  let sending = Promise.resolve()
  act(() => { sending = result.current.sessionChat.onSend() })
  await waitFor(() => expect(api.saveChatComposer).toHaveBeenCalledTimes(1))
  await act(async () => { await result.current.persistModelChoice('codex_cli', 'next-model') })
  await act(async () => { saved.resolve(chatFixture({ revision: 1, composer: 'Question', mode: 'chat' })); await sending })
  expect(api.startChatJob).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex_cli', model: 'default', reasoningEffort: null }), expect.any(Function))
  expect(result.current.selectedModel).toBe('next-model')
})

it('captures generation selection before awaiting Note persistence', async () => {
  const { result } = await ready()
  const saved = deferred<ReturnType<typeof entryFixture>>()
  api.updateEntry.mockReturnValueOnce(saved.promise)
  api.startAiActionJob.mockResolvedValue({ jobId: 'job-1', status: generationStatusFixture() })
  act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Unsaved before generation')))
  let generating = Promise.resolve()
  act(() => { generating = result.current.handleAiAction('testware') })
  await waitFor(() => expect(api.updateEntry).toHaveBeenCalled())
  await act(async () => { await result.current.persistModelChoice('codex_cli', 'next-model') })
  await act(async () => { saved.resolve(entryFixture({ body: '<p>Unsaved before generation</p>' })); await generating })
  expect(api.startAiActionJob).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex_cli', model: 'default', reasoningEffort: null }), expect.any(Function))
})

it('blocks Send, Generate, and desktop close while a clean quick preference write is pending', async () => {
  const { result } = await ready()
  const saved = deferred<AppSettings>()
  api.updateSettings.mockReturnValueOnce(saved.promise)
  let quick = Promise.resolve(false)
  act(() => { quick = result.current.persistModelChoice('codex_cli', 'pending-model') })
  act(() => result.current.sessionChat.onSetComposer('Question'))
  await act(async () => { await result.current.sessionChat.onSend(); await result.current.handleAiAction('testware') })
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.startAiActionJob).not.toHaveBeenCalled()
  const desktop = getTauriWindowMock()
  await act(async () => { await desktop.closeRequestedHandler()?.({ preventDefault: vi.fn() }) })
  expect(desktop.currentWindow.destroy).not.toHaveBeenCalled()
  saved.resolve(settingsFixture({ selectedAiModel: 'pending-model', selectedAiModelsByProvider: { claude_code: null, codex_cli: 'pending-model', copilot_cli: null } }))
  await act(async () => { await quick })
})
