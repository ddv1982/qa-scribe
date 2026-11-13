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

import { useTestRuns } from './useTestRuns'

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

  it('shows a result at once, keeps what the store returns and refreshes the counts', async () => {
    const { result } = await opened()
    let resolve!: (value: TestRunCase) => void
    api.setTestCaseResult.mockReturnValue(new Promise((done) => { resolve = done }))
    api.listTestRuns.mockResolvedValue([summary({ failed: 1, notRun: 1 })])
    let saving!: Promise<void>
    act(() => { saving = result.current.setResult('a', 'failed', 'Declined') })
    expect(result.current.open?.run?.cases[0]).toMatchObject({ result: 'failed', remark: 'Declined' })
    expect(api.setTestCaseResult).toHaveBeenCalledWith('a', 'failed', 'Declined')
    await act(async () => { resolve(testCase('a', { result: 'failed', remark: 'Declined', updatedAt: 'later' })); await saving })
    expect(result.current.open?.run?.cases[0].updatedAt).toBe('later')
    await waitFor(() => expect(result.current.summaries[0].failed).toBe(1))
    expect(result.current.error).toBeNull()
  })

  it('rolls a failed save back to what the store last confirmed and says why', async () => {
    const { result } = await opened()
    api.setTestCaseResult.mockResolvedValueOnce(testCase('a', { result: 'passed' }))
    await act(() => result.current.setResult('a', 'passed', null))
    api.setTestCaseResult.mockRejectedValueOnce({ kind: 'internal', message: 'disk full' })
    await act(() => result.current.setResult('a', 'blocked', 'No card'))
    expect(result.current.open?.run?.cases[0]).toMatchObject({ result: 'passed', remark: null })
    expect(result.current.error).toBe('Something went wrong: disk full')
  })

  it('lets only the newest save of a case settle it', async () => {
    const { result } = await opened()
    let failFirst!: (reason: unknown) => void
    api.setTestCaseResult.mockReturnValueOnce(new Promise((_, reject) => { failFirst = reject }))
    api.setTestCaseResult.mockResolvedValueOnce(testCase('a', { result: 'blocked' }))
    let first!: Promise<void>
    act(() => { first = result.current.setResult('a', 'failed', null) })
    await act(() => result.current.setResult('a', 'blocked', null))
    await act(async () => { failFirst(new Error('late')); await first })
    expect(result.current.open?.run?.cases[0].result).toBe('blocked')
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
