import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClipboardSnapshot } from '../app/copyActions'
import { CopyControls, RichRecordActions } from './RichRecordView'

const snapshot: ClipboardSnapshot = { target: { kind: 'finding', sessionId: 'session-1', id: 'finding-1', action: 'jira-text' }, title: 'Case', bodyHtml: '<p>Saved</p>' }
afterEach(cleanup)
describe('shared copy controls', () => {
  it.each([1, 3])('labels the first screenshot accurately for %i managed images and preserves source data', async (screenshotCount) => {
    const user = userEvent.setup()
    const onCopy = vi.fn().mockResolvedValue(undefined)
    render(<CopyControls snapshot={snapshot} copyState={{ status: 'idle' }} onCopy={onCopy} label="Case" screenshotCount={screenshotCount} />)
    expect(screen.getByRole('button', { name: 'Copy Case for Jira' })).toHaveTextContent('Copy for Jira')
    await user.click(screen.getByRole('button', { name: 'Copy first Case screenshot for Jira' }))
    expect(onCopy.mock.calls).toEqual([[{ target: { kind: 'finding', sessionId: 'session-1', id: 'finding-1', action: 'screenshot' }, title: 'Case', bodyHtml: '<p>Saved</p>' }]])
    expect(screen.getByRole('button', { name: 'Copy first Case screenshot for Jira' })).toHaveTextContent('Copy first screenshot')
  })

  it('disables every Copy while pending without marking Edit or Delete busy', () => {
    render(<RichRecordActions copyControls={<CopyControls snapshot={snapshot} copyState={{ status: 'pending', snapshot }} onCopy={vi.fn()} label="Case" screenshotCount={2} />}
      deleting={false} deleteLabel="Delete Case" deleteTitle="Delete Finding" editing={false} isBusy={false} saving={false}
      onDelete={vi.fn()} onEdit={vi.fn()} onSave={vi.fn()} onCancelEdit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Copy Case for Jira' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Copy first Case screenshot for Jira' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete Case' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Copy in progress')
  })

  it('keeps failures local to source and content and keeps retry visible', () => {
    const state = { status: 'failed' as const, snapshot, error: 'Clipboard unavailable' }
    const { rerender } = render(<CopyControls snapshot={snapshot} copyState={state} onCopy={vi.fn()} label="Case" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Copy for Jira failed: Clipboard unavailable')
    expect(screen.getByRole('button', { name: 'Copy Case for Jira' })).toBeEnabled()
    rerender(<CopyControls snapshot={{ ...snapshot, bodyHtml: '<p>Edited</p>' }} copyState={state} onCopy={vi.fn()} label="Case" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Copied for Jira')).not.toBeInTheDocument()
  })
})
