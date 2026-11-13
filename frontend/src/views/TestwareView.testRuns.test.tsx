import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  FormatToolbar: () => <div data-testid="format-toolbar" />,
  RichTextEditor: ({ ariaLabel }: { ariaLabel?: string }) => <div role="textbox" aria-label={ariaLabel} />,
}))
const api = vi.hoisted(() => ({
  listTestRuns: vi.fn(),
  getTestRun: vi.fn(),
  startTestRun: vi.fn(),
  setTestCaseResult: vi.fn(),
  deleteTestRun: vi.fn(),
}))
vi.mock('../tauri', async (original) => ({ ...await original<typeof import('../tauri')>(), ...api }))

import { draftFixture, recordCreationCommandsFixture } from '../test/fixtures'
import type { Draft, TestRun, TestRunCaseDraft, TestRunSummary } from '../tauri'
import { formatShortDate } from '../ui/format'
import { TestwareView } from './TestwareView'

const at = '2026-11-13T14:02:00Z'
const runnable = draftFixture({
  id: 'draft-1', title: 'Checkout cases',
  body: '<h2>Checkout</h2><h3>Pay by card</h3><p>Order is placed.</p><h3>Pay with a gift card</h3><p>Gift card is charged.</p>',
})
const unrunnable = draftFixture({ id: 'draft-2', title: 'Notes only', body: '<p>Just a paragraph.</p>', updatedAt: '2000-01-01T00:00:00Z' })
const charters = draftFixture({
  id: 'draft-3', title: 'Charters', body: '<h3>Explore checkout</h3><p>Mission.</p>',
  metadataJson: JSON.stringify({ manualCreationFormat: { version: 1, format: { kind: 'testware', outputFormat: 'charters' } } }),
})
const summary = (patch: Partial<TestRunSummary> = {}): TestRunSummary => ({
  id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout cases', createdAt: at, updatedAt: at,
  total: 5, passed: 0, failed: 0, blocked: 0, notRun: 5, ...patch,
})
const run: TestRun = {
  id: 'run-1', sessionId: 'session-1', draftId: 'draft-1', draftTitle: 'Checkout cases', createdAt: at, updatedAt: at,
  cases: [{ id: 'case-1', runId: 'run-1', position: 0, groupTitle: 'Checkout', title: 'Pay by card', bodyJson: '{}', result: 'not_run', remark: null, findingId: null, updatedAt: at }],
}

beforeEach(() => {
  for (const command of Object.values(api)) command.mockReset()
  api.listTestRuns.mockResolvedValue([])
  api.getTestRun.mockResolvedValue(run)
})
afterEach(cleanup)

function renderTestware(drafts: Draft[], overrides: Partial<ComponentProps<typeof TestwareView>> = {}) {
  const props = {
    creationCommands: recordCreationCommandsFixture('testware'), busyAction: null, copyState: { status: 'idle' as const },
    draftScreenshotCounts: {}, notice: null, error: null, isBusy: false, activeGenerationJob: null, updateLocalDraft: vi.fn(),
    onCancelGenerationJob: async () => undefined, onCopy: async () => undefined, onDeleteDraft: vi.fn(),
    onSaveDraft: async () => true, onDiscardDraft: vi.fn(), onUploadImage: vi.fn(), sessionId: 'session-1',
    ...overrides,
  }
  render(<TestwareView {...props} drafts={drafts} />)
  return props
}

const startButton = () => screen.queryByRole('button', { name: 'Start test run' })
const selectDraft = (title: string) => fireEvent.click(within(screen.getByRole('complementary', { name: 'Test cases records' })).getByRole('button', { name: new RegExp(title) }))

