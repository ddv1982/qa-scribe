import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { draftFixture, findingFixture } from '../test/fixtures'
import { copyHtmlToClipboard } from '../tauri'
import { useCopyActions, type ClipboardSnapshot } from '../app/copyActions'

vi.mock('../tauri', async (importOriginal) => ({ ...await importOriginal<typeof import('../tauri')>(), copyHtmlToClipboard: vi.fn() }))
const nativeText = vi.mocked(copyHtmlToClipboard)

import { OutputLibraryView } from './OutputLibraryView'

describe('cross-session output libraries', () => {
  afterEach(cleanup)

  it('keeps Session provenance visible and opens the selected Testware in its owner', async () => {
    const user = userEvent.setup()
    const onOpenRecord = vi.fn()
    render(
      <OutputLibraryView copyState={{ status: 'idle' }} onCopy={async () => undefined} isBusy={false}
        kind="testware"
        draftItems={[
          {
            draft: draftFixture({ id: 'draft-checkout', sessionId: 'session-checkout', title: 'Checkout cases', body: '<p>Checkout coverage.</p>' }),
            sessionTitle: 'Checkout exploratory',
          },
          {
            draft: draftFixture({ id: 'draft-recovery', sessionId: 'session-recovery', title: 'Recovery cases', body: '<p>Recovery coverage.</p>' }),
            sessionTitle: 'Account recovery',
          },
        ]}
        loadState="ready"
        loadError={null}
        onRetry={vi.fn()}
        onOpenRecord={onOpenRecord}
      />,
    )

    const list = screen.getByRole('complementary', { name: 'Test cases library records' })
    expect(within(list).getByRole('button', { name: /checkout cases.*checkout exploratory/i })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session' }), 'session-recovery')
    expect(within(list).getAllByRole('button')).toHaveLength(1)
    expect(await screen.findByRole('textbox', { name: 'Recovery cases preview' })).toHaveTextContent('Recovery coverage.')
    await user.click(screen.getByRole('button', { name: 'Open in Session' }))
    expect(onOpenRecord).toHaveBeenCalledWith('session-recovery', 'draft-recovery')
  })

  it('distinguishes and opens duplicate-titled Testware records independently', async () => {
    const user = userEvent.setup()
    const onOpenRecord = vi.fn()
    const generationMetadata = (depth: 'lean' | 'balanced') => JSON.stringify({
      testwareGeneration: {
        technique: 'auto',
        outputFormat: 'qa_cases',
        depth,
        includeNegativeCases: true,
        includeBoundaryCases: true,
        includeTestData: false,
        preserveEvidence: true,
        customInstructions: null,
      },
    })
    render(
      <OutputLibraryView copyState={{ status: 'idle' }} onCopy={async () => undefined} isBusy={false}
        kind="testware"
        draftItems={[
          {
            draft: draftFixture({
              id: 'draft-newer',
              title: 'Gmail login cases',
              updatedAt: '2026-06-24T20:26:01.255Z',
              metadataJson: generationMetadata('balanced'),
            }),
            sessionTitle: 'Gmail login',
          },
          {
            draft: draftFixture({
              id: 'draft-older',
              title: 'Gmail login cases',
              updatedAt: '2026-06-24T19:19:50.281Z',
              metadataJson: generationMetadata('lean'),
            }),
            sessionTitle: 'Gmail login',
          },
        ]}
        loadState="ready"
        loadError={null}
        onRetry={vi.fn()}
        onOpenRecord={onOpenRecord}
      />,
    )

    const list = screen.getByRole('complementary', { name: 'Test cases library records' })
    const balancedRecord = within(list).getByRole('button', { name: /gmail login cases.*balanced/i })
    const leanRecord = within(list).getByRole('button', { name: /gmail login cases.*lean/i })
    expect(balancedRecord).not.toHaveAccessibleName(leanRecord.getAttribute('aria-label') ?? leanRecord.textContent ?? '')

    await user.click(leanRecord)
    await user.click(screen.getByRole('button', { name: 'Open in Session' }))
    expect(onOpenRecord).toHaveBeenLastCalledWith('session-1', 'draft-older')

    await user.click(balancedRecord)
    await user.click(screen.getByRole('button', { name: 'Open in Session' }))
    expect(onOpenRecord).toHaveBeenLastCalledWith('session-1', 'draft-newer')
  })

  it('filters Finding types and offers recovery after a load error', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = render(
      <OutputLibraryView copyState={{ status: 'idle' }} onCopy={async () => undefined} isBusy={false} kind="findings" loadState="error" loadError="Database temporarily unavailable" onRetry={onRetry} onOpenRecord={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(
      <OutputLibraryView copyState={{ status: 'idle' }} onCopy={async () => undefined} isBusy={false}
        kind="findings"
        findingItems={[
          { finding: findingFixture({ id: 'bug-1', kind: 'bug', title: 'Checkout fails' }), sessionTitle: 'Checkout exploratory' },
          { finding: findingFixture({ id: 'risk-1', kind: 'risk', title: 'Email delay' }), sessionTitle: 'Account recovery' },
        ]}
        loadState="ready"
        loadError={null}
        onRetry={onRetry}
        onOpenRecord={vi.fn()}
      />,
    )
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'risk')
    expect(screen.getByRole('status')).toHaveTextContent('1 of 2 records')
    expect(screen.getByRole('complementary', { name: 'Findings library records' })).toHaveTextContent('Email delay')
  })
})

function CopyingLibrary({ onActivate = () => {}, ...props }: Omit<React.ComponentProps<typeof OutputLibraryView>, 'copyState' | 'onCopy' | 'isBusy'> & { onActivate?: (snapshot: ClipboardSnapshot) => void }) {
  const actions = useCopyActions()
  return <OutputLibraryView {...props} copyState={actions.copyState} isBusy={false} onCopy={(snapshot) => { onActivate(snapshot); return actions.copy(snapshot) }} />
}

describe('saved library clipboard boundary', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); vi.unstubAllGlobals() })

  it('copies duplicate-title saved rows with tuple identity and literal rich/plain flavors through the real exporter', async () => {
    const user = userEvent.setup()
    const onOpenRecord = vi.fn()
    const onActivate = vi.fn()
    nativeText.mockResolvedValue(undefined)
    const items = [
      { draft: draftFixture({ id: 'same-id', sessionId: 'alpha', title: 'Same', body: '<p><strong>Saved A</strong></p>' }), sessionTitle: 'Alpha' },
      { draft: draftFixture({ id: 'same-id', sessionId: 'beta', title: 'Same', body: '<p>Saved B</p>' }), sessionTitle: 'Beta' },
    ]
    render(<CopyingLibrary kind="testware" draftItems={items} loadState="ready" loadError={null} onRetry={vi.fn()} onOpenRecord={onOpenRecord} onActivate={onActivate} />)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'session')
    const list = screen.getByRole('complementary', { name: 'Test cases library records' })
    await user.click(within(list).getByRole('button', { name: /Same.*Beta/ }))
    await user.click(screen.getByRole('button', { name: 'Copy Same' }))
    expect(onActivate.mock.calls).toEqual([[{ target: { kind: 'draft', sessionId: 'beta', id: 'same-id', action: 'jira-text' }, title: 'Same', bodyHtml: '<p>Saved B</p>' }]])
    expect(nativeText.mock.calls).toEqual([['<h2>Same</h2><p>Saved B</p>', '## Same\n\nSaved B']])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session' }), 'alpha')
    await user.type(screen.getByRole('textbox', { name: 'Search Test cases library' }), 'Saved A')
    await user.click(screen.getByRole('button', { name: 'Copy Same' }))
    expect(onActivate.mock.calls[1]).toEqual([{ target: { kind: 'draft', sessionId: 'alpha', id: 'same-id', action: 'jira-text' }, title: 'Same', bodyHtml: '<p><strong>Saved A</strong></p>' }])
    expect(nativeText.mock.calls[1]).toEqual(['<h2>Same</h2><p><strong>Saved A</strong></p>', '## Same\n\n**Saved A**'])
    expect(onOpenRecord).not.toHaveBeenCalled()
  })

  it('keeps saved HTML export when the Finding preview prefers divergent JSON and requires the Finding source kind', async () => {
    const user = userEvent.setup()
    nativeText.mockResolvedValue(undefined)
    const onActivate = vi.fn()
    render(<CopyingLibrary kind="findings" findingItems={[{ finding: findingFixture({ id: 'same-id', sessionId: 'alpha', title: 'Same', body: '<p>Saved finding</p>', bodyJson: JSON.stringify({ schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Different JSON preview' }] }] } }), bodyFormat: 'tiptap_json' }), sessionTitle: 'Alpha' }]}
      loadState="ready" loadError={null} onRetry={vi.fn()} onOpenRecord={vi.fn()} onActivate={onActivate} />)
    expect(screen.getByRole('textbox', { name: 'Same preview' })).toHaveTextContent('Different JSON preview')
    await user.click(screen.getByRole('button', { name: 'Copy Same' }))
    expect(onActivate.mock.calls).toEqual([[{ target: { kind: 'finding', sessionId: 'alpha', id: 'same-id', action: 'jira-text' }, title: 'Same', bodyHtml: '<p>Saved finding</p>' }]])
    expect(nativeText.mock.calls).toEqual([['<h2>Same</h2><p>Saved finding</p>', '## Same\n\nSaved finding']])
  })

  it('does not attribute a delayed result to another selection or refreshed content', async () => {
    const user = userEvent.setup()
    let resolve!: () => void
    nativeText.mockReturnValueOnce(new Promise<void>((yes) => { resolve = yes }))
    const first = { draft: draftFixture({ id: 'one', sessionId: 'alpha', title: 'Same', body: '<p>Old content</p>' }), sessionTitle: 'Alpha' }
    const second = { draft: draftFixture({ id: 'two', sessionId: 'alpha', title: 'Same', body: '<p>Second content</p>' }), sessionTitle: 'Alpha' }
    const props = { kind: 'testware' as const, loadState: 'ready' as const, loadError: null, onRetry: vi.fn(), onOpenRecord: vi.fn() }
    const { rerender } = render(<CopyingLibrary {...props} draftItems={[first, second]} />)
    await user.click(screen.getByRole('button', { name: 'Copy Same' }))
    first.draft.body = '<p>Mutated after activation</p>'
    await user.click(within(screen.getByRole('complementary')).getAllByRole('button')[1])
    expect(screen.getByRole('button', { name: 'Copy Same' })).toBeDisabled()
    await act(async () => { resolve() })
    expect(screen.queryByRole('button', { name: 'Same copied' })).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('complementary')).getAllByRole('button')[0])
    rerender(<CopyingLibrary {...props} draftItems={[{ ...first, draft: { ...first.draft, body: '<p>Refreshed content</p>' } }, second]} />)
    expect(screen.queryByRole('button', { name: 'Same copied' })).not.toBeInTheDocument()
    expect(nativeText.mock.calls).toEqual([['<h2>Same</h2><p>Old content</p>', '## Same\n\nOld content']])
    expect(props.onOpenRecord).not.toHaveBeenCalled()
  })

  it('retains a delayed failure only on its original row and permits an explicit retry', async () => {
    const user = userEvent.setup()
    let reject!: (cause: Error) => void
    nativeText.mockReturnValueOnce(new Promise<void>((_resolve, no) => { reject = no }))
    vi.stubGlobal('ClipboardItem', undefined)
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Browser rejected'))
    const items = [
      { draft: draftFixture({ id: 'one', title: 'Same', body: '<p>First</p>' }), sessionTitle: 'Alpha' },
      { draft: draftFixture({ id: 'two', title: 'Same', body: '<p>Second</p>' }), sessionTitle: 'Beta' },
    ]
    render(<CopyingLibrary kind="testware" draftItems={items} loadState="ready" loadError={null} onRetry={vi.fn()} onOpenRecord={vi.fn()} />)
    const rows = within(screen.getByRole('complementary')).getAllByRole('button')
    await user.click(screen.getByRole('button', { name: 'Copy Same' }))
    await user.click(rows[1])
    await act(async () => { reject(new Error('Native rejected')) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Same copied' })).not.toBeInTheDocument()
    await user.click(rows[0])
    expect(screen.getByRole('alert')).toHaveTextContent('Copy failed: Something went wrong: Browser rejected')
    nativeText.mockResolvedValueOnce(undefined)
    await user.click(screen.getByRole('button', { name: 'Copy Same' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Same copied' })).toHaveTextContent('Copied')
  })
})
