import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generationStatusFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import {
  cleanupControllerTest,
  getTauriMock,
  getTauriWindowMock,
  setupControllerTest,
  useAppController,
} from './useAppController.testHarness'

const tauriMock = getTauriMock()
const tauriWindowMock = getTauriWindowMock()

describe('useAppController Session integrity', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('keeps a blank title pending across autosave, Session navigation, and beforeunload', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    act(() => result.current.setSessionTitle('   '))
    expect(result.current.sessionTitleValidationError).toBe('Session title is required.')
    expect(result.current.sessionSaveState).toBe('invalid')
    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(tauriMock.updateSession).not.toHaveBeenCalled()

    const unload = new Event('beforeunload', { cancelable: true })
    await act(async () => {
      window.dispatchEvent(unload)
      await Promise.resolve()
    })
    expect(unload.defaultPrevented).toBe(true)

    const otherSession = sessionFixture({ id: 'session-2', title: 'Other Session' })
    await act(async () => { await result.current.openSession(otherSession) })
    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.sessionTitle).toBe('   ')
  })

  it('stops startup discovery after its bounded retry budget without hydrating a Note', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockRejectedValue(new Error('Discovery unavailable'))
    const { result } = renderHook(() => useAppController())

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(tauriMock.listActiveAiActionJobs).toHaveBeenCalledTimes(3)
    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalled()
    expect(result.current.activeSession).toBeNull()
    expect(result.current.error).toContain('Discovery unavailable')

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(tauriMock.listActiveAiActionJobs).toHaveBeenCalledTimes(3)

    await act(async () => { await result.current.handleLoadSessionLibrary() })
    expect(result.current.sessions).toHaveLength(1)
    await act(async () => { await result.current.openSession(result.current.sessions[0]) })
    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalled()
    expect(result.current.activeSession).toBeNull()
    expect(result.current.error).toContain('Restart QA Scribe')

    await act(async () => { await result.current.handleNewSession() })
    expect(tauriMock.createSession).not.toHaveBeenCalled()
    expect(result.current.noteEntry).toBeNull()
  })

  it('stops repeated recovered-job status errors and leaves dirty Note saves protected', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockRejectedValue(new Error('Status unavailable'))
    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Dirty while status is unknown')))
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(tauriMock.getAiActionJobStatus).toHaveBeenCalledTimes(3)
    expect(await result.current.saveNoteNow()).toBe(false)
    expect(tauriMock.updateEntry).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(tauriMock.getAiActionJobStatus).toHaveBeenCalledTimes(3)
  })

  it('prevents native close for an invalid title and restores it on explicit discard', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriWindowMock.closeRequestedHandler()).toBeTruthy())

    act(() => result.current.setSessionTitle(''))
    const closeEvent = { preventDefault: vi.fn() }
    await act(async () => { await tauriWindowMock.closeRequestedHandler()?.(closeEvent) })
    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriWindowMock.currentWindow.destroy).not.toHaveBeenCalled()
    expect(result.current.error).toBe('Session title is required.')

    act(() => result.current.setActiveView('settings'))
    expect(result.current.pendingNavigationView).toBe('settings')
    expect(result.current.activeView).toBe('sessions')
    await act(async () => { await result.current.discardPendingNavigationChanges() })
    expect(result.current.sessionTitle).toBe('Checkout session')
    expect(result.current.sessionSaveState).toBe('saved')
    expect(result.current.activeView).toBe('settings')
  })

  it('keeps a failed title save unsaved until the edit is discarded', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    tauriMock.updateSession.mockRejectedValueOnce(new Error('offline'))

    act(() => result.current.setSessionTitle('Renamed Session'))
    let saved = true
    await act(async () => { saved = await result.current.saveNoteNow() })
    expect(saved).toBe(false)
    expect(result.current.sessionSaveState).toBe('unsaved')
    expect(result.current.error).toContain('offline')

    await act(async () => { await result.current.discardPendingSessionEdits() })
    expect(result.current.sessionTitle).toBe('Checkout session')
    expect(result.current.sessionSaveState).toBe('saved')
  })
})
