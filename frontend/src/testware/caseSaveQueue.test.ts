import { describe, expect, it, vi } from 'vitest'
import type { TestRunCase } from '../tauri'
import { CaseSaveQueue, type CaseValue } from './caseSaveQueue'

const testCase = (id: string, patch: Partial<TestRunCase> = {}): TestRunCase => ({
  id, runId: 'run-1', position: 0, groupTitle: null, title: `Case ${id}`, bodyJson: '{}', result: 'not_run', remark: null, findingId: null, findingTitle: null, updatedAt: 'saved', ...patch,
})

type Pending = { caseId: string; value: CaseValue; resolve: (saved: TestRunCase) => void; reject: (cause: unknown) => void }

/** A queue whose saves wait until the test settles them, in the order it chooses. */
function setup(cases = [testCase('a'), testCase('b')]) {
  const pending: Pending[] = []
  const save = vi.fn((caseId: string, value: CaseValue) => new Promise<TestRunCase>((resolve, reject) => { pending.push({ caseId, value, resolve, reject }) }))
  const shown = new Map<string, TestRunCase>()
  const listener = { onShow: vi.fn((next: TestRunCase) => { shown.set(next.id, next) }), onSaved: vi.fn(), onError: vi.fn(), onBackgroundError: vi.fn() }
  const queue = new CaseSaveQueue(cases, save, listener)
  /** Stores the oldest pending save as sent and settles it. */
  const settle = async (patch: Partial<TestRunCase> = {}) => {
    const next = pending.shift()!
    next.resolve(testCase(next.caseId, { ...next.value, ...patch }))
    await Promise.resolve()
  }
  const fail = async () => {
    pending.shift()!.reject(new Error('disk full'))
    await Promise.resolve()
  }
  return { queue, save, pending, shown, listener, settle, fail }
}

describe('CaseSaveQueue', () => {
  it('shows a change at once and saves the full value', () => {
    const { queue, save, shown } = setup([testCase('a', { remark: 'Slow' })])
    queue.change('a', { result: 'passed' })
    expect(shown.get('a')).toMatchObject({ result: 'passed', remark: 'Slow' })
    expect(save).toHaveBeenCalledWith('a', { result: 'passed', remark: 'Slow' })
  })

  it('keeps one save per case in flight and sends only the latest value after it', async () => {
    const { queue, save, pending, shown, listener, settle } = setup()
    queue.change('a', { result: 'passed' })
    queue.change('a', { result: 'failed' })
    queue.change('a', { result: 'blocked' })
    expect(save).toHaveBeenCalledTimes(1)
    expect(shown.get('a')?.result).toBe('blocked')
    await settle()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('a', { result: 'blocked', remark: null })
    // A newer change is still saving: the screen keeps showing it, and nothing counts as saved yet.
    expect(shown.get('a')?.result).toBe('blocked')
    expect(listener.onSaved).not.toHaveBeenCalled()
    await settle({ updatedAt: 'latest' })
    expect(pending).toHaveLength(0)
    expect(shown.get('a')).toMatchObject({ result: 'blocked', updatedAt: 'latest' })
    expect(listener.onSaved).toHaveBeenCalledTimes(1)
  })

  it('merges a remark and a result changed while a save is in flight', async () => {
    const { queue, save, shown, settle } = setup()
    queue.change('a', { remark: 'Card declined' })
    queue.change('a', { result: 'failed' })
    expect(shown.get('a')).toMatchObject({ result: 'failed', remark: 'Card declined' })
    await settle()
    expect(save).toHaveBeenLastCalledWith('a', { result: 'failed', remark: 'Card declined' })
  })

  it('drops queued changes when a save fails, shows the stored value and reports it', async () => {
    const { queue, save, shown, listener, settle, fail } = setup()
    queue.change('a', { result: 'passed' })
    await settle()
    queue.change('a', { result: 'failed' })
    queue.change('a', { remark: 'Declined' })
    await fail()
    expect(save).toHaveBeenCalledTimes(2)
    expect(shown.get('a')).toMatchObject({ result: 'passed', remark: null })
    expect(listener.onError).toHaveBeenCalledWith('a', expect.any(Error))
    queue.change('a', { result: 'blocked' })
    expect(save).toHaveBeenLastCalledWith('a', { result: 'blocked', remark: null })
  })

  it('saves different cases at the same time', () => {
    const { queue, save } = setup()
    queue.change('a', { result: 'passed' })
    queue.change('b', { result: 'failed' })
    expect(save.mock.calls.map(([caseId]) => caseId)).toEqual(['a', 'b'])
  })

  it('keeps a remark when the result is cleared, and saves it with the cleared result', async () => {
    const { queue, save, shown, settle } = setup([testCase('a', { result: 'failed', remark: 'Declined' })])
    queue.change('a', { result: 'not_run' })
    expect(shown.get('a')).toMatchObject({ result: 'not_run', remark: 'Declined' })
    expect(save).toHaveBeenCalledWith('a', { result: 'not_run', remark: 'Declined' })
    await settle()
  })

  it('keeps saving after detach: a queued change is still sent, but nothing is shown', async () => {
    const { queue, save, pending, listener, settle } = setup()
    queue.change('a', { result: 'passed' })
    queue.change('a', { result: 'failed' })
    listener.onShow.mockClear()
    queue.detach()
    // A change that arrives just after the screen moved on, such as a remark committed as its input
    // goes away, is stored too.
    queue.change('a', { remark: 'Typed last' })
    expect(save).toHaveBeenCalledTimes(1)
    await settle()
    expect(save).toHaveBeenLastCalledWith('a', { result: 'failed', remark: 'Typed last' })
    expect(pending).toHaveLength(1)
    await settle()
    expect(save).toHaveBeenCalledTimes(2)
    expect(listener.onShow).not.toHaveBeenCalled()
    expect(listener.onSaved).toHaveBeenCalledWith('a')
  })

  it('says when it is idle, after the last save of every case', async () => {
    const { queue, settle } = setup()
    expect(queue.idle).toBe(true)
    await queue.whenIdle()
    queue.change('a', { result: 'passed' })
    queue.change('a', { result: 'failed' })
    queue.change('b', { result: 'blocked' })
    expect(queue.idle).toBe(false)
    let idle = false
    void queue.whenIdle().then(() => { idle = true })
    await settle()
    await settle()
    expect(idle).toBe(false)
    await settle()
    await Promise.resolve()
    expect(queue.idle).toBe(true)
    expect(idle).toBe(true)
  })

  it('reports a failure after detach only as a background failure, and still becomes idle', async () => {
    const { queue, listener, fail } = setup()
    queue.change('a', { result: 'passed' })
    listener.onShow.mockClear()
    queue.detach()
    const idle = queue.whenIdle()
    await fail()
    await idle
    expect(listener.onBackgroundError).toHaveBeenCalledWith('a', expect.any(Error))
    expect(listener.onError).not.toHaveBeenCalled()
    expect(listener.onShow).not.toHaveBeenCalled()
  })
})
