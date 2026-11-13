import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({ RichTextEditor: () => null }))
const api = vi.hoisted(() => ({
  listTestRuns: vi.fn(),
  getTestRun: vi.fn(),
  setTestCaseResult: vi.fn(),
}))
vi.mock('../tauri', async (original) => ({ ...await original<typeof import('../tauri')>(), ...api }))

import type { TestCaseResult, TestRun, TestRunCase } from '../tauri'
import { useTestRuns } from '../testware/useTestRuns'
import { TestRunView } from './TestRunView'

const at = '2026-11-13T14:02:00Z'
const stored = (patch: Partial<TestRunCase> = {}): TestRunCase => ({
  id: 'a', runId: 'run-1', position: 0, groupTitle: null, title: 'Pay by card', bodyJson: '{}', result: 'not_run', remark: null, findingId: null, updatedAt: at, ...patch,
})
const run = (testCase: TestRunCase): TestRun => ({ id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, cases: [testCase] })

/** Every save, settled by hand so the order is explicit. */
let saves: Array<{ result: TestCaseResult; remark: string | null; resolve: () => void }>

beforeEach(() => {
  saves = []
  for (const command of Object.values(api)) command.mockReset()
  api.listTestRuns.mockResolvedValue([])
  api.setTestCaseResult.mockImplementation((caseId: string, result: TestCaseResult, remark: string | null) => new Promise<TestRunCase>((resolve) => {
    saves.push({ result, remark, resolve: () => resolve(stored({ id: caseId, result, remark })) })
  }))
})
afterEach(cleanup)

function Harness() {
  const runs = useTestRuns('session-1')
  const { openRun } = runs
  useEffect(() => { void openRun('run-1', 'draft-1') }, [openRun])
  return runs.open ? <TestRunView open={runs.open} draftRuns={[]} error={runs.error} onSelectRun={vi.fn()} onBack={vi.fn()}
    onDelete={async () => true} onChangeCase={runs.changeCase} /> : null
}

async function renderOpen(testCase: TestRunCase) {
  api.getTestRun.mockResolvedValue(run(testCase))
  render(<Harness />)
  return screen.findByRole('region', { name: 'Pay by card' })
}

/** Settles every save, including the ones a settled save sends next. */
async function settleAll() {
  while (saves.length) await act(async () => { saves.shift()!.resolve(); await Promise.resolve() })
}

const lastSave = () => api.setTestCaseResult.mock.lastCall as [string, TestCaseResult, string | null]

describe('Saving a result and a remark together', () => {
  it('keeps a typed remark when a result is clicked without leaving the field first', async () => {
    const user = userEvent.setup()
    const row = await renderOpen(stored({ result: 'failed' }))
    await user.type(within(row).getByRole('textbox', { name: 'Remark for Pay by card' }), 'Card declined')
    await user.click(within(row).getByRole('button', { name: 'Blocked' }))
    await settleAll()
    expect(lastSave()).toEqual(['a', 'blocked', 'Card declined'])
    expect(within(row).getByRole('button', { name: 'Blocked' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(row).getByRole('textbox', { name: 'Remark for Pay by card' })).toHaveValue('Card declined')
  })

  it('keeps a remark saved with Enter when a result is clicked right after', async () => {
    const user = userEvent.setup()
    const row = await renderOpen(stored({ result: 'blocked' }))
    await user.type(within(row).getByRole('textbox', { name: 'Remark for Pay by card' }), 'No test card{Enter}')
    await user.click(within(row).getByRole('button', { name: 'Failed' }))
    expect(api.setTestCaseResult).toHaveBeenCalledTimes(1)
    await settleAll()
    expect(lastSave()).toEqual(['a', 'failed', 'No test card'])
  })

  it('keeps the remark, stored and visible, when the result is cleared', async () => {
    const user = userEvent.setup()
    const row = await renderOpen(stored({ result: 'failed', remark: 'Declined' }))
    await user.click(within(row).getByRole('button', { name: 'Failed' }))
    await settleAll()
    expect(lastSave()).toEqual(['a', 'not_run', 'Declined'])
    for (const label of ['Passed', 'Failed', 'Blocked']) expect(within(row).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
    expect(within(row).getByRole('textbox', { name: 'Remark for Pay by card' })).toHaveValue('Declined')
  })
})
