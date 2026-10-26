import { recordCreationCommandsFixture } from '../test/fixtures'
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { StrictMode, useState, type ComponentProps } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  FormatToolbar: () => <div data-testid="format-toolbar" />,
  RichTextEditor: ({ ariaLabel }: { ariaLabel?: string }) => <div role="textbox" aria-label={ariaLabel} />,
}))

import { draftFixture, findingFixture } from '../test/fixtures'
import { FindingsView } from './FindingsView'
import type { CreatedRecordEditTarget } from '../app/types'
import { TestwareView } from './TestwareView'

describe('scalable record collection', () => {
  const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
  beforeEach(() => Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true }))
  afterEach(() => {
    cleanup()
    if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView)
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  })

  it('keeps fifty records in a compact searchable master-detail workspace', async () => {
    const user = userEvent.setup()
    const drafts = Array.from({ length: 50 }, (_, index) => draftFixture({
      id: `draft-${index + 1}`,
      title: `Case ${String(index + 1).padStart(2, '0')}`,
      updatedAt: `2026-07-${String((index % 28) + 1).padStart(2, '0')}T10:00:00Z`,
    }))

    renderTestware(drafts)

    const list = screen.getByRole('complementary', { name: 'Test cases records' })
    expect(within(list).getAllByRole('button')).toHaveLength(50)
    expect(document.querySelectorAll('.record-detail-pane .editable-record')).toHaveLength(1)

    await user.type(screen.getByRole('textbox', { name: 'Search Test cases' }), 'Case 49')

    expect(within(list).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('1 of 50 test case records')
  })

  it('restores the original record when an explicit edit is discarded', async () => {
    const user = userEvent.setup()
    const onDiscardDraft = vi.fn()
    const draft = draftFixture({ title: 'Original testware' })

    renderTestware([draft], { onDiscardDraft })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(onDiscardDraft).toHaveBeenCalledWith(draft)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it.each(['finding', 'testware'] as const)('retains the %s title, Copy and keyboard editing actions in the record header', async (kind) => {
    const user = userEvent.setup()
    const title = 'Checkout validation'
    const onCopy = vi.fn(async () => undefined)
    if (kind === 'testware') renderTestware([draftFixture({ title })], { onCopy })
    else render(<FindingsView creationCommands={recordCreationCommandsFixture('finding')} busyAction={null}
      copyState={{ status: 'idle' }} findingScreenshotCounts={{}} findings={[findingFixture({ title })]}
      notice={null} error={null} isBusy={false} activeGenerationJob={null} updateLocalFinding={vi.fn()}
      onCancelGenerationJob={async () => undefined} onCopy={onCopy} onDeleteFinding={vi.fn()}
      onSaveFinding={async () => true} onDiscardFinding={vi.fn()} onUploadImage={vi.fn()} />)

    const heading = screen.getByRole('heading', { name: title })
    const header = heading.closest('header')!
    const copy = within(header).getByRole('button', { name: `Copy ${title}` })
    expect(within(header).getByRole('button', { name: `Delete ${title}` })).toBeEnabled()
    copy.focus()
    await user.keyboard('{Enter}')
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ title, target: expect.objectContaining({ kind: kind === 'finding' ? 'finding' : 'draft' }) }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(copy).toHaveFocus()
    await user.tab({ shift: true })
    const titleInput = screen.getByRole('textbox', { name: kind === 'finding' ? 'Finding title' : 'Test case title' })
    expect(titleInput).toHaveValue(title)
    expect(titleInput).toHaveFocus()
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
  })

  it('explains a collection load failure and exposes a retry action', async () => {
    const user = userEvent.setup()
    const onRetryLoad = vi.fn()

    renderTestware([], { loadState: 'error', loadError: 'Local database is busy', onRetryLoad })

    expect(screen.getByRole('heading', { name: 'Could not load test case records' })).toBeInTheDocument()
    expect(screen.getByText('Local database is busy')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetryLoad).toHaveBeenCalledOnce()
  })

  it('updates finding severity and exact Copy snapshots for same-ID content, metadata and source changes', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn(async () => undefined)
    let a = findingFixture({ id: 'finding-a', title: 'A evidence', body: '<h3>Severity</h3><p>High</p><h3>Evidence</h3><p>Original A</p>', metadataJson: '{"severity":"low"}' })
    const b = findingFixture({ id: 'finding-b', title: 'B evidence', body: '<p>B only</p>', metadataJson: '{"severity":"low","status":"in_progress"}' })
    const viewFor = (notice: string | null = null) => <FindingsView creationCommands={recordCreationCommandsFixture('finding')} busyAction={null}
      copyState={{ status: 'idle' }} findingScreenshotCounts={{}} findings={[a, b]} notice={notice} error={null} isBusy={false}
      activeGenerationJob={null} updateLocalFinding={vi.fn()} onCancelGenerationJob={async () => undefined} onCopy={onCopy}
      onDeleteFinding={vi.fn()} onSaveFinding={async () => true} onDiscardFinding={vi.fn()} onUploadImage={vi.fn()} />
    const view = render(viewFor())
    const header = (title: string) => within(screen.getByRole('heading', { name: title }).closest('header')!)
    const list = within(screen.getByRole('complementary', { name: 'Issues and risks records' }))
    expect(header('A evidence').getByText('High severity')).toBeVisible()
    expect(list.getByRole('button', { name: /A evidence/ })).toHaveTextContent('High severity')
    view.rerender(viewFor('Unrelated chat status'))
    await user.click(header('A evidence').getByRole('button', { name: 'Copy A evidence' }))
    expect(onCopy).toHaveBeenLastCalledWith({ target: { kind: 'finding', sessionId: 'session-1', id: 'finding-a', action: 'jira-text' }, title: 'A evidence', bodyHtml: '<p><strong>Severity:</strong> High</p><h3>Evidence</h3><p>Original A</p>' })

    a = { ...a, body: '<p>Changed A</p>' }
    view.rerender(viewFor())
    expect(header('A evidence').getByText('Low severity')).toBeVisible()
    await user.click(header('A evidence').getByRole('button', { name: 'Copy A evidence' }))
    expect(onCopy).toHaveBeenLastCalledWith({ target: { kind: 'finding', sessionId: 'session-1', id: 'finding-a', action: 'jira-text' }, title: 'A evidence', bodyHtml: '<p><strong>Severity:</strong> Low</p><p>Changed A</p>' })
    a = { ...a, kind: 'risk' }
    view.rerender(viewFor())
    expect(header('A evidence').getByText('Risk')).toBeVisible()
    a = { ...a, metadataJson: '{"severity":"critical","status":"closed"}' }
    view.rerender(viewFor())
    expect(header('A evidence').getByText('Critical severity')).toBeVisible()
    expect(header('A evidence').getByText('Risk')).toBeVisible()
    expect(header('A evidence').getByText('Closed')).toBeVisible()
    expect(list.getByRole('button', { name: /A evidence/ })).toHaveTextContent('Critical severity')
    await user.click(header('A evidence').getByRole('button', { name: 'Copy A evidence' }))
    expect(onCopy).toHaveBeenLastCalledWith({ target: { kind: 'finding', sessionId: 'session-1', id: 'finding-a', action: 'jira-text' }, title: 'A evidence', bodyHtml: '<p><strong>Severity:</strong> Critical</p><p>Changed A</p>' })
    a = { ...a, title: 'A renamed' }
    view.rerender(viewFor())
    await user.click(header('A renamed').getByRole('button', { name: 'Copy A renamed' }))
    expect(onCopy).toHaveBeenLastCalledWith({ target: { kind: 'finding', sessionId: 'session-1', id: 'finding-a', action: 'jira-text' }, title: 'A renamed', bodyHtml: '<p><strong>Severity:</strong> Critical</p><p>Changed A</p>' })

    a = { ...a, bodyJson: JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Severity' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Medium' }] }] } }) }
    view.rerender(viewFor())
    expect(header('A renamed').getByText('Medium severity')).toBeVisible()
    await user.click(header('A renamed').getByRole('button', { name: 'Copy A renamed' }))
    expect(onCopy).toHaveBeenLastCalledWith(expect.objectContaining({ bodyHtml: '<p><strong>Severity:</strong> Critical</p><p>Changed A</p>' }))
    a = { ...a, bodyJson: 'invalid stored JSON' }
    view.rerender(viewFor())
    expect(header('A renamed').getByText('Critical severity')).toBeVisible()

    await user.click(list.getByRole('button', { name: /B evidence/ }))
    expect(header('B evidence').getByText('Low severity')).toBeVisible()
    expect(header('B evidence').getByText('In progress')).toBeVisible()
    await user.click(header('B evidence').getByRole('button', { name: 'Copy B evidence' }))
    expect(onCopy).toHaveBeenLastCalledWith({ target: { kind: 'finding', sessionId: 'session-1', id: 'finding-b', action: 'jira-text' }, title: 'B evidence', bodyHtml: '<p><strong>Severity:</strong> Low</p><p>B only</p>' })
    expect(onCopy).toHaveBeenNthCalledWith(1, { target: { kind: 'finding', sessionId: 'session-1', id: 'finding-a', action: 'jira-text' }, title: 'A evidence', bodyHtml: '<p><strong>Severity:</strong> High</p><h3>Evidence</h3><p>Original A</p>' })
  })

  it('selects the exact created record through an excluding query, preserves sort, and acknowledges committed focus once', async () => {
    const user = userEvent.setup()
    const existing = draftFixture({ id: 'first', title: 'A saved case' })
    const created = draftFixture({ id: 'returned-id', title: 'Z created case' })
    const target: CreatedRecordEditTarget = { sessionId: 'session-1', kind: 'testware', recordId: created.id }
    const focusedTitles: string[] = []
    const consumed = vi.fn(() => focusedTitles.push((document.activeElement as HTMLInputElement).value))
    const view = render(<StrictMode>{testware([existing])}</StrictMode>)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'title')
    await user.type(screen.getByRole('textbox', { name: 'Search Test cases' }), 'A saved')
    view.rerender(<StrictMode>{testware([existing, created], { createdRecordEditTarget: target,
      onCreatedRecordEditTargetConsumed: consumed })}</StrictMode>)

    expect(screen.getByRole('textbox', { name: 'Test case title' })).toHaveValue('Z created case')
    expect(screen.getByRole('textbox', { name: 'Test case title' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Search Test cases' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('title')
    expect(focusedTitles).toEqual(['Z created case'])
    await user.click(screen.getByRole('button', { name: 'Save' }))
    view.rerender(<StrictMode>{testware([existing, created], { createdRecordEditTarget: target,
      onCreatedRecordEditTargetConsumed: consumed })}</StrictMode>)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(consumed).toHaveBeenCalledOnce()
    view.unmount()
    renderTestware([existing, created], { initialSelectedRecordId: created.id })
    expect(screen.getByRole('heading', { name: 'Z created case' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Test case title' })).not.toBeInTheDocument()
  })

  it('waits for the unfiltered returned ID and never edits a fallback record', () => {
    const existing = draftFixture({ id: 'first', title: 'Existing case' })
    const target: CreatedRecordEditTarget = { sessionId: 'session-1', kind: 'testware', recordId: 'delayed-id' }
    const consumed = vi.fn()
    const props = { createdRecordEditTarget: target, onCreatedRecordEditTargetConsumed: consumed }
    const view = renderTestware([existing], props)
    expect(screen.getByRole('heading', { name: 'Existing case' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Test case title' })).not.toBeInTheDocument()
    expect(consumed).not.toHaveBeenCalled()
    view.rerender(testware([existing, draftFixture({ id: 'delayed-id', title: 'Delayed case' })], props))
    expect(screen.getByRole('textbox', { name: 'Test case title' })).toHaveValue('Delayed case')
    expect(screen.getByRole('textbox', { name: 'Test case title' })).toHaveFocus()
    expect(consumed).toHaveBeenCalledOnce()
  })

  it('retains failed Save inputs and the original Discard snapshot across edits and refreshes', async () => {
    const user = userEvent.setup()
    const original = draftFixture({ id: 'created', title: 'Saved new case', body: '<p>Saved body.</p>' })
    const target: CreatedRecordEditTarget = { sessionId: 'session-1', kind: 'testware', recordId: original.id }
    const discarded: string[] = []
    const focusedTitles: string[] = []
    function Fixture() {
      const [draft, setDraft] = useState(original)
      return testware([draft], { createdRecordEditTarget: target, error: 'Local database is busy. Try Save again.',
        onCreatedRecordEditTargetConsumed: () => focusedTitles.push((document.activeElement as HTMLInputElement).value),
        updateLocalDraft: (_id, patch) => setDraft((current) => ({ ...current, ...patch })),
        onSaveDraft: async () => false,
        onDiscardDraft: (saved) => { discarded.push(saved.title, saved.body); setDraft(saved) } })
    }
    render(<StrictMode><Fixture /></StrictMode>)
    const title = screen.getByRole('textbox', { name: 'Test case title' })
    await user.clear(title)
    await user.type(title, 'Unsaved authored title')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(title).toHaveValue('Unsaved authored title')
    expect(screen.getByText('Local database is busy. Try Save again.')).toBeInTheDocument()
    expect(focusedTitles).toEqual(['Saved new case'])
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(discarded).toEqual(['Saved new case', '<p>Saved body.</p>'])
    expect(screen.getByRole('heading', { name: 'Saved new case' })).toBeInTheDocument()
  })


  it('restores findings hidden by a type filter and keeps query-only recovery distinct', async () => {
    const user = userEvent.setup()
    render(<FindingsView creationCommands={recordCreationCommandsFixture('finding')} busyAction={null}
      copyState={{ status: 'idle' }} findingScreenshotCounts={{}} findings={[findingFixture({ title: 'Checkout bug', kind: 'bug' })]}
      notice={null} error={null} isBusy={false} activeGenerationJob={null} updateLocalFinding={vi.fn()}
      onCancelGenerationJob={async () => undefined} onCopy={async () => undefined} onDeleteFinding={vi.fn()}
      onSaveFinding={async () => true} onDiscardFinding={vi.fn()} onUploadImage={vi.fn()} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'risk')
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('all')
    expect(screen.getByRole('heading', { name: 'Checkout bug' })).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Search Issues and risks' }), 'not present')
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByRole('heading', { name: 'Checkout bug' })).toBeInTheDocument()
  })

  it('clears the Finding type filter without changing the selected sort', async () => {
    const user = userEvent.setup()
    const existing = findingFixture({ id: 'risk', kind: 'risk' })
    const created = findingFixture({ id: 'new-bug', title: 'New bug' })
    const target: CreatedRecordEditTarget = { sessionId: 'session-1', kind: 'finding', recordId: created.id }
    const consumed = vi.fn()
    const viewFor = (creating: boolean) => <FindingsView creationCommands={recordCreationCommandsFixture('finding')} busyAction={null} copyState={{ status: 'idle' }} findingScreenshotCounts={{}} findings={creating ? [existing, created] : [existing]}
      notice={null} error={null} isBusy={false} activeGenerationJob={null} updateLocalFinding={vi.fn()}
      onCancelGenerationJob={async () => undefined} onCopy={async () => undefined}
      onDeleteFinding={vi.fn()}
      onSaveFinding={async () => true} onDiscardFinding={vi.fn()} onUploadImage={vi.fn()}
      createdRecordEditTarget={creating ? target : null} onCreatedRecordEditTargetConsumed={consumed} />
    const view = render(viewFor(false))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'risk')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'title')
    view.rerender(viewFor(true))
    expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('all')
    expect(screen.getByRole('combobox', { name: 'Sort' })).toHaveValue('title')
    expect(screen.getByRole('textbox', { name: 'Finding title' })).toHaveValue('New bug')
    expect(screen.getByRole('textbox', { name: 'Finding title' })).toHaveFocus()
    expect(consumed).toHaveBeenCalledOnce()
  })

})

function renderTestware(drafts = [draftFixture()], overrides: Partial<ComponentProps<typeof TestwareView>> = {}) {
  return render(testware(drafts, overrides))
}

function testware(drafts = [draftFixture()], overrides: Partial<ComponentProps<typeof TestwareView>> = {}) {
  return (
    <TestwareView creationCommands={recordCreationCommandsFixture('testware')}
      busyAction={null}
      copyState={{ status: 'idle' }}
      draftScreenshotCounts={{}}
      drafts={drafts}
      sessionTitle="Checkout validation"
      notice={null}
      error={null}
      isBusy={false}
      activeGenerationJob={null}
      updateLocalDraft={vi.fn()}
      onCancelGenerationJob={async () => undefined}
      onCopy={async () => undefined}
      onDeleteDraft={vi.fn()}
      onSaveDraft={async () => true}
      onDiscardDraft={vi.fn()}
      onUploadImage={vi.fn()}
      {...overrides}
    />
  )
}
