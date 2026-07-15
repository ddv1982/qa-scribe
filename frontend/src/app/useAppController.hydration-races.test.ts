import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { draftFixture, entryFixture, sessionFixture } from '../test/fixtures'
import {
  cleanupControllerTest,
  deferred,
  getTauriMock,
  sessionNoteStateFixture,
  setupControllerTest,
  useAppController,
} from './useAppController.testHarness'

const tauriMock = getTauriMock()

describe('useAppController record hydration races', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('ignores an old Session Draft load that resolves while another Session is opening', async () => {
    const pendingDrafts = deferred<ReturnType<typeof draftFixture>[]>()
    const pendingOpen = deferred<ReturnType<typeof sessionNoteStateFixture>>()
    const otherSession = sessionFixture({ id: 'session-2', title: 'Other session' })
    tauriMock.listDrafts.mockReturnValueOnce(pendingDrafts.promise)
    tauriMock.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture()).mockReturnValueOnce(pendingOpen.promise)

    const { result } = renderHook(() => useAppController())

    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => {
      result.current.setActiveView('testware')
    })
    await waitFor(() => expect(tauriMock.listDrafts).toHaveBeenCalledWith('session-1'))

    let openPromise!: Promise<void>
    act(() => {
      openPromise = result.current.openSession(otherSession)
    })
    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-2'))

    await act(async () => {
      pendingDrafts.resolve([draftFixture({ id: 'draft-from-session-1', sessionId: 'session-1' })])
      await pendingDrafts.promise
    })
    expect(result.current.testwareDrafts).toEqual([])

    await act(async () => {
      pendingOpen.resolve(
        sessionNoteStateFixture({
          session: otherSession,
          noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }),
        }),
      )
      await openPromise
    })

    expect(result.current.activeSession?.id).toBe('session-2')
    expect(result.current.testwareDrafts).toEqual([])
  })

  it('ignores a stale Draft load rejection after a newer same-Session load succeeds', async () => {
    let rejectStaleLoad: (cause: Error) => void = () => {}
    const staleLoad = new Promise<ReturnType<typeof draftFixture>[]>((_resolve, reject) => {
      rejectStaleLoad = reject
    })
    tauriMock.listDrafts
      .mockReturnValueOnce(staleLoad)
      .mockResolvedValueOnce([draftFixture({ id: 'draft-current', sessionId: 'session-1' })])

    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeSession?.id).toBe('session-1'))
    act(() => result.current.setActiveView('testware'))
    await waitFor(() => expect(tauriMock.listDrafts).toHaveBeenCalledTimes(1))

    await act(async () => {
      await result.current.loadDraftsForSession('session-1', { force: true })
    })
    expect(result.current.testwareDrafts.map((draft) => draft.id)).toEqual(['draft-current'])
    expect(result.current.draftLoadState).toBe('ready')

    await act(async () => {
      rejectStaleLoad(new Error('stale request failed'))
      await staleLoad.catch(() => undefined)
    })

    expect(result.current.draftLoadError).toBeNull()
    expect(result.current.draftLoadState).toBe('ready')
  })
})
