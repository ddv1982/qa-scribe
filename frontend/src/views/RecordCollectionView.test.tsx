import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../editor/RichTextEditor', () => ({
  FormatToolbar: () => <div data-testid="format-toolbar" />,
  RichTextEditor: ({ ariaLabel }: { ariaLabel?: string }) => <div role="textbox" aria-label={ariaLabel} />,
}))

import { draftFixture } from '../test/fixtures'
import type { Draft } from '../tauri'
import { TestwareView } from './TestwareView'

describe('scalable record collection', () => {
  afterEach(cleanup)

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
    expect(screen.getByRole('status')).toHaveTextContent('1 of 50 testware records')
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

  it('explains a collection load failure and exposes a retry action', async () => {
    const user = userEvent.setup()
    const onRetryLoad = vi.fn()

    renderTestware([], { loadState: 'error', loadError: 'Local database is busy', onRetryLoad })

    expect(screen.getByRole('heading', { name: 'Could not load testware records' })).toBeInTheDocument()
    expect(screen.getByText('Local database is busy')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetryLoad).toHaveBeenCalledOnce()
  })
})

function renderTestware(
  drafts = [draftFixture()],
  overrides: {
    onDiscardDraft?: (draft: Draft) => void
    loadState?: 'idle' | 'loading' | 'ready' | 'error'
    loadError?: string | null
    onRetryLoad?: () => void
  } = {},
) {
  render(
    <TestwareView
      busyAction={null}
      copiedDraftId={null}
      copiedDraftScreenshotId={null}
      draftScreenshotCounts={{}}
      drafts={drafts}
      sessionTitle="Checkout validation"
      notice={null}
      error={null}
      isBusy={false}
      activeGenerationJob={null}
      loadState={overrides.loadState}
      loadError={overrides.loadError}
      onRetryLoad={overrides.onRetryLoad}
      updateLocalDraft={vi.fn()}
      onCancelGenerationJob={async () => undefined}
      onCopyDraft={async () => undefined}
      onCopyDraftScreenshot={async () => undefined}
      onDeleteDraft={vi.fn()}
      onPrefillFromNote={async () => undefined}
      onSaveDraft={async () => true}
      onDiscardDraft={overrides.onDiscardDraft ?? vi.fn()}
      onUploadImage={vi.fn()}
    />,
  )
}
