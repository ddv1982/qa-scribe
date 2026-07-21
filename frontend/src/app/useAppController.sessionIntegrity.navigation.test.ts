import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { draftFixture, entryFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToPlainText } from '../editor/editorDocument'
import {
  cleanupControllerTest,
  deferred,
  getTauriMock,
  sessionNoteStateFixture,
  setupControllerTest,
  useAppController,
} from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController Session integrity', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('lets only the latest reversed Session-open response update workspace and busy state', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Session Two' })
    const sessionThree = sessionFixture({ id: 'session-3', title: 'Session Three' })
    const openTwo = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    const openThree = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    tauriMock.openSessionNoteState.mockImplementation((sessionId: string) => (
      sessionId === 'session-2' ? openTwo.promise : openThree.promise
    ))

    let firstOpen!: Promise<void>
    let latestOpen!: Promise<void>
    act(() => { firstOpen = result.current.openSession(sessionTwo) })
    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-2'))
    act(() => { latestOpen = result.current.openSession(sessionThree) })
    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-3'))

    await act(async () => {
      openThree.resolve(sessionNoteStateFixture({
        session: sessionThree,
        noteEntry: entryFixture({ id: 'entry-3', sessionId: 'session-3' }),
      }))
      await latestOpen
    })
    expect(result.current.activeSession?.id).toBe('session-3')
    expect(result.current.busyAction).toBeNull()

    await act(async () => {
      openTwo.resolve(sessionNoteStateFixture({
        session: sessionTwo,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }))
      await firstOpen
    })
    expect(result.current.activeSession?.id).toBe('session-3')
    expect(result.current.noteEntry?.id).toBe('entry-3')
  })

  it('lets reselecting the active Session cancel a pending Session open', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const activeSession = result.current.activeSession!
    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Session Two' })
    const openTwo = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    tauriMock.openSessionNoteState.mockReturnValueOnce(openTwo.promise)

    let pendingOpen!: Promise<void>
    act(() => { pendingOpen = result.current.openSessionInCurrentView(sessionTwo) })
    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-2'))
    expect(result.current.busyAction).toBe('open-session')

    await act(async () => { await result.current.openSessionInCurrentView(activeSession) })
    expect(result.current.busyAction).toBeNull()

    await act(async () => {
      openTwo.resolve(sessionNoteStateFixture({
        session: sessionTwo,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }))
      await pendingOpen
    })

    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.noteEntry?.id).toBe('entry-1')
  })

  it('does not let a stale open release the latest operation busy state', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const sessionTwo = sessionFixture({ id: 'session-2' })
    const sessionThree = sessionFixture({ id: 'session-3' })
    const openTwo = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    const openThree = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    tauriMock.openSessionNoteState.mockImplementation((sessionId: string) => (
      sessionId === 'session-2' ? openTwo.promise : openThree.promise
    ))

    let firstOpen!: Promise<void>
    let latestOpen!: Promise<void>
    act(() => { firstOpen = result.current.openSession(sessionTwo) })
    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-2'))
    act(() => { latestOpen = result.current.openSession(sessionThree) })
    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-3'))

    await act(async () => {
      openTwo.resolve(sessionNoteStateFixture({ session: sessionTwo }))
      await firstOpen
    })
    expect(result.current.busyAction).toBe('open-session')
    expect(result.current.activeSession?.id).toBe('session-1')

    await act(async () => {
      openThree.resolve(sessionNoteStateFixture({ session: sessionThree }))
      await latestOpen
    })
    expect(result.current.busyAction).toBeNull()
    expect(result.current.activeSession?.id).toBe('session-3')
  })

  it('lets an immediate library intent cancel an async open and release its busy state', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Slow Session' })
    const slowOpen = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    tauriMock.openSessionNoteState.mockReturnValueOnce(slowOpen.promise)

    let openPromise!: Promise<void>
    act(() => { openPromise = result.current.openSession(sessionTwo) })
    await waitFor(() => expect(result.current.busyAction).toBe('open-session'))
    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-2'))

    act(() => result.current.setActiveView('testware-library'))
    expect(result.current.activeView).toBe('testware-library')
    expect(result.current.busyAction).toBeNull()

    await act(async () => {
      slowOpen.resolve(sessionNoteStateFixture({
        session: sessionTwo,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }))
      await openPromise
    })
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.activeView).toBe('testware-library')
    expect(result.current.busyAction).toBeNull()
  })

  it('publishes a created Session but does not replace newer navigation while its Note creation is superseded', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const createdSession = sessionFixture({ id: 'session-new', title: 'Untitled session 2' })
    const noteCreation = deferred<ReturnType<typeof entryFixture>>()
    tauriMock.createSession.mockResolvedValueOnce(createdSession)
    tauriMock.createEntry.mockReturnValueOnce(noteCreation.promise)

    let newSessionPromise!: Promise<void>
    act(() => { newSessionPromise = result.current.handleNewSession() })
    await waitFor(() => expect(tauriMock.createEntry).toHaveBeenCalled())
    expect(result.current.busyAction).toBe('new-session')

    act(() => result.current.setActiveView('testware-library'))
    expect(result.current.busyAction).toBeNull()
    expect(result.current.activeView).toBe('testware-library')
    await act(async () => {
      noteCreation.resolve(entryFixture({ id: 'entry-new', sessionId: 'session-new' }))
      await newSessionPromise
    })

    expect(result.current.sessions.map((session) => session.id)).toContain('session-new')
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.activeView).toBe('testware-library')
    expect(result.current.busyAction).toBeNull()
  })

  it('keeps title and Note edits made while a Session open is awaiting the backend', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Session Two' })
    const delayedOpen = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    tauriMock.openSessionNoteState.mockReturnValueOnce(delayedOpen.promise)

    let openPromise!: Promise<void>
    act(() => { openPromise = result.current.openSession(sessionTwo) })
    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-2'))
    act(() => {
      result.current.setSessionTitle('Authored during open')
      result.current.setNoteBody(richEditorDocumentFromPlainText('Note authored during open'))
    })
    await act(async () => {
      delayedOpen.resolve(sessionNoteStateFixture({
        session: sessionTwo,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }))
      await openPromise
    })

    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.sessionTitle).toBe('Authored during open')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Note authored during open')
    expect(result.current.sessionSaveState).toBe('unsaved')
  })

  it('publishes a durable new Session while preserving edits made during delayed creation', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const delayedCreation = deferred<ReturnType<typeof sessionFixture>>()
    tauriMock.createSession.mockReturnValueOnce(delayedCreation.promise)

    let creationPromise!: Promise<void>
    act(() => { creationPromise = result.current.handleNewSession() })
    await waitFor(() => expect(tauriMock.createSession).toHaveBeenCalledTimes(1))
    act(() => {
      result.current.setSessionTitle('Authored during creation')
      result.current.setNoteBody(richEditorDocumentFromPlainText('Note authored during creation'))
    })
    await act(async () => {
      delayedCreation.resolve(sessionFixture({ id: 'session-new', title: 'Untitled session 2' }))
      await creationPromise
    })

    expect(result.current.sessions.map((session) => session.id)).toContain('session-new')
    expect(tauriMock.createEntry).not.toHaveBeenCalled()
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.sessionTitle).toBe('Authored during creation')
    expect(richEditorDocumentToPlainText(result.current.noteBody)).toBe('Note authored during creation')
    expect(result.current.sessionSaveState).toBe('unsaved')
  })

  it('keeps a Draft edit made while a Session open is awaiting the backend', async () => {
    const draft = draftFixture({ id: 'draft-1', sessionId: 'session-1', body: '<p>Saved draft.</p>' })
    tauriMock.listDrafts.mockResolvedValueOnce([draft])
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(result.current.testwareDrafts).toEqual([draft]))

    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Session Two' })
    const delayedOpen = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    tauriMock.openSessionNoteState.mockReturnValueOnce(delayedOpen.promise)
    let openPromise!: Promise<void>
    act(() => { openPromise = result.current.openSession(sessionTwo) })
    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-2'))

    act(() => result.current.updateLocalDraft(draft.id, { body: '<p>Authored during open.</p>' }))
    await act(async () => {
      delayedOpen.resolve(sessionNoteStateFixture({
        session: sessionTwo,
        noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
      }))
      await openPromise
    })

    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.testwareDrafts[0]?.body).toBe('<p>Authored during open.</p>')
    expect(result.current.busyAction).toBeNull()
  })

  it('publishes a durable new Session while preserving a Finding edit made during delayed creation', async () => {
    const finding = findingFixture({ id: 'finding-1', sessionId: 'session-1', body: '<p>Saved finding.</p>' })
    tauriMock.listFindings.mockResolvedValueOnce([finding])
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('findings'))
    await waitFor(() => expect(result.current.findings).toEqual([finding]))

    const delayedCreation = deferred<ReturnType<typeof sessionFixture>>()
    tauriMock.createSession.mockReturnValueOnce(delayedCreation.promise)
    let creationPromise!: Promise<void>
    act(() => { creationPromise = result.current.handleNewSession() })
    await waitFor(() => expect(tauriMock.createSession).toHaveBeenCalledTimes(1))

    act(() => result.current.updateLocalFinding(finding.id, { body: '<p>Authored during creation.</p>' }))
    await act(async () => {
      delayedCreation.resolve(sessionFixture({ id: 'session-new', title: 'Untitled session 2' }))
      await creationPromise
    })

    expect(result.current.sessions.map((session) => session.id)).toContain('session-new')
    expect(result.current.activeSession?.id).toBe('session-1')
    expect(result.current.findings[0]?.body).toBe('<p>Authored during creation.</p>')
    expect(result.current.busyAction).toBeNull()
  })

  it('cancels an older cross-Session library intent before its reopen resolves', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    const staleReopen = deferred<ReturnType<typeof sessionFixture>>()
    tauriMock.reopenSession.mockReturnValueOnce(staleReopen.promise)
    const sessionThree = sessionFixture({ id: 'session-3', title: 'Latest Session' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({
      session: sessionThree,
      noteEntry: entryFixture({ id: 'entry-3', sessionId: 'session-3' }),
    }))

    let staleIntent!: Promise<void>
    act(() => { staleIntent = result.current.openLibraryRecord('session-2', 'testware', 'draft-2') })
    await waitFor(() => expect(tauriMock.reopenSession).toHaveBeenCalledWith('session-2'))
    await act(async () => { await result.current.openSession(sessionThree) })
    await act(async () => {
      staleReopen.resolve(sessionFixture({ id: 'session-2', title: 'Stale Session' }))
      await staleIntent
    })

    expect(result.current.activeSession?.id).toBe('session-3')
    expect(result.current.focusedRecordId).toBeNull()
    expect(tauriMock.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
  })

  it('keeps the latest output-library result and ignores an older rejection', async () => {
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    let rejectOlderDraftLoad: (cause: Error) => void = () => {}
    const olderDraftLoad = new Promise<never>((_resolve, reject) => { rejectOlderDraftLoad = reject })
    const latestDraftLoad = deferred<Array<{ draft: ReturnType<typeof draftFixture>; sessionTitle: string }>>()
    tauriMock.listDraftLibrary
      .mockReturnValueOnce(olderDraftLoad)
      .mockReturnValueOnce(latestDraftLoad.promise)

    let olderRequest!: Promise<void>
    let latestRequest!: Promise<void>
    act(() => {
      olderRequest = result.current.loadDraftLibrary()
      latestRequest = result.current.loadDraftLibrary()
    })
    await act(async () => {
      latestDraftLoad.resolve([{ draft: draftFixture({ id: 'draft-latest' }), sessionTitle: 'Latest' }])
      await latestRequest
    })
    expect(result.current.draftLibrary.map((item) => item.draft.id)).toEqual(['draft-latest'])
    expect(result.current.draftLibraryState).toBe('ready')

    await act(async () => {
      rejectOlderDraftLoad(new Error('stale failure'))
      await olderRequest
    })
    expect(result.current.draftLibrary.map((item) => item.draft.id)).toEqual(['draft-latest'])
    expect(result.current.draftLibraryError).toBeNull()
    expect(result.current.draftLibraryState).toBe('ready')

    const olderFindingLoad = deferred<Array<{ finding: ReturnType<typeof findingFixture>; sessionTitle: string }>>()
    const latestFindingLoad = deferred<Array<{ finding: ReturnType<typeof findingFixture>; sessionTitle: string }>>()
    tauriMock.listFindingLibrary
      .mockReturnValueOnce(olderFindingLoad.promise)
      .mockReturnValueOnce(latestFindingLoad.promise)
    let olderFindingRequest!: Promise<void>
    let latestFindingRequest!: Promise<void>
    act(() => {
      olderFindingRequest = result.current.loadFindingLibrary()
      latestFindingRequest = result.current.loadFindingLibrary()
    })
    await act(async () => {
      latestFindingLoad.resolve([{ finding: findingFixture({ id: 'finding-latest' }), sessionTitle: 'Latest' }])
      await latestFindingRequest
      olderFindingLoad.resolve([{ finding: findingFixture({ id: 'finding-stale' }), sessionTitle: 'Stale' }])
      await olderFindingRequest
    })
    expect(result.current.findingLibrary.map((item) => item.finding.id)).toEqual(['finding-latest'])
  })
})
