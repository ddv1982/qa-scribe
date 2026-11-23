import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  FormatToolbar: () => null,
  RichTextEditor: ({ ariaLabel, onChange, value }: { ariaLabel: string; onChange: (next: RichEditorDocument) => void; value: RichEditorDocument }) =>
    <input aria-label={ariaLabel} value={value.doc.content?.[0]?.content?.[0]?.text ?? ''} onChange={(event) => onChange({
      schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: event.target.value }] }] },
    })} />,
}))
const api = vi.hoisted(() => ({
  listTestRuns: vi.fn(),
  getTestRun: vi.fn(),
  setTestCaseResult: vi.fn(),
  saveTestCaseNotes: vi.fn(),
}))
vi.mock('../tauri', async (original) => ({ ...await original<typeof import('../tauri')>(), ...api }))

import type { TestCaseResult, TestRun, TestRunCase } from '../tauri'
import { forgetDrainingTestRuns, useTestRuns } from '../testware/useTestRuns'
import { TestRunView } from './TestRunView'
import type { RichEditorDocument } from '../editor/editorDocument'

const at = '2026-11-13T14:02:00Z'
const stored = (patch: Partial<TestRunCase> = {}): TestRunCase => ({
  id: 'a', runId: 'run-1', position: 0, groupTitle: null, title: 'Pay by card', bodyJson: '{}', result: 'not_run', remark: null, findingId: null, findingTitle: null, updatedAt: at, ...patch,
})
const run = (testCase: TestRunCase): TestRun => ({ id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, cases: [testCase] })

let saved: TestRunCase
let saves: Array<() => void>

beforeEach(() => {
  saves = []
  forgetDrainingTestRuns()
  for (const command of Object.values(api)) command.mockReset()
  api.listTestRuns.mockResolvedValue([])
  api.setTestCaseResult.mockImplementation((_caseId: string, result: TestCaseResult) => new Promise<TestRunCase>((resolve) => {
    saves.push(() => resolve(saved = { ...saved, result }))
  }))
  api.saveTestCaseNotes.mockImplementation((_caseId: string, bodyJson: string) => new Promise<TestRunCase>((resolve) => {
    saves.push(() => resolve(saved = { ...saved, notes: { bodyJson, text: 'Card declined', imageCount: 0 } }))
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
  saved = testCase
  api.getTestRun.mockResolvedValue(run(testCase))
  render(<Harness />)
  return screen.findByRole('region', { name: 'Pay by card' })
}

/** Settles every save, including the ones a settled save sends next. */
async function settleAll() {
  while (saves.length) await act(async () => { saves.shift()!(); await Promise.resolve() })
}

describe('Saving test result notes', () => {
  it('keeps edits made during a status save and preserves notes when the result clears', async () => {
    const user = userEvent.setup()
    const row = await renderOpen(stored())
    const button = (name: string) => within(row).getByRole('button', { name })
    await user.click(button('Failed'))
    await user.click(button('Add result notes for Pay by card'))
    const editor = within(row).getByRole('textbox', { name: 'Result notes for Pay by card' })
    await user.type(editor, 'Card declined')
    expect(api.saveTestCaseNotes).not.toHaveBeenCalled()
    expect(editor).toHaveValue('Card declined')
    await act(async () => { saves.shift()!(); await Promise.resolve() })
    expect(editor).toHaveValue('Card declined')
    expect(api.saveTestCaseNotes).toHaveBeenCalledTimes(1)
    await user.click(button('Failed'))
    await settleAll()
    expect(saved.result).toBe('not_run')
    expect(saved.notes?.text).toBe('Card declined')
    expect(editor).toHaveValue('Card declined')
  })

  it('shows the legacy remark in the editor before it gets a rich note', async () => {
    const user = userEvent.setup()
    const row = await renderOpen(stored({ result: 'blocked', remark: 'No test card' }))
    await user.click(within(row).getByRole('button', { name: 'Result notes for Pay by card' }))
    expect(within(row).getByRole('textbox', { name: 'Result notes for Pay by card' })).toHaveValue('No test card')
    expect(api.saveTestCaseNotes).not.toHaveBeenCalled()
  })
})
