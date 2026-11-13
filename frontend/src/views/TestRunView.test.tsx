import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  RichTextEditor: ({ ariaLabel, value }: { ariaLabel?: string; value: { doc: { content?: Array<{ type?: string }> } } }) => (
    <div role="textbox" aria-label={ariaLabel}>{(value.doc.content ?? []).map((node) => node.type).join(',')}</div>
  ),
}))

const clipboard = vi.hoisted(() => ({ writePlainClipboard: vi.fn() }))
vi.mock('../editor/clipboardExport', () => clipboard)

import { COPIED_FEEDBACK_MS } from '../app/copyActions'
import type { TestRunCase, TestRunSummary } from '../tauri'
import { testRunReport } from '../testware/testRunReport'
import { formatDateTime } from '../ui/format'
import { TestRunView } from './TestRunView'

afterEach(cleanup)

const at = '2026-11-13T14:02:00Z'
const body = JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: [
  { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Pay by card' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Order is placed.' }] },
] } })
const testCase = (id: string, title: string, patch: Partial<TestRunCase> = {}): TestRunCase => ({
  id, runId: 'run-1', position: 0, groupTitle: null, title, bodyJson: body, result: 'not_run', remark: null, findingId: null, updatedAt: at, ...patch,
})
const summary = (id: string, createdAt: string): TestRunSummary => ({
  id, sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt, updatedAt: createdAt, total: 3, passed: 0, failed: 0, blocked: 0, notRun: 3,
})
const cases = [
  testCase('a', 'Pay by card', { groupTitle: 'Checkout', result: 'passed' }),
  testCase('b', 'Pay with a gift card', { groupTitle: 'Checkout' }),
  testCase('c', 'Reset password', { groupTitle: 'Account', result: 'failed', remark: 'No email' }),
]

function renderRun(overrides: Partial<ComponentProps<typeof TestRunView>> = {}) {
  const props = {
    open: { runId: 'run-1', draftId: 'draft-1', error: null, run: { id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, cases } },
    draftRuns: [summary('run-1', at)], error: null,
    onSelectRun: vi.fn(), onBack: vi.fn(), onDelete: vi.fn(async () => true), onChangeCase: vi.fn(),
    ...overrides,
  }
  render(<TestRunView {...props} />)
  return props
}

const row = (title: string) => screen.getByRole('region', { name: title })
const result = (title: string, label: string) => within(row(title)).getByRole('button', { name: label })

