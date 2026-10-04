import '@testing-library/jest-dom/vitest'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import { AttachmentCleanupWarning } from './AttachmentCleanupWarning'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('Session deletion attachment cleanup feedback', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('opens the startup Session without waiting for cleanup discovery', async () => {
    const initial = deferred<{ pendingFiles: number | null }>()
    tauriMock.retryAttachmentCleanup.mockReturnValueOnce(initial.promise)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(result.current.busyAction).toBeNull())
    await waitFor(() => expect(tauriMock.retryAttachmentCleanup).toHaveBeenCalledTimes(1))
    expect(result.current.attachmentCleanup.status).toBeNull()
    await act(async () => { initial.resolve({ pendingFiles: 2 }); await initial.promise })
    expect(result.current.attachmentCleanup.status).toEqual({ pendingFiles: 2 })
    render(<AttachmentCleanupWarning cleanup={result.current.attachmentCleanup} />)
    expect(screen.getByText('Attachment cleanup pending: 2 files from deleted Sessions.')).toBeInTheDocument()
  })

  it.each([2, null])('clears a deleted Session with pendingFiles=%s even if the follow-up refresh fails', async (pendingFiles) => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(result.current.attachmentCleanup.status).toEqual({ pendingFiles: 0 }))
    tauriMock.deleteSession.mockResolvedValueOnce({ pendingFiles })
    tauriMock.listSessions.mockRejectedValueOnce(new Error('Session refresh unavailable'))

    await act(async () => { await result.current.handleDeleteSession(sessionFixture()) })

    expect(result.current.activeSession).toBeNull()
    expect(result.current.noteEntry).toBeNull()
    expect(result.current.sessions).toEqual([])
    expect(result.current.error).toContain('Session refresh unavailable')
    expect(result.current.attachmentCleanup.status).toEqual({ pendingFiles })
    render(<AttachmentCleanupWarning cleanup={result.current.attachmentCleanup} />)
    expect(screen.getByRole('status', { name: 'Attachment cleanup' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry attachment cleanup' })).toBeEnabled()

    act(() => {
      result.current.setSessionTitle('Edit after deletion')
      result.current.setNoteBody(richEditorDocumentFromPlainText('Edit after deletion'))
    })
    await act(async () => { await result.current.savePendingSessionEdits() })
    expect(tauriMock.updateSession).not.toHaveBeenCalled()
    expect(tauriMock.updateEntry).not.toHaveBeenCalled()
  })

  it('keeps committed deletion cleanup feedback when initial discovery finishes late', async () => {
    const initial = deferred<{ pendingFiles: number | null }>()
    tauriMock.retryAttachmentCleanup.mockReturnValueOnce(initial.promise)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await waitFor(() => expect(tauriMock.retryAttachmentCleanup).toHaveBeenCalledTimes(1))
    tauriMock.deleteSession.mockResolvedValueOnce({ pendingFiles: 1 })
    tauriMock.listSessions.mockResolvedValueOnce([])
    await act(async () => { await result.current.handleDeleteSession(sessionFixture()) })
    await act(async () => { initial.resolve({ pendingFiles: 0 }); await initial.promise })
    expect(result.current.activeSession).toBeNull()
    expect(result.current.notice).toBe('Session deleted')
    expect(result.current.attachmentCleanup.status).toEqual({ pendingFiles: 1 })
    expect(result.current.error).toBeNull()
  })
})
