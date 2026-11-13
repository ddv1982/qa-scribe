import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestRun, TestRunCase, TestRunSummary } from '../tauri'

const api = vi.hoisted(() => ({
  listTestRuns: vi.fn(),
  getTestRun: vi.fn(),
  startTestRun: vi.fn(),
  setTestCaseResult: vi.fn(),
  deleteTestRun: vi.fn(),
}))
vi.mock('../tauri', async (original) => ({ ...await original<typeof import('../tauri')>(), ...api }))

import { BACKGROUND_SAVE_ERROR, forgetDrainingTestRuns, useTestRuns } from './useTestRuns'

const at = '2026-11-13T14:02:00Z'
const testCase = (id: string, patch: Partial<TestRunCase> = {}): TestRunCase => ({
  id, runId: 'run-1', position: 0, groupTitle: null, title: `Case ${id}`, bodyJson: '{}', result: 'not_run', remark: null, findingId: null, findingTitle: null, updatedAt: at, ...patch,
})
const run = (cases = [testCase('a'), testCase('b')]): TestRun => ({ id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, cases })
const summary = (patch: Partial<TestRunSummary> = {}): TestRunSummary => ({
  id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, total: 2, passed: 0, failed: 0, blocked: 0, notRun: 2, ...patch,
})

beforeEach(() => {
  for (const command of Object.values(api)) command.mockReset()
  forgetDrainingTestRuns()
  api.listTestRuns.mockResolvedValue([summary()])
  api.getTestRun.mockResolvedValue(run())
})

// Every mounted hook hears about background saves, so none may outlive its test.
afterEach(cleanup)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

/** Makes every setTestCaseResult wait until the test settles it, oldest first. */
function deferredSaves() {
  const pending: Array<{ caseId: string; result: TestRunCase['result']; remark: string | null } & ReturnType<typeof deferred<TestRunCase>>> = []
  api.setTestCaseResult.mockImplementation((caseId: string, result: TestRunCase['result'], remark: string | null) => {
    const save = { caseId, result, remark, ...deferred<TestRunCase>() }
    pending.push(save)
    return save.promise
  })
  return {
    pending,
    /** Stores the oldest save as it was sent. */
    settle: async (patch: Partial<TestRunCase> = {}) => {
      const save = pending.shift()!
      save.resolve(testCase(save.caseId, { result: save.result, remark: save.remark, ...patch }))
      await save.promise
    },
    fail: async (cause: unknown) => {
      const save = pending.shift()!
      save.reject(cause)
      await save.promise.catch(() => undefined)
    },
  }
}

async function opened() {
  const hook = renderHook(() => useTestRuns('session-1'))
  await waitFor(() => expect(hook.result.current.summaries).toHaveLength(1))
  await act(() => hook.result.current.openRun('run-1', 'draft-1'))
  return hook
}

