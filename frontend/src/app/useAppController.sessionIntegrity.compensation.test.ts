import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { draftFixture, entryFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToPlainText } from '../editor/editorDocument'
import {
  cleanupControllerTest,
  deferred,
  getTauriMock,
  getTauriWindowMock,
  sessionNoteStateFixture,
  setupControllerTest,
  useAppController,
} from './useAppController.testHarness'

const tauriMock = getTauriMock()
const tauriWindowMock = getTauriWindowMock()

describe('useAppController Session integrity', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('restores the saved backend title when discard supersedes an in-flight title save', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const staleSave = deferred<ReturnType<typeof sessionFixture>>()
    tauriMock.updateSession.mockReturnValueOnce(staleSave.promise)

    act(() => result.current.setSessionTitle('Stale renamed Session'))
    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.updateSession).toHaveBeenCalledTimes(1))
    await act(async () => { await result.current.discardPendingSessionEdits() })

    await act(async () => {
      staleSave.resolve(sessionFixture({ title: 'Stale renamed Session' }))
      await savePromise
    })

    expect(tauriMock.updateSession).toHaveBeenCalledTimes(2)
    expect(tauriMock.updateSession).toHaveBeenLastCalledWith('session-1', { title: 'Checkout session' })
    expect(result.current.sessionTitle).toBe('Checkout session')
    expect(result.current.sessionSaveState).toBe('saved')
  })

  it('restores dirty title state when stale-write compensation rejects', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const staleSave = deferred<ReturnType<typeof sessionFixture>>()
    tauriMock.updateSession
      .mockReturnValueOnce(staleSave.promise)
      .mockRejectedValueOnce(new Error('title compensation offline'))

    act(() => result.current.setSessionTitle('Stale renamed Session'))
    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.updateSession).toHaveBeenCalledTimes(1))
    await act(async () => { await result.current.discardPendingSessionEdits() })
    await act(async () => {
      staleSave.resolve(sessionFixture({ title: 'Stale renamed Session' }))
      await savePromise
    })

    expect(result.current.sessionTitle).toBe('Checkout session')
    expect(result.current.sessionSaveState).toBe('unsaved')
    expect(result.current.error).toContain('title compensation offline')
    await act(async () => { expect(await result.current.saveNoteNow()).toBe(true) })
    expect(result.current.sessionSaveState).toBe('saved')
  })

  it('restores dirty Note state when stale-write compensation rejects', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const staleSave = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry
      .mockReturnValueOnce(staleSave.promise)
      .mockRejectedValueOnce(new Error('Note compensation offline'))

    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Stale Note edit')))
    let savePromise!: Promise<boolean>
    act(() => { savePromise = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1))
    await act(async () => { await result.current.discardPendingSessionEdits() })
    await act(async () => {
      staleSave.resolve(entryFixture({ body: '<p>Stale Note edit</p>' }))
      await savePromise
    })

    expect(result.current.sessionSaveState).toBe('unsaved')
    expect(result.current.error).toContain('Note compensation offline')
    await act(async () => { expect(await result.current.saveNoteNow()).toBe(true) })
    expect(result.current.sessionSaveState).toBe('saved')
  })

  it('restores the newest saved title when an older response lands after navigation', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const olderSave = deferred<ReturnType<typeof sessionFixture>>()
    tauriMock.updateSession
      .mockReturnValueOnce(olderSave.promise)
      .mockResolvedValueOnce(sessionFixture({ title: 'Newest saved title' }))
      .mockResolvedValueOnce(sessionFixture({ title: 'Newest saved title' }))

    act(() => result.current.setSessionTitle('Older title'))
    let olderPromise!: Promise<boolean>
    act(() => { olderPromise = result.current.saveTitle('Older title') })
    await waitFor(() => expect(tauriMock.updateSession).toHaveBeenCalledTimes(1))
    act(() => result.current.setSessionTitle('Newest saved title'))
    await act(async () => { expect(await result.current.saveTitle('Newest saved title')).toBe(true) })

    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Session Two' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({
      session: sessionTwo,
      noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
    }))
    await act(async () => { await result.current.openSession(sessionTwo) })
    await act(async () => {
      olderSave.resolve(sessionFixture({ title: 'Older title' }))
      await olderPromise
    })

    expect(result.current.activeSession?.id).toBe('session-2')
    expect(tauriMock.updateSession).toHaveBeenLastCalledWith('session-1', { title: 'Newest saved title' })
    expect(result.current.sessions.find((session) => session.id === 'session-1')?.title).toBe('Newest saved title')
  })

  it('retries failed inactive-Session title compensation before opening that Session', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const olderSave = deferred<ReturnType<typeof sessionFixture>>()
    tauriMock.updateSession
      .mockReturnValueOnce(olderSave.promise)
      .mockResolvedValueOnce(sessionFixture({ title: 'Newest saved title' }))
      .mockRejectedValueOnce(new Error('inactive compensation offline'))
      .mockResolvedValueOnce(sessionFixture({ title: 'Newest saved title' }))

    act(() => result.current.setSessionTitle('Older title'))
    let olderPromise!: Promise<boolean>
    act(() => { olderPromise = result.current.saveTitle('Older title') })
    await waitFor(() => expect(tauriMock.updateSession).toHaveBeenCalledTimes(1))
    act(() => result.current.setSessionTitle('Newest saved title'))
    await act(async () => { await result.current.saveTitle('Newest saved title') })

    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Session Two' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({
      session: sessionTwo,
      noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
    }))
    await act(async () => { await result.current.openSession(sessionTwo) })
    await act(async () => {
      olderSave.resolve(sessionFixture({ title: 'Older title' }))
      await olderPromise
    })
    expect(result.current.error).toContain('inactive compensation offline')

    const sessionOne = sessionFixture({ title: 'Older title' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ session: sessionFixture({ title: 'Newest saved title' }) }))
    await act(async () => { await result.current.openSession(sessionOne) })

    expect(tauriMock.updateSession).toHaveBeenLastCalledWith('session-1', { title: 'Newest saved title' })
    expect(tauriMock.updateSession).toHaveBeenCalledTimes(4)
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.sessionTitle).toBe('Newest saved title')
  })

  it('retries failed inactive-Session Note compensation before opening that Session', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const sessionOne = result.current.activeSession!
    const olderWrite = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.updateEntry
      .mockReturnValueOnce(olderWrite.promise)
      .mockResolvedValueOnce(entryFixture({ body: '<p>Newest Note body</p>' }))
      .mockRejectedValueOnce(new Error('inactive Note compensation offline'))
      .mockRejectedValueOnce(new Error('active Session save offline'))
      .mockResolvedValueOnce(entryFixture({ body: '<p>Newest Note body</p>' }))
      .mockResolvedValueOnce(entryFixture({ id: 'entry-2', sessionId: 'session-2', body: '<p>Unsaved Session Two</p>' }))

    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Older Note body')))
    let olderPromise!: Promise<boolean>
    act(() => { olderPromise = result.current.saveNoteNow() })
    await waitFor(() => expect(tauriMock.updateEntry).toHaveBeenCalledTimes(1))
    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Newest Note body')))
    await act(async () => { expect(await result.current.saveNoteNow()).toBe(true) })

    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Session Two' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({
      session: sessionTwo,
      noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
    }))
    await act(async () => { await result.current.openSession(sessionTwo) })
    await act(async () => {
      olderWrite.resolve(entryFixture({ body: '<p>Older Note body</p>' }))
      await olderPromise
    })
    expect(result.current.activeSession?.id).toBe('session-2')
    expect(result.current.error).toContain('inactive Note compensation offline')

    act(() => result.current.setNoteBody(richEditorDocumentFromPlainText('Unsaved Session Two')))
    const closeEvent = { preventDefault: vi.fn() }
    await act(async () => { await tauriWindowMock.closeRequestedHandler()?.(closeEvent) })
    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(5)
    expect(tauriMock.updateEntry).toHaveBeenNthCalledWith(
      5,
      'entry-1',
      expect.objectContaining({ body: '<p>Newest Note body</p>' }),
    )
    expect(tauriWindowMock.currentWindow.destroy).not.toHaveBeenCalled()

    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({
      session: sessionOne,
      noteEntry: entryFixture({ body: '<p>Newest Note body</p>' }),
    }))
    await act(async () => { await result.current.openSession(sessionOne) })

    expect(tauriMock.updateEntry).toHaveBeenCalledTimes(6)
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Newest Note body')
  })

  it('keeps failed inactive Record compensation out of the current workspace and retries it on reopen', async () => {
    const draft = draftFixture({ id: 'draft-1', sessionId: 'session-1', body: '<p>Saved Draft</p>' })
    const finding = findingFixture({ id: 'finding-1', sessionId: 'session-1', body: '<p>Saved Finding</p>' })
    tauriMock.listDrafts.mockResolvedValueOnce([draft])
    tauriMock.listFindings.mockResolvedValueOnce([finding])
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const sessionOne = result.current.activeSession!
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([draft]))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([finding]))

    act(() => {
      result.current.updateLocalDraft(draft.id, { body: '<p>Older Draft</p>' })
      result.current.updateLocalFinding(finding.id, { body: '<p>Older Finding</p>' })
    })
    const olderDraftWrite = deferred<ReturnType<typeof draftFixture>>()
    const olderFindingWrite = deferred<ReturnType<typeof findingFixture>>()
    tauriMock.updateDraft
      .mockReturnValueOnce(olderDraftWrite.promise)
      .mockResolvedValueOnce(draftFixture({ id: draft.id, body: '<p>Newest Draft</p>' }))
      .mockRejectedValueOnce(new Error('inactive Draft compensation offline'))
      .mockRejectedValueOnce(new Error('close Draft retry offline'))
      .mockResolvedValueOnce(draftFixture({ id: draft.id, body: '<p>Newest Draft</p>' }))
    tauriMock.updateFinding
      .mockReturnValueOnce(olderFindingWrite.promise)
      .mockResolvedValueOnce(findingFixture({ id: finding.id, body: '<p>Newest Finding</p>' }))
      .mockRejectedValueOnce(new Error('inactive Finding compensation offline'))
      .mockRejectedValueOnce(new Error('close Finding retry offline'))
      .mockResolvedValueOnce(findingFixture({ id: finding.id, body: '<p>Newest Finding</p>' }))

    let olderDraftPromise!: Promise<boolean>
    let olderFindingPromise!: Promise<boolean>
    act(() => {
      olderDraftPromise = result.current.handleSaveDraft(result.current.testwareDrafts[0])
      olderFindingPromise = result.current.handleSaveFinding(result.current.findings[0])
    })
    await waitFor(() => {
      expect(tauriMock.updateDraft).toHaveBeenCalledTimes(1)
      expect(tauriMock.updateFinding).toHaveBeenCalledTimes(1)
    })
    act(() => {
      result.current.updateLocalDraft(draft.id, { body: '<p>Newest Draft</p>' })
      result.current.updateLocalFinding(finding.id, { body: '<p>Newest Finding</p>' })
    })
    await act(async () => {
      expect(await result.current.handleSaveDraft(result.current.testwareDrafts[0])).toBe(true)
      expect(await result.current.handleSaveFinding(result.current.findings[0])).toBe(true)
    })

    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Session Two' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({
      session: sessionTwo,
      noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
    }))
    await act(async () => { await result.current.openSession(sessionTwo) })
    await act(async () => {
      olderDraftWrite.resolve(draftFixture({ id: draft.id, body: '<p>Older Draft</p>' }))
      olderFindingWrite.resolve(findingFixture({ id: finding.id, body: '<p>Older Finding</p>' }))
      await Promise.all([olderDraftPromise, olderFindingPromise])
    })

    expect(result.current.activeSession?.id).toBe('session-2')
    expect(result.current.testwareDrafts).toEqual([])
    expect(result.current.findings).toEqual([])

    const closeEvent = { preventDefault: vi.fn() }
    await act(async () => { await tauriWindowMock.closeRequestedHandler()?.(closeEvent) })
    expect(closeEvent.preventDefault).toHaveBeenCalled()
    expect(tauriMock.updateDraft).toHaveBeenCalledTimes(4)
    expect(tauriMock.updateFinding).toHaveBeenCalledTimes(4)
    expect(tauriWindowMock.currentWindow.destroy).not.toHaveBeenCalled()

    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({
      session: sessionOne,
      testwareDraftCount: 1,
      findingCount: 1,
    }))
    await act(async () => { await result.current.openSession(sessionOne) })

    expect(tauriMock.updateDraft).toHaveBeenCalledTimes(5)
    expect(tauriMock.updateFinding).toHaveBeenCalledTimes(5)
    expect(tauriMock.updateDraft).toHaveBeenLastCalledWith(
      draft.id,
      expect.objectContaining({ body: '<p>Newest Draft</p>' }),
    )
    expect(tauriMock.updateFinding).toHaveBeenLastCalledWith(
      finding.id,
      expect.objectContaining({ body: '<p>Newest Finding</p>' }),
    )
    expect(result.current.activeSession?.id).toBe('session-1')
  })
})