describe('Start test run', () => {
  it('is offered on a saved draft that splits into test cases, in the Session only', async () => {
    renderTestware([runnable, unrunnable, charters])
    expect(startButton()).toBeInTheDocument()
    selectDraft('Notes only')
    expect(startButton()).not.toBeInTheDocument()
    selectDraft('Charters')
    expect(startButton()).not.toBeInTheDocument()
    cleanup()
    api.listTestRuns.mockClear()
    renderTestware([runnable], { sessionId: null })
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(startButton()).not.toBeInTheDocument()
    expect(api.listTestRuns).not.toHaveBeenCalled()
  })

  it('is not offered while the draft is being edited', () => {
    renderTestware([runnable])
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(startButton()).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(startButton()).toBeInTheDocument()
  })

  it('copies the saved test cases, each with only its own content, and opens the new run', async () => {
    api.startTestRun.mockResolvedValue(run)
    renderTestware([runnable])
    fireEvent.click(startButton()!)
    await screen.findByText(/^Test run of /)
    const [draftId, cases] = api.startTestRun.mock.calls[0] as [string, TestRunCaseDraft[]]
    expect(draftId).toBe('draft-1')
    expect(cases.map(({ groupTitle, title }) => [groupTitle, title])).toEqual([['Checkout', 'Pay by card'], ['Checkout', 'Pay with a gift card']])
    const first = JSON.parse(cases[0].bodyJson) as { schemaVersion: number; doc: { content: Array<{ type: string }> } }
    expect(first.schemaVersion).toBe(1)
    expect(first.doc.content.map((node) => node.type)).toEqual(['heading', 'paragraph'])
    expect(screen.getByRole('region', { name: 'Pay by card' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to test cases' }))
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('stays on the draft and shows why when starting fails', async () => {
    api.startTestRun.mockRejectedValue({ kind: 'validation', message: 'A test run needs at least one test case' })
    renderTestware([runnable])
    fireEvent.click(startButton()!)
    expect(await screen.findByRole('alert')).toHaveTextContent('A test run needs at least one test case')
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })
})

describe('Last test run line', () => {
  it.each([
    [{ passed: 3, failed: 1, blocked: 1, notRun: 0 }, '3 passed, 1 failed, 1 blocked'],
    [{ passed: 1, failed: 1, notRun: 3 }, '1 passed, 1 failed'],
    [{ blocked: 2, notRun: 3 }, '2 blocked'],
    [{ failed: 1, blocked: 1, notRun: 3 }, '1 failed, 1 blocked'],
    [{}, 'nothing recorded yet'],
  ])('reads %o as "%s"', async (counts, text) => {
    api.listTestRuns.mockResolvedValue([summary(counts)])
    renderTestware([runnable])
    expect(await screen.findByRole('button', { name: `Last test run ${formatShortDate(at)}: ${text}` })).toBeInTheDocument()
  })

  it('shows the newest run of the selected draft only, and opens it', async () => {
    api.listTestRuns.mockResolvedValue([summary({ id: 'run-2', draftId: 'draft-2', passed: 4 }), summary({ passed: 1 })])
    renderTestware([runnable, unrunnable])
    const line = await screen.findByRole('button', { name: /^Last test run .*: 1 passed$/ })
    fireEvent.click(line)
    await waitFor(() => expect(api.getTestRun).toHaveBeenCalledWith('run-1'))
    expect(await screen.findByRole('region', { name: 'Pay by card' })).toBeInTheDocument()
  })

  it('is absent for a draft that was never run', async () => {
    renderTestware([runnable])
    await waitFor(() => expect(api.listTestRuns).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /^Last test run/ })).not.toBeInTheDocument()
  })
})

describe('Test runs and their draft', () => {
  it('closes the run screen when another draft is selected', async () => {
    api.listTestRuns.mockResolvedValue([summary()])
    renderTestware([runnable, unrunnable])
    fireEvent.click(await screen.findByRole('button', { name: /^Last test run/ }))
    await screen.findByRole('region', { name: 'Pay by card' })
    selectDraft('Notes only')
    selectDraft('Checkout cases')
    expect(screen.queryByRole('region', { name: 'Pay by card' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('tells the delete confirmation how many test runs go with the draft', async () => {
    api.listTestRuns.mockResolvedValue([summary(), summary({ id: 'run-0' }), summary({ id: 'run-x', draftId: 'draft-2' })])
    const { onDeleteDraft } = renderTestware([runnable, unrunnable])
    await screen.findByRole('button', { name: /^Last test run/ })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Checkout cases' }))
    expect(onDeleteDraft).toHaveBeenCalledWith(runnable, 2)
  })
})
