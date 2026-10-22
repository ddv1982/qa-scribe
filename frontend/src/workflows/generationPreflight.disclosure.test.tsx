import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { GenerationPreflight } from './generationPreflight'
import { NextModelSelection } from '../components/NextModelSelection'
import { providerStatusFixture } from '../test/fixtures'

const props = {
  action: 'testware' as const, activeProviderAvailable: true, activeProviderLabel: 'Codex CLI', isBusy: false,
  noteScreenshotCount: 2, sessionTitle: 'Checkout', noteWordCount: 15, selectedModel: 'CLI resolves at run time',
  delegatesModel: true, delegatesReasoning: true, onCancel: vi.fn(), onConfirm: vi.fn(),
}
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('starts with task choices and a truthful execution summary while retaining mounted controls', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<GenerationPreflight {...props} modelSelectionControl={
    <NextModelSelection provider={providerStatusFixture().providers[0]} value="default" pending={false}
      disabled={false} catalogEnabled onChange={onChange} />
  } />)
  const details = screen.getByText('Execution details').closest('details')!
  expect(details.open).toBe(false)
  expect(details.querySelector('input[role="combobox"]')).not.toBeNull()
  expect(screen.getByRole('combobox', { name: 'Model' })).not.toBeVisible()
  expect(details.querySelector('summary')).toHaveTextContent('15 words · 2 screenshots · Codex CLI · CLI default')
  const output = screen.getByRole('combobox', { name: 'Output' })
  const design = screen.getByRole('group', { name: 'Test design' })
  expect(output.compareDocumentPosition(design) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  await user.selectOptions(output, 'gherkin')
  await user.click(screen.getByRole('button', { name: /^RulesBusiness rules/ }))
  await user.click(screen.getByText('Execution details'))
  expect(screen.getByRole('combobox', { name: 'Model' })).toBeVisible()
  expect(screen.getByText('Saved for this provider across QA Scribe. Changes affect the next invocation.')).toBeVisible()
  await user.click(screen.getByText('Execution details'))
  await user.click(screen.getByRole('button', { name: 'Generate test cases' }))
  expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith({ technique: 'decision_table', outputFormat: 'gherkin',
    depth: 'balanced', includeNegativeCases: true, includeBoundaryCases: true, includeTestData: true,
    preserveEvidence: true, customInstructions: null })
  expect(onChange).not.toHaveBeenCalled()
})

it('opens execution details for intervention but keeps warnings and pending writes outside them', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<GenerationPreflight {...props} />)
  const warning = 'Choose a supported model before generation.'
  rerender(<GenerationPreflight {...props} selectionWarning={warning} modelSelectionPending
    selectionAdvisories={['Cached provider metadata. Refresh in Settings.']} />)
  const details = screen.getByText('Execution details').closest('details')!
  expect(details.open).toBe(true)
  await user.click(screen.getByText('Execution details'))
  expect(details.open).toBe(false)
  expect(screen.getByRole('alert')).toHaveTextContent(warning)
  for (const notice of screen.getAllByRole('status')) {
    expect(notice.closest('details')).toBeNull()
    expect(notice).toBeVisible()
  }
  expect(screen.getByRole('button', { name: 'Generate test cases' })).toBeDisabled()
  rerender(<GenerationPreflight {...props} />)
  expect(screen.getByRole('button', { name: 'Generate test cases' })).toBeEnabled()
})

it.each([false, true])('wraps focus across visible controls with execution details open=%s', (open) => {
  render(<GenerationPreflight {...props} modelSelectionControl={<input aria-label="Execution control" />} />)
  const dialog = screen.getByRole('dialog')
  const summary = dialog.querySelector<HTMLElement>('summary')!
  summary.closest('details')!.open = open
  const last = within(dialog).getByRole('button', { name: 'Generate test cases' })
  last.focus()
  fireEvent.keyDown(last, { key: 'Tab' })
  expect(summary).toHaveFocus()
  fireEvent.keyDown(summary, { key: 'Tab', shiftKey: true })
  expect(last).toHaveFocus()
})

it.each([
  ['summary', 'replace the current note', 'Summarize note'],
  ['finding', 'draft a Jira-ready finding', 'Create finding'],
] as const)('keeps the actual %s consequence visible with details closed', (action, consequence, confirm) => {
  render(<GenerationPreflight {...props} action={action} />)
  expect(screen.getByText(new RegExp(consequence))).toBeVisible()
  expect(screen.getByText(new RegExp(consequence)).closest('details')).toBeNull()
  expect(screen.getByText('Execution details').closest('details')!.open).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: confirm }))
  expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith(undefined)
})