describe('useTestRuns', () => {
  it('loads the Session test runs and the run it opens', async () => {
    const { result } = await opened()
    expect(api.listTestRuns).toHaveBeenCalledWith('session-1')
    expect(api.getTestRun).toHaveBeenCalledWith('run-1')
    expect(result.current.open).toMatchObject({ runId: 'run-1', draftId: 'draft-1', error: null })
    expect(result.current.open?.run?.cases.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('loads the newest test run of each draft with its cases, and reads them again once a result is stored', async () => {
    const other = { ...run([testCase('c', { result: 'failed' })]), id: 'run-3', draftId: 'draft-2' }
    api.listTestRuns.mockResolvedValue([summary({ id: 'run-3', draftId: 'draft-2' }), summary(), summary({ id: 'run-0' })])
    api.getTestRun.mockImplementation(async (runId: string) => runId === 'run-3' ? other : run())
    const { result } = renderHook(() => useTestRuns('session-1'))
    await waitFor(() => expect(result.current.latestRuns).toHaveLength(2))
    expect(result.current.latestRuns.map(({ id }) => id)).toEqual(['run-3', 'run-1'])
    expect(api.getTestRun.mock.calls.map(([runId]) => runId as string)).toEqual(['run-3', 'run-1'])

    await act(() => result.current.openRun('run-1', 'draft-1'))
    api.setTestCaseResult.mockResolvedValue(testCase('a', { result: 'failed' }))
    api.getTestRun.mockImplementation(async (runId: string) => runId === 'run-3' ? other : run([testCase('a', { result: 'failed' }), testCase('b')]))
    act(() => result.current.changeCase('a', { result: 'failed' }))
    await waitFor(() => expect(result.current.latestRuns[1].cases[0].result).toBe('failed'))
  })

  it('loads nothing without a Session', () => {
    const { result } = renderHook(() => useTestRuns(null))
    expect(api.listTestRuns).not.toHaveBeenCalled()
    expect(result.current.summaries).toEqual([])
  })

  it('shows a change at once, saves the full value and refreshes the counts once the case is stored', async () => {
    const { result } = await opened()
    const saves = deferredSaves()
    api.listTestRuns.mockClear()
    api.listTestRuns.mockResolvedValue([summary({ failed: 1, notRun: 1 })])
    act(() => result.current.changeCase('a', { result: 'failed' }))
    act(() => result.current.changeCase('a', { remark: 'Declined' }))
    expect(result.current.open?.run?.cases[0]).toMatchObject({ result: 'failed', remark: 'Declined' })
    expect(api.setTestCaseResult).toHaveBeenCalledTimes(1)
    expect(api.setTestCaseResult).toHaveBeenCalledWith('a', 'failed', null)
    await act(() => saves.settle())
    expect(api.setTestCaseResult).toHaveBeenCalledTimes(2)
    expect(api.setTestCaseResult).toHaveBeenLastCalledWith('a', 'failed', 'Declined')
    expect(api.listTestRuns).not.toHaveBeenCalled()
    await act(() => saves.settle({ updatedAt: 'later' }))
    expect(result.current.open?.run?.cases[0]).toMatchObject({ result: 'failed', remark: 'Declined', updatedAt: 'later' })
    await waitFor(() => expect(result.current.summaries[0].failed).toBe(1))
    expect(api.listTestRuns).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeNull()
  })

  it('sends a second change of a case only after the first save settles, with the latest value', async () => {
    const { result } = await opened()
    const saves = deferredSaves()
    act(() => result.current.changeCase('a', { result: 'passed' }))
    act(() => result.current.changeCase('a', { result: 'failed' }))
    act(() => result.current.changeCase('a', { result: 'blocked' }))
    expect(saves.pending).toHaveLength(1)
    await act(() => saves.settle())
    expect(saves.pending).toHaveLength(1)
    expect(api.setTestCaseResult.mock.calls.map(([, sent]) => sent as string)).toEqual(['passed', 'blocked'])
    await act(() => saves.settle())
    expect(result.current.open?.run?.cases[0].result).toBe('blocked')
  })

  it('drops queued changes when a save fails and shows the stored value and the error', async () => {
    const { result } = await opened()
    const saves = deferredSaves()
    act(() => result.current.changeCase('a', { result: 'passed' }))
    await act(() => saves.settle())
    act(() => result.current.changeCase('a', { result: 'failed' }))
    act(() => result.current.changeCase('a', { result: 'blocked' }))
    await act(() => saves.fail({ kind: 'internal', message: 'disk full' }))
    expect(api.setTestCaseResult).toHaveBeenCalledTimes(2)
    expect(saves.pending).toHaveLength(0)
    expect(result.current.open?.run?.cases[0]).toMatchObject({ result: 'passed', remark: null })
    expect(result.current.error).toBe('Something went wrong: disk full')
    act(() => result.current.changeCase('a', { result: 'blocked' }))
    expect(result.current.error).toBeNull()
    expect(api.setTestCaseResult).toHaveBeenLastCalledWith('a', 'blocked', null)
  })

  it('saves two cases at the same time', async () => {
    const { result } = await opened()
    const saves = deferredSaves()
    act(() => result.current.changeCase('a', { result: 'passed' }))
    act(() => result.current.changeCase('b', { result: 'failed' }))
    expect(saves.pending.map(({ caseId }) => caseId)).toEqual(['a', 'b'])
  })

  it('stores every change made before leaving the run, in order, then refreshes the counts', async () => {
    const { result } = await opened()
    const saves = deferredSaves()
    api.listTestRuns.mockClear()
    act(() => result.current.changeCase('a', { result: 'passed' }))
    act(() => result.current.changeCase('a', { result: 'failed' }))
    act(() => result.current.close())
    await act(() => saves.settle())
    expect(api.listTestRuns).not.toHaveBeenCalled()
    await act(() => saves.settle())
    expect(api.setTestCaseResult.mock.calls.map(([, sent]) => sent as string)).toEqual(['passed', 'failed'])
    expect(api.listTestRuns).toHaveBeenCalledTimes(1)
    expect(result.current.open).toBeNull()
  })

  it('reads a reopened run only after its pending saves are stored', async () => {
    const { result } = await opened()
    const saves = deferredSaves()
    act(() => result.current.changeCase('a', { result: 'passed' }))
    act(() => result.current.changeCase('a', { result: 'failed' }))
    act(() => result.current.close())
    api.getTestRun.mockClear()
    api.getTestRun.mockResolvedValue(run([testCase('a', { result: 'failed' }), testCase('b')]))
    let reopening!: Promise<void>
    act(() => { reopening = result.current.openRun('run-1', 'draft-1') })
    await act(() => saves.settle())
    expect(api.getTestRun).not.toHaveBeenCalled()
    await act(async () => { await saves.settle(); await reopening })
    // Read by the reopen, and by the refresh of the latest test runs once the save was stored.
    expect(api.getTestRun).toHaveBeenCalledTimes(2)
    expect(result.current.open?.run?.cases[0].result).toBe('failed')
    // One queue for the run: a new change saves at once.
    act(() => result.current.changeCase('a', { result: 'passed' }))
    expect(saves.pending).toHaveLength(1)
  })

  it('still waits for pending saves when the view was left and opened again', async () => {
    const first = renderHook(() => useTestRuns('session-1'))
    await act(() => first.result.current.openRun('run-1', 'draft-1'))
    const saves = deferredSaves()
    act(() => first.result.current.changeCase('a', { result: 'failed' }))
    // Leaving the Test cases tab unmounts the view; its save keeps going.
    first.unmount()
    // No summaries, so the only read of a run below is the reopened one.
    api.listTestRuns.mockResolvedValue([])
    api.getTestRun.mockClear()
    api.getTestRun.mockResolvedValue(run([testCase('a', { result: 'failed' }), testCase('b')]))
    const second = renderHook(() => useTestRuns('session-1'))
    let reopening!: Promise<void>
    act(() => { reopening = second.result.current.openRun('run-1', 'draft-1') })
    await act(async () => { await Promise.resolve() })
    expect(api.getTestRun).not.toHaveBeenCalled()
    await act(async () => { await saves.settle(); await reopening })
    expect(api.getTestRun).toHaveBeenCalledTimes(1)
    expect(second.result.current.open?.run?.cases[0].result).toBe('failed')
  })

  it('tells a view opened meanwhile when a save from the view before it failed, and refreshes its counts', async () => {
    const first = renderHook(() => useTestRuns('session-1'))
    await act(() => first.result.current.openRun('run-1', 'draft-1'))
    const saves = deferredSaves()
    act(() => first.result.current.changeCase('a', { result: 'failed' }))
    first.unmount()
    const second = renderHook(() => useTestRuns('session-1'))
    await waitFor(() => expect(second.result.current.summaries).toHaveLength(1))
    api.listTestRuns.mockClear()
    await act(async () => { await saves.fail(new Error('disk full')); await Promise.resolve() })
    await waitFor(() => expect(second.result.current.error).toBe(BACKGROUND_SAVE_ERROR))
    expect(api.listTestRuns).toHaveBeenCalledWith('session-1')
  })

  it('stores a change that arrives just after its run left the screen', async () => {
    const { result } = await opened()
    const saves = deferredSaves()
    // No summaries, so the only read of a run below is the reopened one.
    api.listTestRuns.mockResolvedValue([])
    // Back detaches the run's queue before React unmounts the remark input, whose cleanup commits.
    act(() => result.current.close())
    act(() => result.current.changeCase('a', { remark: 'Typed, never blurred' }))
    expect(api.setTestCaseResult).toHaveBeenCalledWith('a', 'not_run', 'Typed, never blurred')
    // Reopening waits for it, so the screen shows what is stored.
    api.getTestRun.mockClear()
    let reopening!: Promise<void>
    act(() => { reopening = result.current.openRun('run-1', 'draft-1') })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(api.getTestRun).not.toHaveBeenCalled()
    await act(async () => { await saves.settle(); await reopening })
    expect(api.getTestRun).toHaveBeenCalledTimes(1)
  })

  it('finishes a save across a Session change without showing anything from the old Session', async () => {
    const hook = renderHook(({ session }) => useTestRuns(session), { initialProps: { session: 'session-1' } })
    await act(() => hook.result.current.openRun('run-1', 'draft-1'))
    const saves = deferredSaves()
    act(() => hook.result.current.changeCase('a', { result: 'passed' }))
    api.listTestRuns.mockResolvedValue([])
    hook.rerender({ session: 'session-2' })
    await act(() => saves.fail(new Error('disk full')))
    expect(api.setTestCaseResult).toHaveBeenCalledWith('a', 'passed', null)
    expect(hook.result.current.open).toBeNull()
    expect(hook.result.current.error).toBeNull()
    expect(hook.result.current.summaries).toEqual([])
  })

  it('reports a save that fails after the run was left, in the same Session', async () => {
    const { result } = await opened()
    const saves = deferredSaves()
    act(() => result.current.changeCase('a', { result: 'passed' }))
    act(() => result.current.close())
    await act(() => saves.fail(new Error('disk full')))
    expect(result.current.error).toBe(BACKGROUND_SAVE_ERROR)
  })

  it('deletes a run only after its pending save settled', async () => {
    const { result } = await opened()
    const saves = deferredSaves()
    api.deleteTestRun.mockResolvedValue(undefined)
    act(() => result.current.changeCase('a', { result: 'passed' }))
    let deleting!: Promise<boolean>
    act(() => { deleting = result.current.deleteRun('run-1') })
    await act(() => Promise.resolve())
    expect(api.deleteTestRun).not.toHaveBeenCalled()
    await act(async () => { await saves.settle(); expect(await deleting).toBe(true) })
    expect(api.deleteTestRun).toHaveBeenCalledWith('run-1')
    expect(result.current.open).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('starts a test run, opens it and refreshes the list', async () => {
    const { result } = renderHook(() => useTestRuns('session-1'))
    api.startTestRun.mockResolvedValue(run())
    const cases = [{ groupTitle: null, title: 'Case a', bodyJson: '{}' }]
    await act(() => result.current.start('draft-1', cases))
    expect(api.startTestRun).toHaveBeenCalledWith('draft-1', cases)
    expect(result.current.open).toMatchObject({ runId: 'run-1', draftId: 'draft-1' })
    expect(api.listTestRuns).toHaveBeenCalledTimes(2)
  })

  it('keeps a failed start off screen and reports it', async () => {
    const { result } = renderHook(() => useTestRuns('session-1'))
    api.startTestRun.mockRejectedValue({ kind: 'validation', message: 'Only a Test cases draft can start a test run' })
    await act(() => result.current.start('draft-1', []))
    expect(result.current.open).toBeNull()
    expect(result.current.startError).toBe('Only a Test cases draft can start a test run')
    expect(result.current.starting).toBe(false)
    // The error belongs to that draft; another draft does not show it.
    act(() => result.current.keepForDraft('draft-1'))
    act(() => result.current.keepForDraft('draft-2'))
    expect(result.current.startError).toBeNull()
  })

  it('does not open a started run when the Session changed meanwhile', async () => {
    const started = deferred<TestRun>()
    api.startTestRun.mockReturnValue(started.promise)
    const hook = renderHook(({ session }) => useTestRuns(session), { initialProps: { session: 'session-1' } })
    act(() => { void hook.result.current.start('draft-1', []) })
    hook.rerender({ session: 'session-2' })
    await act(async () => { started.resolve(run()); await started.promise })
    expect(hook.result.current.open).toBeNull()
    expect(hook.result.current.starting).toBe(false)
  })

  it('does not open a started run when another draft was selected meanwhile, not even after selecting back', async () => {
    const started = deferred<TestRun>()
    api.startTestRun.mockReturnValue(started.promise)
    const { result } = renderHook(() => useTestRuns('session-1'))
    act(() => result.current.keepForDraft('draft-1'))
    act(() => { void result.current.start('draft-1', []) })
    act(() => result.current.keepForDraft('draft-2'))
    await act(async () => { started.resolve(run()); await started.promise })
    expect(result.current.open).toBeNull()
    act(() => result.current.keepForDraft('draft-1'))
    expect(result.current.open).toBeNull()
    expect(api.listTestRuns).toHaveBeenCalledTimes(2)
  })

  it('stops showing a start as pending once another draft is selected, and starts again normally', async () => {
    const started = deferred<TestRun>()
    api.startTestRun.mockReturnValueOnce(started.promise)
    const { result } = renderHook(() => useTestRuns('session-1'))
    act(() => result.current.keepForDraft('draft-1'))
    act(() => { void result.current.start('draft-1', []) })
    expect(result.current.starting).toBe(true)
    act(() => result.current.keepForDraft('draft-2'))
    expect(result.current.starting).toBe(false)
    await act(async () => { started.resolve(run()); await started.promise })
    expect(result.current.starting).toBe(false)
    expect(result.current.open).toBeNull()
    api.startTestRun.mockResolvedValueOnce({ ...run(), id: 'run-2', draftId: 'draft-2' })
    await act(() => result.current.start('draft-2', []))
    expect(result.current.open).toMatchObject({ runId: 'run-2', draftId: 'draft-2' })
    expect(result.current.starting).toBe(false)
  })

  it('closes the run when another draft is selected, not when its own draft is', async () => {
    const { result } = await opened()
    act(() => result.current.keepForDraft('draft-1'))
    expect(result.current.open).not.toBeNull()
    act(() => result.current.keepForDraft('draft-2'))
    expect(result.current.open).toBeNull()
  })

  it('deletes the open run, closes it and refreshes the list', async () => {
    const { result } = await opened()
    api.deleteTestRun.mockResolvedValue(undefined)
    api.listTestRuns.mockResolvedValue([])
    let deleted = false
    await act(async () => { deleted = await result.current.deleteRun('run-1') })
    expect(deleted).toBe(true)
    expect(api.deleteTestRun).toHaveBeenCalledWith('run-1')
    expect(result.current.open).toBeNull()
    expect(result.current.summaries).toEqual([])
  })

  it('reports a run that cannot be read', async () => {
    api.getTestRun.mockRejectedValue({ kind: 'not_found', message: 'run-1' })
    const { result } = renderHook(() => useTestRuns('session-1'))
    await act(() => result.current.openRun('run-1', 'draft-1'))
    expect(result.current.open).toMatchObject({ run: null, error: 'Something went wrong: run-1' })
  })
})
