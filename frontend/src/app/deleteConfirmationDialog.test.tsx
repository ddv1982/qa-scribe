import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteConfirmationDialog } from './AppShell'
import { PendingChangesDialog } from './AppOverlays'
import { simulateDialogCancel } from '../test/dialogPolyfill'

const copy = { title: 'Delete this note?', body: 'This cannot be undone.', confirmLabel: 'Delete note' }

describe('DeleteConfirmationDialog accessibility', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('opens as a modal dialog and moves focus into it', () => {
    render(<DeleteConfirmationDialog copy={copy} isBusy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />)
    const dialog = screen.getByRole<HTMLDialogElement>('dialog')
    expect(dialog.open).toBe(true)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('the native cancel event (Escape) invokes onCancel, not onConfirm', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<DeleteConfirmationDialog copy={copy} isBusy={false} onCancel={onCancel} onConfirm={onConfirm} />)
    const dialog = screen.getByRole<HTMLDialogElement>('dialog')
    simulateDialogCancel(dialog)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('returns focus to the trigger when the dialog unmounts', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = render(<DeleteConfirmationDialog copy={copy} isBusy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(document.activeElement).not.toBe(trigger)
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})

describe('PendingChangesDialog recovery conflict', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('explains the recovered Summary outcomes with explicit actions', () => {
    render(
      <PendingChangesDialog
        recoveredSummaryConflict
        isBusy={false}
        onCancel={vi.fn()}
        onDiscard={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Choose which Note to keep' })).toBeTruthy()
    expect(screen.getByText(/recovered Summary replaced locally authored text/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Keep generated Summary' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restore authored text' })).toBeTruthy()
  })
})
