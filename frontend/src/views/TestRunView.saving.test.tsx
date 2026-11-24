import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  FormatToolbar: () => null,
  RichTextEditor: ({ ariaLabel, onChange, value, readOnly }: { ariaLabel: string; onChange: (next: RichEditorDocument) => void; value: RichEditorDocument; readOnly?: boolean }) =>
    <textarea aria-label={ariaLabel} readOnly={readOnly} value={value.doc.content?.map(p => p.content?.map(node => node.text).join('')).join('\n') ?? ''} onChange={(event) => onChange({
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

import type { TestCaseResult, TestRun, TestRunCase, TestRunSuggestionOutcome } from '../tauri'
import * as testRunsApi from '../testware/useTestRuns'
import { flushPendingTestRunNotes, forgetDrainingTestRuns, hasPendingTestRunNotes, trackNoteImageRead, useTestRuns } from '../testware/useTestRuns'
import { TestRunView } from './TestRunView'
import type { RichEditorDocument } from '../editor/editorDocument'

const at = '2026-11-13T14:02:00Z'
const stored = (patch: Partial<TestRunCase> = {}): TestRunCase => ({
  id: 'a', runId: 'run-1', position: 0, groupTitle: null, title: 'Pay by card', bodyJson: '{}', result: 'not_run', remark: null, findingId: null, findingTitle: null, updatedAt: at, ...patch,
})
const run = (testCase: TestRunCase): TestRun => ({ id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, cases: [testCase] })

let saved: TestRunCase
let saves: Array<() => void>
const writeSuggestion = vi.fn<() => Promise<TestRunSuggestionOutcome[]>>()

beforeEach(() => {
  saves = []
  writeSuggestion.mockReset()
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
  const [actionError, setActionError] = useState('')
  const runs = useTestRuns('session-1')
  const { openRun } = runs
  useEffect(() => { void openRun('run-1', 'draft-1') }, [openRun])
  return <>
    <button onClick={() => void Promise.resolve().then(() => testRunsApi.runTestRunSuggestionAction('run-1', writeSuggestion)).catch((cause: unknown) => setActionError(String(cause)))}>Apply fixture suggestion</button>
    <p role="status">{actionError}</p>
    <button onClick={runs.close}>Leave test run</button>
    <button onClick={() => void openRun('run-1', 'draft-1')}>Reopen test run</button>
    {runs.open ? <TestRunView open={runs.open} draftRuns={[]} error={runs.error} onSelectRun={vi.fn()} onBack={vi.fn()}
    onDelete={async () => true} onChangeCase={runs.changeCase} editsBlocked={runs.editsBlocked} /> : null}
  </>
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

  it('drains notes for app close and restores a failed draft after leaving the test run', async () => {
    const user = userEvent.setup()
    let reject!: (error: Error) => void
    api.saveTestCaseNotes.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const row = await renderOpen(stored())
    await user.click(within(row).getByRole('button', { name: 'Add result notes for Pay by card' }))
    const editor = within(row).getByRole('textbox', { name: 'Result notes for Pay by card' })
    await user.type(editor, 'X')
    expect(hasPendingTestRunNotes()).toBe(true)
    const close = flushPendingTestRunNotes()
    await user.click(screen.getByRole('button', { name: 'Leave test run' }))
    await act(async () => { reject(new Error('disk full')); await close })
    expect(await close).toBe(false)
    expect(hasPendingTestRunNotes()).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Reopen test run' }))
    const reopened = await screen.findByRole('region', { name: 'Pay by card' })
    expect(within(reopened).getByText('X')).toBeVisible()
    await user.click(within(reopened).getByRole('button', { name: 'Retry' }))
    await settleAll()
    expect(hasPendingTestRunNotes()).toBe(false)
    expect(saved.notes?.bodyJson).toContain('"text":"X"')
  })

  it('shows the legacy remark in the editor before it gets a rich note', async () => {
    const user = userEvent.setup()
    const row = await renderOpen(stored({ result: 'blocked', remark: 'No test card' }))
    await user.click(within(row).getByRole('button', { name: 'Result notes for Pay by card' }))
    expect(within(row).getByRole('textbox', { name: 'Result notes for Pay by card' })).toHaveValue('No test card')
    expect(api.saveTestCaseNotes).not.toHaveBeenCalled()
  })
})

describe('Applying a suggested result', () => {
  it('drains a pending case save and an image read before calling the command', async () => {
    const user = userEvent.setup()
    const row = await renderOpen(stored())
    const passed = within(row).getByRole('button', { name: 'Passed' })
    await user.click(passed)
    let finishRead!: () => void
    const read = trackNoteImageRead('run-1', new Promise<void>(resolve => { finishRead = resolve }))
    writeSuggestion.mockResolvedValue([])
    await user.click(screen.getByRole('button', { name: 'Apply fixture suggestion' }))
    try {
      expect(passed).toBeDisabled()
      await settleAll()
      expect(writeSuggestion).not.toHaveBeenCalled()
    } finally {
      await act(async () => { finishRead(); await read })
    }
    expect(writeSuggestion).toHaveBeenCalledOnce()
    expect(passed).toBeEnabled()
  })

  it('refuses to apply while a Result notes save is failed', async () => {
    const user = userEvent.setup()
    api.saveTestCaseNotes.mockRejectedValueOnce(new Error('Disk full'))
    const row = await renderOpen(stored())
    await user.click(within(row).getByRole('button', { name: 'Add result notes for Pay by card' }))
    await user.type(within(row).getByRole('textbox', { name: 'Result notes for Pay by card' }), 'A')
    await user.click(screen.getByRole('button', { name: 'Apply fixture suggestion' }))
    expect(await screen.findByText(/Retry the failed test case save before continuing/)).toBeVisible()
    expect(writeSuggestion).not.toHaveBeenCalled()
  })

  it('installs the appended notes in the open editor so typing preserves both texts', async () => {
    const user = userEvent.setup()
    const row = await renderOpen(stored({ remark: 'Existing observation' }))
    await user.click(within(row).getByRole('button', { name: 'Result notes for Pay by card' }))
    const editor = within(row).getByRole('textbox', { name: 'Result notes for Pay by card' })
    const blocks = ['Existing observation', 'HTTP 500'].map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] }))
    const notes = { bodyJson: JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: blocks } }), text: 'Existing observation\nHTTP 500', imageCount: 0 }
    let finish!: (outcomes: TestRunSuggestionOutcome[]) => void
    writeSuggestion.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await user.click(screen.getByRole('button', { name: 'Apply fixture suggestion' }))
    expect(editor).toHaveAttribute('readonly')
    await act(async () => { finish([{ kind: 'saved', testCase: stored({ result: 'failed', notes }),
      suggestion: { id: 'suggestion', assistantMessageId: 'assistant', caseId: 'a', result: 'failed', notesJson: notes.bodyJson,
        rationale: 'The request failed.', baseFingerprint: 'base', appliedFingerprint: 'applied' } }]) })
    expect(editor).toHaveValue('Existing observation\nHTTP 500')
    fireEvent.change(editor, { target: { value: 'Existing observation\nHTTP 500 reproduced' } })
    await settleAll()
    const lastSave = api.saveTestCaseNotes.mock.lastCall?.[1] as string
    expect(lastSave).toContain('Existing observation\\nHTTP 500 reproduced')
  })
})
