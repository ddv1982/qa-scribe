import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, settingsFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, getTauriWindowMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
const desktop = getTauriWindowMock()

describe('native close settlement after final awaits', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it.each(['settings', 'Chat'] as const)('persists Note edits made during the final %s save before destroying the window', async (lateStep) => {
    const settings = deferred<ReturnType<typeof settingsFixture>>()
    const chat = deferred<ReturnType<typeof chatFixture>>()
    const note = deferred<ReturnType<typeof entryFixture>>()
    const editedBody = '<p>Tester edit during final settlement</p>'
    let durableBody = '<p>Original persisted Note</p>'
    api.updateSettings.mockReturnValue(settings.promise)
    api.saveChatComposer.mockReturnValue(chat.promise)
    api.updateEntry.mockImplementation(async (_id, patch) => {
      const saved = await note.promise
      durableBody = patch.body
      return saved
    })
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.sessionId).toBe('session-1'))
    act(() => result.current.updateSettingsDraft({ testwareTemplate: 'Updated template' }))
    const closeEvent = { preventDefault: vi.fn() }
    let closing!: Promise<void>
    act(() => { closing = Promise.resolve(desktop.closeRequestedHandler()?.(closeEvent)) })
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledOnce())
    if (lateStep === 'Chat') {
      act(() => result.current.sessionChat.onSetComposer('Chat edit during Settings save'))
      await act(async () => { settings.resolve(settingsFixture({ testwareTemplate: 'Updated template' })); await settings.promise })
      await waitFor(() => expect(api.saveChatComposer).toHaveBeenCalledOnce())
    }
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Tester edit during final settlement')))
    await act(async () => {
      if (lateStep === 'settings') settings.resolve(settingsFixture({ testwareTemplate: 'Updated template' }))
      else chat.resolve(chatFixture({ draftId: 'chat-session-1', revision: 1, composer: 'Chat edit during Settings save' }))
      await Promise.resolve()
    })
    await waitFor(() => expect(api.updateEntry.mock.calls.length + desktop.currentWindow.destroy.mock.calls.length).toBeGreaterThan(0))
    expect(desktop.currentWindow.destroy).not.toHaveBeenCalled()
    expect(api.updateEntry).toHaveBeenCalledWith('entry-1', expect.objectContaining({ body: editedBody }))
    await act(async () => { note.resolve(entryFixture({ body: editedBody })); await closing })
    expect(durableBody).toBe(editedBody)
    expect(desktop.currentWindow.destroy).toHaveBeenCalledOnce()
    expect(result.current.sessionSaveState).toBe('saved')
  })
})
