import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TestRun, TestRunCase, TestRunSummary } from '../tauri'

const api = vi.hoisted(() => ({
  listTestRuns: vi.fn(),
  getTestRun: vi.fn(),
  startTestRun: vi.fn(),
  setTestCaseResult: vi.fn(),
  deleteTestRun: vi.fn(),
}))
vi.mock('../tauri', async (original) => ({ ...await original<typeof import('../tauri')>(), ...api }))

import { BACKGROUND_SAVE_ERROR, useTestRuns } from './useTestRuns'

const at = '2026-11-13T14:02:00Z'
const testCase = (id: string, patch: Partial<TestRunCase> = {}): TestRunCase => ({
  id, runId: 'run-1', position: 0, groupTitle: null, title: `Case ${id}`, bodyJson: '{}', result: 'not_run', remark: null, findingId: null, updatedAt: at, ...patch,
})
const run = (cases = [testCase('a'), testCase('b')]): TestRun => ({ id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, cases })
const summary = (patch: Partial<TestRunSummary> = {}): TestRunSummary => ({
  id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, total: 2, passed: 0, failed: 0, blocked: 0, notRun: 2, ...patch,
})

beforeEach(() => {
  for (const command of Object.values(api)) command.mockReset()
  api.listTestRuns.mockResolvedValue([summary()])
  api.getTestRun.mockResolvedValue(run())
})

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
    expect(api.getTestRun).toHaveBeenCalledTimes(1)
    expect(result.current.open?.run?.cases[0].result).toBe('failed')
    // One queue for the run: a new change saves at once.
    act(() => result.current.changeCase('a', { result: 'passed' }))
    expect(saves.pending).toHaveLength(1)
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
