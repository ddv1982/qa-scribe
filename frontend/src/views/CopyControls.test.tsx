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
    const copy = screen.getByRole('button', { name: 'Copy Case' })
    expect(copy).toHaveAttribute('data-tooltip', 'Copy')
    expect(copy.textContent).toBe('')
    await user.click(screen.getByRole('button', { name: 'Copy first Case screenshot' }))
    expect(onCopy.mock.calls).toEqual([[{ target: { kind: 'finding', sessionId: 'session-1', id: 'finding-1', action: 'screenshot' }, title: 'Case', bodyHtml: '<p>Saved</p>' }]])
    expect(screen.getByRole('button', { name: 'Copy first Case screenshot' })).toHaveAttribute('data-tooltip', 'Copy first screenshot')
    // The screenshot icon sits left of Copy, so Copy is the corner.
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Copy first Case screenshot', 'Copy Case'])
  })

  it('disables every Copy while pending without marking Edit or Delete busy', () => {
    render(<><CopyControls snapshot={snapshot} copyState={{ status: 'pending', snapshot }} onCopy={vi.fn()} label="Case" screenshotCount={2} />
      <RichRecordActions deleting={false} deleteLabel="Delete Case" deleteTitle="Delete Finding" editing={false} isBusy={false} saving={false}
      onDelete={vi.fn()} onEdit={vi.fn()} onSave={vi.fn()} onCancelEdit={vi.fn()} /></>)
    expect(screen.getByRole('button', { name: 'Copy Case' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Copy Case' })).toHaveAttribute('data-tooltip', 'Copying')
    expect(screen.getByRole('button', { name: 'Copy first Case screenshot' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete Case' })).toBeEnabled()
    expect(screen.getByRole('status')).toHaveTextContent('Copy in progress')
  })

  it('keeps failures local to source and content and keeps retry visible', () => {
    const state = { status: 'failed' as const, snapshot, error: 'Clipboard unavailable' }
    const { rerender } = render(<CopyControls snapshot={snapshot} copyState={state} onCopy={vi.fn()} label="Case" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Copy failed: Clipboard unavailable')
    expect(screen.getByRole('button', { name: 'Copy Case' })).toBeEnabled()
    rerender(<CopyControls snapshot={{ ...snapshot, bodyHtml: '<p>Edited</p>' }} copyState={state} onCopy={vi.fn()} label="Case" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
  })

  it.each([
    ['text', 'jira-text', 'Case copied', 'Copied'],
    ['screenshot', 'screenshot', 'Case screenshot copied', 'Screenshot copied'],
  ] as const)('says the %s copy worked in a tooltip shown without hover', (_, action, name, tooltip) => {
    const copied = { ...snapshot, target: { ...snapshot.target, action } }
    render(<CopyControls snapshot={snapshot} copyState={{ status: 'succeeded', snapshot: copied }} onCopy={vi.fn()} label="Case" screenshotCount={1} />)
    const button = screen.getByRole('button', { name })
    expect(button).toHaveAttribute('data-tooltip', tooltip)
    expect(button).toHaveAttribute('data-tooltip-open')
    expect(button).toHaveAttribute('data-copied')
    expect(button).toHaveClass('action-button--quiet')
    expect(screen.getAllByRole('button').filter((other) => other !== button).every((other) => !other.hasAttribute('data-tooltip-open'))).toBe(true)
    expect(screen.getByRole('status')).toHaveTextContent(action === 'screenshot' ? 'First screenshot copied' : 'Copied')
  })
})