describe('TestRunView', () => {
  it('shows the draft title, when the run started, its progress and group headings', () => {
    renderRun()
    expect(screen.getByRole('heading', { level: 2, name: 'Checkout' })).toBeInTheDocument()
    expect(screen.getByText(`Test run of ${formatDateTime(at)}`)).toBeInTheDocument()
    expect(screen.getByText('2 of 3 run')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Checkout', 'Account'])
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual(['Pay by card', 'Pay with a gift card', 'Reset password'])
  })

  it('shows a case content only when it is expanded, without repeating its heading', () => {
    renderRun()
    const toggle = within(row('Pay by card')).getByRole('button', { name: 'Pay by card' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('textbox', { name: 'Pay by card test case' })).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'Pay by card test case' })).toHaveTextContent(/^paragraph$/)
  })

  it('changes only the result when a result is pressed, and clears it when pressed again', () => {
    const { onChangeCase } = renderRun()
    fireEvent.click(result('Pay with a gift card', 'Blocked'))
    expect(onChangeCase).toHaveBeenLastCalledWith('b', { result: 'blocked' })
    fireEvent.click(result('Reset password', 'Passed'))
    expect(onChangeCase).toHaveBeenLastCalledWith('c', { result: 'passed' })
    expect(result('Pay by card', 'Passed')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(result('Pay by card', 'Passed'))
    expect(onChangeCase).toHaveBeenLastCalledWith('a', { result: 'not_run' })
  })

  it('offers a remark only for a failed or blocked case, or one that has a remark', () => {
    renderRun({ open: { runId: 'run-1', draftId: 'draft-1', error: null, run: { id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, cases: [
      testCase('a', 'Passed case', { result: 'passed' }),
      testCase('b', 'Not run case'),
      testCase('c', 'Failed case', { result: 'failed' }),
      testCase('d', 'Blocked case', { result: 'blocked' }),
      testCase('e', 'Passed with remark', { result: 'passed', remark: 'Slow' }),
    ] } } })
    expect(screen.getAllByRole('textbox').map((input) => input.getAttribute('aria-label')))
      .toEqual(['Remark for Failed case', 'Remark for Blocked case', 'Remark for Passed with remark'])
    const remark = screen.getByRole('textbox', { name: 'Remark for Failed case' })
    expect(remark).toHaveAttribute('placeholder', 'What happened?')
    expect(remark).toHaveAttribute('maxLength', '500')
  })

  it('saves a remark on blur and on Enter, only when it changed', () => {
    const { onChangeCase } = renderRun()
    const remark = screen.getByRole('textbox', { name: 'Remark for Reset password' })
    fireEvent.blur(remark)
    fireEvent.keyDown(remark, { key: 'Enter' })
    expect(onChangeCase).not.toHaveBeenCalled()
    fireEvent.change(remark, { target: { value: '  No email sent  ' } })
    fireEvent.keyDown(remark, { key: 'Enter' })
    expect(onChangeCase).toHaveBeenLastCalledWith('c', { remark: 'No email sent' })
    fireEvent.change(remark, { target: { value: ' ' } })
    fireEvent.blur(remark)
    expect(onChangeCase).toHaveBeenLastCalledWith('c', { remark: null })
    expect(onChangeCase).toHaveBeenCalledTimes(2)
  })

  it('sets a result with p, f and b inside a case, but not while typing a remark', () => {
    const { onChangeCase } = renderRun()
    const toggle = within(row('Pay with a gift card')).getByRole('button', { name: 'Pay with a gift card' })
    fireEvent.keyDown(toggle, { key: 'f' })
    expect(onChangeCase).toHaveBeenLastCalledWith('b', { result: 'failed' })
    fireEvent.keyDown(result('Pay with a gift card', 'Passed'), { key: 'b' })
    expect(onChangeCase).toHaveBeenLastCalledWith('b', { result: 'blocked' })
    fireEvent.keyDown(within(row('Pay by card')).getByRole('button', { name: 'Pay by card' }), { key: 'p' })
    expect(onChangeCase).toHaveBeenLastCalledWith('a', { result: 'not_run' })
    fireEvent.keyDown(toggle, { key: 'p', metaKey: true })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Remark for Reset password' }), { key: 'p' })
    expect(onChangeCase).toHaveBeenCalledTimes(3)
  })

  it('moves between cases with the arrow keys', () => {
    renderRun()
    const toggles = ['Pay by card', 'Pay with a gift card', 'Reset password'].map((title) => within(row(title)).getByRole('button', { name: title }))
    fireEvent.keyDown(result('Pay by card', 'Failed'), { key: 'ArrowDown' })
    expect(toggles[1]).toHaveFocus()
    fireEvent.keyDown(toggles[1], { key: 'ArrowDown' })
    expect(toggles[2]).toHaveFocus()
    fireEvent.keyDown(toggles[2], { key: 'ArrowDown' })
    expect(toggles[2]).toHaveFocus()
    fireEvent.keyDown(toggles[2], { key: 'ArrowUp' })
    expect(toggles[1]).toHaveFocus()
  })

  it('offers a run switcher only when the draft has more than one test run', () => {
    renderRun()
    expect(screen.queryByRole('combobox', { name: 'Test run' })).not.toBeInTheDocument()
    cleanup()
    const later = '2026-11-14T09:30:00Z'
    const { onSelectRun } = renderRun({ draftRuns: [summary('run-2', later), summary('run-1', at)] })
    const switcher = screen.getByRole('combobox', { name: 'Test run' })
    expect(switcher).toHaveValue('run-1')
    expect(within(switcher).getAllByRole('option').map((option) => option.textContent)).toEqual([formatDateTime(later), formatDateTime(at)])
    fireEvent.change(switcher, { target: { value: 'run-2' } })
    expect(onSelectRun).toHaveBeenCalledWith('run-2')
  })

  it('copies the test run as a plain text report, then says Copied for a moment', async () => {
    vi.useFakeTimers()
    try {
      clipboard.writePlainClipboard.mockResolvedValue(undefined)
      const { open } = renderRun()
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy report' })) })
      expect(clipboard.writePlainClipboard).toHaveBeenCalledWith(testRunReport(open.run!))
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('Report copied')
      act(() => { vi.advanceTimersByTime(COPIED_FEEDBACK_MS) })
      expect(screen.getByRole('button', { name: 'Copy report' })).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('says when the report could not be copied', async () => {
    clipboard.writePlainClipboard.mockRejectedValue(new Error('Clipboard text writing is not available'))
    renderRun()
    fireEvent.click(screen.getByRole('button', { name: 'Copy report' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Copy failed: Something went wrong: Clipboard text writing is not available')
    expect(screen.getByRole('button', { name: 'Copy report' })).toBeInTheDocument()
  })

  it('offers Create Finding only on a failed case without a linked Finding', () => {
    const onCreateFinding = vi.fn()
    const failed = testCase('d', 'Change email', { result: 'failed', remark: 'Old address stays' })
    renderRun({ onCreateFinding, open: { runId: 'run-1', draftId: 'draft-1', error: null, run: { id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, cases: [
      testCase('a', 'Passed case', { result: 'passed', remark: 'Slow' }),
      testCase('b', 'Blocked case', { result: 'blocked' }),
      failed,
    ] } } })
    expect(screen.getAllByRole('button', { name: 'Create Finding' })).toHaveLength(1)
    const create = within(row('Change email')).getByRole('button', { name: 'Create Finding' })
    expect(create).toHaveClass('action-button--secondary', 'action-button--regular')
    fireEvent.click(create)
    expect(onCreateFinding).toHaveBeenCalledWith(failed)
  })

  it('shows the linked Finding of a failed case instead of Create Finding, and opens it', () => {
    const onOpenFinding = vi.fn()
    renderRun({ onCreateFinding: vi.fn(), onOpenFinding, findingTitles: { 'finding-1': 'Reset mail is never sent' },
      open: { runId: 'run-1', draftId: 'draft-1', error: null, run: { id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, cases: [
        testCase('c', 'Reset password', { result: 'failed', findingId: 'finding-1' }),
        testCase('d', 'Change email', { result: 'failed', findingId: 'finding-unknown' }),
      ] } } })
    expect(screen.queryByRole('button', { name: 'Create Finding' })).not.toBeInTheDocument()
    fireEvent.click(within(row('Reset password')).getByRole('button', { name: 'Finding: Reset mail is never sent' }))
    expect(onOpenFinding).toHaveBeenCalledWith('finding-1')
    expect(within(row('Change email')).queryByRole('button', { name: /^Finding:/ })).not.toBeInTheDocument()
  })

  it('goes back to the test cases', () => {
    const { onBack } = renderRun()
    fireEvent.click(screen.getByRole('button', { name: 'Back to test cases' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('deletes the test run only after confirming, with Cancel focused first', async () => {
    const { onDelete } = renderRun()
    fireEvent.click(screen.getByRole('button', { name: 'Delete test run' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this test run?' })
    expect(dialog).toHaveAccessibleDescription('Its results and remarks are removed. The test cases stay.')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete test run' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete test run' }))
    expect(onDelete).toHaveBeenCalledWith('run-1')
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps a remark that was still being typed when the screen goes away', () => {
    const props = { open: { runId: 'run-1', draftId: 'draft-1', error: null, run: { id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout', createdAt: at, updatedAt: at, cases } },
      draftRuns: [summary('run-1', at)], error: null, onSelectRun: vi.fn(), onBack: vi.fn(), onDelete: vi.fn(async () => true), onChangeCase: vi.fn() }
    const { unmount } = render(<TestRunView {...props} />)
    const failed = cases.find((testCase) => testCase.result === 'failed')!
    fireEvent.change(screen.getByRole('textbox', { name: `Remark for ${failed.title}` }), { target: { value: 'Typed, never blurred' } })
    expect(props.onChangeCase).not.toHaveBeenCalled()
    unmount()
    expect(props.onChangeCase).toHaveBeenCalledWith(failed.id, { remark: 'Typed, never blurred' })
  })

  it('keeps the delete dialog open while deleting, and closes it when deleting failed', async () => {
    let finish!: (deleted: boolean) => void
    const onDelete = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve }))
    renderRun({ onDelete })
    fireEvent.click(screen.getByRole('button', { name: 'Delete test run' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete test run' }))
    // Escape must not dismiss the dialog while the delete is under way.
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    finish(false)
    // A failure is shown in the error line, which the dialog would cover.
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows a save failure as one alert, and loading and load failure as state panels', () => {
    renderRun({ error: 'Something went wrong: disk full' })
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong: disk full')
    cleanup()
    renderRun({ open: { runId: 'run-1', draftId: 'draft-1', run: null, error: null } })
    expect(screen.getByRole('heading', { name: 'Opening test run' })).toBeInTheDocument()
    cleanup()
    const { onSelectRun } = renderRun({ open: { runId: 'run-1', draftId: 'draft-1', run: null, error: 'Something went wrong: gone' } })
    expect(screen.getByRole('heading', { name: 'Could not open the test run' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onSelectRun).toHaveBeenCalledWith('run-1')
  })
})
