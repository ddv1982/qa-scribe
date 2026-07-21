import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, generationStatusFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText } from '../editor/editorDocument'
import { cleanupControllerTest, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController autosave with recovered Summary jobs', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('blocks ambient and forced stale Note saves while a recovered Summary is unresolved', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-summary', action: 'summary', state: 'running' }),
    )
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({ noteEntry: entryFixture({ body: '<p>Stale Note.</p>' }) }),
    )

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Dirty stale edit')))

    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(tauriMock.updateEntry).not.toHaveBeenCalled()

    let forcedSave = true
    await act(async () => { forcedSave = await result.current.saveNoteNow() })
    expect(forcedSave).toBe(false)

    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })
    await act(async () => { await result.current.openSession(otherSession) })
    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(tauriMock.updateEntry).not.toHaveBeenCalled()
  })

  it('flushes a blocked ambient save after all recovered Summary jobs fail or cancel', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-failed', action: 'summary', state: 'running' }),
      generationStatusFixture({ jobId: 'job-cancelled', action: 'summary', state: 'running' }),
    ])
    let cancelledJobPolls = 0
    tauriMock.getAiActionJobStatus.mockImplementation(async (jobId: string) => {
      if (jobId === 'job-failed') {
        return generationStatusFixture({ jobId, action: 'summary', state: 'failed', errorMessage: 'Generation failed' })
      }
      cancelledJobPolls += 1
      return generationStatusFixture({
        jobId,
        action: 'summary',
        state: cancelledJobPolls === 1 ? 'running' : 'cancelled',
      })
    })

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Edit waiting for both jobs')))

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    let saved = true
    await act(async () => { saved = await result.current.saveNoteNow() })
    expect(saved).toBe(false)
    expect(tauriMock.updateEntry).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('Edit waiting for both jobs') }),
    )
  })

  it('does not block Note saves for a different Session or a recovered non-Summary job', async () => {
    vi.useFakeTimers()
    tauriMock.listActiveAiActionJobs.mockResolvedValue([
      generationStatusFixture({ jobId: 'job-other-summary', sessionId: 'session-2', action: 'summary', state: 'running' }),
      generationStatusFixture({ jobId: 'job-testware', sessionId: 'session-1', action: 'testware', state: 'running' }),
    ])
    tauriMock.getAiActionJobStatus.mockResolvedValue(
      generationStatusFixture({ jobId: 'job-testware', action: 'testware', state: 'running' }),
    )

    const { result } = renderHook(() => useAppController())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Session one remains saveable')))

    let saved = false
    await act(async () => { saved = await result.current.saveNoteNow() })
    expect(saved).toBe(true)
    expect(tauriMock.updateEntry).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ body: expect.stringContaining('Session one remains saveable') }),
    )
  })
})
