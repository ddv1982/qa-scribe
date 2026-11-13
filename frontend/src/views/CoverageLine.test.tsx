import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  FormatToolbar: () => <div data-testid="format-toolbar" />,
  RichTextEditor: ({ ariaLabel }: { ariaLabel?: string }) => <div role="textbox" aria-label={ariaLabel} />,
}))

import { draftFixture, recordCreationCommandsFixture } from '../test/fixtures'
import type { Draft, TestCaseResult, TestRunCase } from '../tauri'
import { CoverageLine } from './CoverageLine'
import { TestwareView } from './TestwareView'

afterEach(cleanup)

const record = (title: string, body = '<p>Steps</p>') => ({ title, body })
const run = (...cases: Array<[title: string, result: TestCaseResult]>) => ({ cases: cases.map(([title, result], position): TestRunCase => ({
  id: `case-${position}`, runId: 'run-1', position, groupTitle: null, title, bodyJson: '{}', result, remark: null, findingId: null, updatedAt: '',
})) })

describe('CoverageLine', () => {
  it('renders nothing without criteria', () => {
    const { container } = render(<CoverageLine acceptanceCriteria={null} records={[record('Covers AC-1')]} />)
    expect(container).toBeEmptyDOMElement()
    render(<CoverageLine acceptanceCriteria={'  \n'} records={[]} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says when every criterion is covered', () => {
    render(<CoverageLine acceptanceCriteria={'AC-1 Empty street\nAC-2 Postcode'}
      records={[record('Street', '<h3>Street</h3><p>Covers: AC-1</p><p>Expected an error</p>'), record('Postcode covers ac-2')]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/^All 2 criteria covered\.$/)
    cleanup()
    render(<CoverageLine acceptanceCriteria="AC-1 Empty street" records={[record('Covers AC-1')]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/^1 criterion covered\.$/)
  })

  it('reads an id through inline formatting but not across blocks', () => {
    render(<CoverageLine acceptanceCriteria={'AC-1 Street\nAC-2 Postcode\nAC-12 City'}
      records={[record('Case', '<p>Covers: AC-<strong>1</strong></p><p>AC-1<strong>2</strong></p><p>AC-</p><p>2</p>')]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/^2 of 3 criteria covered\. Not covered: AC-2$/)
  })

  it('names the criteria no test case covers, with their text on hover', () => {
    render(<CoverageLine acceptanceCriteria={'AC-1 Empty street shows an error\nAC-2 Postcode is validated\nSHOP-412 Country'}
      records={[record('Street', '<p>Covers: AC-1</p><p>Also AC-12 and XAC-2</p>')]} />)
    const line = screen.getByRole('status')
    expect(line).toHaveTextContent(/^1 of 3 criteria covered\. Not covered: AC-2, SHOP-412$/)
    expect(screen.getByText('AC-2')).toHaveAttribute('title', 'Postcode is validated')
    expect(screen.getByText('SHOP-412')).toHaveAttribute('title', 'Country')
    cleanup()
    render(<CoverageLine acceptanceCriteria="AC-1 Empty street" records={[]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/^0 of 1 criterion covered\. Not covered: AC-1$/)
  })

  it('lists at most eight uncovered ids, then how many more', () => {
    const criteria = Array.from({ length: 11 }, (_, index) => `AC-${index + 1} Criterion ${index + 1}`).join('\n')
    render(<CoverageLine acceptanceCriteria={criteria} records={[record('Covers AC-11')]} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      /^1 of 11 criteria covered\. Not covered: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8 and 2 more$/,
    )
    expect(screen.queryByText('AC-9')).not.toBeInTheDocument()
  })
})

describe('CoverageLine with test results', () => {
  const criteria = 'AC-1 Street\nAC-2 Postcode\nAC-3 City\nAC-4 Country'

  it('says nothing more while no case that names a criterion failed', () => {
    render(<CoverageLine acceptanceCriteria={criteria} records={[record('Covers AC-1 AC-2 AC-3')]}
      latestRuns={[run(['Covers AC-1', 'passed'], ['Covers AC-2', 'blocked'], ['Covers AC-3', 'not_run'])]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/^3 of 4 criteria covered\. Not covered: AC-4$/)
  })

  it('counts and names failing criteria before the ones not covered', () => {
    render(<CoverageLine acceptanceCriteria={criteria} records={[record('Covers AC-1 AC-2 AC-3')]}
      latestRuns={[run(['Covers AC-1', 'passed'], ['Covers AC-3', 'failed']), run(['Also AC-2', 'failed'])]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/^3 of 4 criteria covered, 2 failing\. Failing: AC-2, AC-3\. Not covered: AC-4$/)
    expect(screen.getByText('3 of 4 criteria covered, 2 failing.').tagName).toBe('STRONG')
    expect(screen.getByText('AC-3')).toHaveAttribute('title', 'City')
  })

  it('leaves out the Not covered list when everything is covered', () => {
    render(<CoverageLine acceptanceCriteria={criteria} records={[record('Covers AC-1 AC-2 AC-3 AC-4')]} latestRuns={[run(['Covers AC-3', 'failed'])]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/^All 4 criteria covered, 1 failing\. Failing: AC-3$/)
  })

  it('names a criterion no saved test case covers only as not covered', () => {
    render(<CoverageLine acceptanceCriteria={criteria} records={[record('Covers AC-1 AC-2 AC-3')]} latestRuns={[run(['Covers AC-4', 'failed'])]} />)
    expect(screen.getByRole('status')).toHaveTextContent(/^3 of 4 criteria covered\. Not covered: AC-4$/)
  })

  it('lists at most eight failing ids, then how many more', () => {
    const many = Array.from({ length: 10 }, (_, index) => `AC-${index + 1} Criterion ${index + 1}`).join('\n')
    const ids = Array.from({ length: 10 }, (_, index) => `AC-${index + 1}`).join(' ')
    render(<CoverageLine acceptanceCriteria={many} records={[record(ids)]} latestRuns={[run([ids, 'failed'])]} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      /^All 10 criteria covered, 10 failing\. Failing: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8 and 2 more$/,
    )
  })
})

describe('Coverage line in the Test cases view', () => {
  function renderTestware(drafts: Draft[], acceptanceCriteria: string | null) {
    const props = {
      creationCommands: recordCreationCommandsFixture('testware'), busyAction: null, copyState: { status: 'idle' as const },
      draftScreenshotCounts: {}, notice: null, error: null, isBusy: false, activeGenerationJob: null, updateLocalDraft: vi.fn(),
      onCancelGenerationJob: async () => undefined, onCopy: async () => undefined, onDeleteDraft: vi.fn(),
      onSaveDraft: async () => true, onDiscardDraft: vi.fn(), onUploadImage: vi.fn(),
    }
    const view = render(<TestwareView {...props} drafts={drafts} acceptanceCriteria={acceptanceCriteria} />)
    return { rerender: (next: Draft[]) => view.rerender(<TestwareView {...props} drafts={next} acceptanceCriteria={acceptanceCriteria} />) }
  }

  it('shows nothing new for a Session without criteria', () => {
    renderTestware([draftFixture({ title: 'Covers AC-1' })], null)
    expect(document.querySelector('.coverage-line')).toBeNull()
  })

  it('counts saved test cases only: an edit in progress keeps its saved text until it is saved', async () => {
    const saved = draftFixture({ title: 'Street', body: '<p>Covers: AC-1</p>' })
    const view = renderTestware([saved], 'AC-1 Empty street\nAC-2 Postcode')
    const line = () => document.querySelector('.coverage-line')
    expect(line()).toHaveTextContent('1 of 2 criteria covered. Not covered: AC-2')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    view.rerender([{ ...saved, body: '<p>Covers: AC-1, AC-2</p>' }])
    expect(line()).toHaveTextContent('1 of 2 criteria covered. Not covered: AC-2')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(line()).toHaveTextContent(/^All 2 criteria covered\.$/))
  })
})
