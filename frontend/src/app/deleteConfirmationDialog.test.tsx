import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteConfirmationDialog } from './AppShell'

const copy = { title: 'Delete this note?', body: 'This cannot be undone.', confirmLabel: 'Delete note' }

describe('DeleteConfirmationDialog accessibility', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('moves focus into the dialog on open', () => {
    render(<DeleteConfirmationDialog copy={copy} isBusy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Escape invokes cancel (not confirm)', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<DeleteConfirmationDialog copy={copy} isBusy={false} onCancel={onCancel} onConfirm={onConfirm} />)
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('traps Tab focus within the dialog', async () => {
    const user = userEvent.setup()
    render(<DeleteConfirmationDialog copy={copy} isBusy={false} onCancel={vi.fn()} onConfirm={vi.fn()} />)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Delete note' })

    cancel.focus()
    await user.tab()
    expect(document.activeElement).toBe(confirm)
    // Wrapping forward from the last control returns to the first.
    await user.tab()
    expect(document.activeElement).toBe(cancel)
    // Wrapping backward from the first control jumps to the last.
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(confirm)
  })
})
