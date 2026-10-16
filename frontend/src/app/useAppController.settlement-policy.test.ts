import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { richEditorDocumentFromPlainText, richEditorDocumentToPlainText } from '../editor/editorDocument'
import { cleanupControllerTest, getTauriMock, getTauriWindowMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
const desktop = getTauriWindowMock()

describe('Session settlement consumer policies', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('permits view navigation with dirty Note text while native close settles that same text', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('New tester observation')))
    act(() => result.current.setActiveView('settings'))
    expect(result.current.activeView).toBe('settings')
    expect(result.current.pendingNavigationView).toBeNull()
    expect(result.current.sessionSaveState).toBe('unsaved')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('New tester observation')
    const close = { preventDefault: vi.fn() }
    await act(async () => { await desktop.closeRequestedHandler()?.(close) })
    expect(close.preventDefault).toHaveBeenCalledOnce()
    expect(api.updateEntry).toHaveBeenCalledWith('entry-1', expect.objectContaining({ body: '<p>New tester observation</p>' }))
    expect(desktop.currentWindow.destroy).toHaveBeenCalledOnce()
    expect(result.current.sessionSaveState).toBe('saved')
  })
})
