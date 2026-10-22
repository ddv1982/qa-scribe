import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { draftFixture, entryFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController Draft and Finding autosave', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('flushes dirty Draft and Finding edits before switching to another note', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        testwareDraftCount: 1,
        findingCount: 1,
      }),
    )
    tauriMock.listDrafts.mockResolvedValueOnce([draftFixture({ id: 'draft-dirty', sessionId: 'session-1', body: '<p>Persisted draft.</p>' })])
    tauriMock.listFindings.mockResolvedValueOnce([findingFixture({ id: 'finding-dirty', sessionId: 'session-1', body: '<p>Persisted finding.</p>' })])

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-dirty']))
    act(() => {
      result.current.setActiveView('findings')
    })
    await waitFor(() => expect(result.current.findings.map((finding) => finding.id)).toEqual(['finding-dirty']))

    act(() => {
      result.current.updateLocalDraft('draft-dirty', { body: '<p>Unsaved draft edit.</p>' })
      result.current.updateLocalFinding('finding-dirty', { body: '<p>Unsaved finding edit.</p>' })
    })

    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        session: otherSession,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }),
    )

    await act(async () => {
      await result.current.openSession(otherSession)
    })

    expect(tauriMock.updateDraft).toHaveBeenCalledWith('draft-dirty', expect.objectContaining({ body: '<p>Unsaved draft edit.</p>' }))
    expect(tauriMock.updateFinding).toHaveBeenCalledWith('finding-dirty', expect.objectContaining({ body: '<p>Unsaved finding edit.</p>' }))
    expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-2')
    expect(result.current.activeSession?.id).toBe('session-2')
  })

  it('retries a Draft edit made while a forced record save is in flight and cancels that navigation', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({ testwareDraftCount: 1 }),
    )
    tauriMock.listDrafts.mockResolvedValueOnce([
      draftFixture({ id: 'draft-dirty', sessionId: 'session-1', body: '<p>Persisted draft.</p>' }),
    ])
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-dirty']))
    act(() => result.current.updateLocalDraft('draft-dirty', { body: '<p>First draft edit.</p>' }))

    const firstSave = deferred<ReturnType<typeof draftFixture>>()
    tauriMock.updateDraft
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce(draftFixture({ id: 'draft-dirty', body: '<p>Latest draft edit.</p>' }))
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        session: otherSession,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }),
    )

    let openPromise!: Promise<void>
    act(() => { openPromise = result.current.openSession(otherSession) })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledTimes(1))
    act(() => {
      result.current.updateLocalDraft('draft-dirty', { body: '<p>Latest draft edit.</p>' })
      firstSave.resolve(draftFixture({ id: 'draft-dirty', body: '<p>First draft edit.</p>' }))
    })

    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledTimes(2))
    expect(tauriMock.updateDraft).toHaveBeenLastCalledWith(
      'draft-dirty',
      expect.objectContaining({ body: '<p>Latest draft edit.</p>' }),
    )
    await act(async () => openPromise)
    expect(result.current.activeSession?.id).toBe('session-1')

    await act(async () => { await result.current.openSession(otherSession) })
    expect(result.current.activeSession?.id).toBe('session-2')
  })

  it('retries a Finding edit made while a forced record save is in flight and cancels that navigation', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({ findingCount: 1 }),
    )
    tauriMock.listFindings.mockResolvedValueOnce([
      findingFixture({ id: 'finding-dirty', sessionId: 'session-1', body: '<p>Persisted finding.</p>' }),
    ])
    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings.map((finding) => finding.id)).toEqual(['finding-dirty']))
    act(() => result.current.updateLocalFinding('finding-dirty', { body: '<p>First finding edit.</p>' }))

    const firstSave = deferred<ReturnType<typeof findingFixture>>()
    tauriMock.updateFinding
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce(findingFixture({ id: 'finding-dirty', body: '<p>Latest finding edit.</p>' }))
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        session: otherSession,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }),
    )

    let openPromise!: Promise<void>
    act(() => { openPromise = result.current.openSession(otherSession) })
    await waitFor(() => expect(tauriMock.updateFinding).toHaveBeenCalledTimes(1))
    act(() => {
      result.current.updateLocalFinding('finding-dirty', { body: '<p>Latest finding edit.</p>' })
      firstSave.resolve(findingFixture({ id: 'finding-dirty', body: '<p>First finding edit.</p>' }))
    })

    await waitFor(() => expect(tauriMock.updateFinding).toHaveBeenCalledTimes(2))
    expect(tauriMock.updateFinding).toHaveBeenLastCalledWith(
      'finding-dirty',
      expect.objectContaining({ body: '<p>Latest finding edit.</p>' }),
    )
    await act(async () => openPromise)
    expect(result.current.activeSession?.id).toBe('session-1')

    await act(async () => { await result.current.openSession(otherSession) })
    expect(result.current.activeSession?.id).toBe('session-2')
  })

  it('does not switch sessions when a dirty record flush fails', async () => {
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        testwareDraftCount: 1,
      }),
    )
    tauriMock.listDrafts.mockResolvedValueOnce([draftFixture({ id: 'draft-dirty', sessionId: 'session-1' })])

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-dirty']))

    act(() => {
      result.current.updateLocalDraft('draft-dirty', { body: '<p>Flush will fail.</p>' })
    })
    tauriMock.updateDraft.mockRejectedValueOnce(new Error('offline'))

    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })
    await act(async () => {
      await result.current.openSession(otherSession)
    })

    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.error).toBeTruthy()
  })

  it.each(['save', 'discard', 'cancel'] as const)('settles %s before opening a created record in the same collection', async (choice) => {
    let stored = draftFixture({ id: 'existing', body: '<p>Saved original.</p>' })
    const created = draftFixture({ id: 'returned-created', title: 'Untitled test case', body: '<p></p>' })
    tauriMock.listDrafts.mockResolvedValueOnce([stored]).mockResolvedValue([stored, created])
    tauriMock.createDraft.mockResolvedValueOnce(created)
    tauriMock.updateDraft.mockImplementationOnce(async (_id, patch) => {
      stored = { ...stored, ...patch }
      return stored
    })
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts.map((record) => record.id)).toEqual(['existing']))
    act(() => result.current.updateLocalDraft('existing', { body: '<p>Authored edit.</p>' }))
    await act(async () => { await result.current.handleManualTestware() })
    expect(result.current.pendingNavigationView).toBe('testware')
    expect(result.current.createdRecordEditTarget).toBeNull()
    expect(result.current.testwareDrafts.find((record) => record.id === 'existing')?.body).toBe('<p>Authored edit.</p>')
    await act(async () => {
      if (choice === 'save') await result.current.savePendingNavigationChanges()
      else if (choice === 'discard') await result.current.discardPendingNavigationChanges()
      else result.current.cancelPendingNavigation()
    })
    expect(result.current.pendingNavigationView).toBeNull()
    expect(stored.body).toBe(choice === 'save' ? '<p>Authored edit.</p>' : '<p>Saved original.</p>')
    expect(result.current.testwareDrafts.find((record) => record.id === 'existing')?.body)
      .toBe(choice === 'discard' ? '<p>Saved original.</p>' : '<p>Authored edit.</p>')
    expect(result.current.createdRecordEditTarget).toEqual(choice === 'cancel' ? null
      : { sessionId: 'session-1', kind: 'testware', recordId: 'returned-created' })
    expect(result.current.testwareDrafts.map((record) => record.id)).toContain('returned-created')
    expect(tauriMock.deleteDraft).not.toHaveBeenCalled()
  })

  it('rechecks the creation epoch inside the actual delayed Save continuation', async () => {
    const original = draftFixture({ id: 'existing', body: '<p>Saved original.</p>' })
    const created = draftFixture({ id: 'returned-created' })
    const saved = deferred<ReturnType<typeof draftFixture>>()
    tauriMock.listDrafts.mockResolvedValueOnce([original]).mockResolvedValue([original, created])
    tauriMock.createDraft.mockResolvedValueOnce(created)
    tauriMock.updateDraft.mockReturnValueOnce(saved.promise)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([original]))
    act(() => result.current.updateLocalDraft('existing', { body: '<p>Authored edit.</p>' }))
    await act(async () => { await result.current.handleManualTestware() })
    let continuation!: Promise<void>
    act(() => { continuation = result.current.savePendingNavigationChanges() })
    await waitFor(() => expect(tauriMock.updateDraft).toHaveBeenCalledOnce())
    act(() => result.current.setActiveView('testware'))
    await act(async () => { saved.resolve({ ...original, body: '<p>Authored edit.</p>' }); await continuation })
    expect(result.current.pendingNavigationView).toBeNull()
    expect(result.current.createdRecordEditTarget).toBeNull()
    expect(result.current.testwareDrafts.find((record) => record.id === 'existing')?.body).toBe('<p>Authored edit.</p>')
  })

  it('expires an unavailable target when ordinary same-view preview navigation supersedes it', async () => {
    const created = draftFixture({ id: 'not-hydrated-yet' })
    tauriMock.createDraft.mockResolvedValueOnce(created)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    await act(async () => { await result.current.handleManualTestware() })
    expect(result.current.createdRecordEditTarget?.recordId).toBe('not-hydrated-yet')
    act(() => result.current.setActiveView('testware'))
    tauriMock.listDrafts.mockResolvedValueOnce([created])
    await act(async () => { await result.current.loadDraftsForSession('session-1', { force: true }) })
    expect(result.current.testwareDrafts.map((record) => record.id)).toEqual(['not-hydrated-yet'])
    expect(result.current.createdRecordEditTarget).toBeNull()
  })

})
