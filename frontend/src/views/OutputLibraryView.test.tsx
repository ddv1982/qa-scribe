import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  RichTextEditor: ({ ariaLabel }: { ariaLabel?: string }) => <div role="textbox" aria-label={ariaLabel} />,
}))

import { draftFixture, findingFixture } from '../test/fixtures'
import { OutputLibraryView } from './OutputLibraryView'

describe('cross-session output libraries', () => {
  afterEach(cleanup)

  it('keeps Session provenance visible and opens the selected Testware in its owner', async () => {
    const user = userEvent.setup()
    const onOpenRecord = vi.fn()
    render(
      <OutputLibraryView
        kind="testware"
        draftItems={[
          { draft: draftFixture({ id: 'draft-checkout', sessionId: 'session-checkout', title: 'Checkout cases' }), sessionTitle: 'Checkout exploratory' },
          { draft: draftFixture({ id: 'draft-recovery', sessionId: 'session-recovery', title: 'Recovery cases' }), sessionTitle: 'Account recovery' },
        ]}
        loadState="ready"
        loadError={null}
        onRetry={vi.fn()}
        onOpenRecord={onOpenRecord}
      />,
    )

    const list = screen.getByRole('complementary', { name: 'Testware library records' })
    expect(within(list).getByRole('button', { name: /checkout cases.*checkout exploratory/i })).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Session' }), 'session-recovery')
    expect(within(list).getAllByRole('button')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Open in Session' }))
    expect(onOpenRecord).toHaveBeenCalledWith('session-recovery', 'draft-recovery')
  })

  it('filters Finding types and offers recovery after a load error', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = render(
      <OutputLibraryView kind="findings" loadState="error" loadError="Database temporarily unavailable" onRetry={onRetry} onOpenRecord={vi.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(
      <OutputLibraryView
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
