import '@testing-library/jest-dom/vitest'
import userEvent from '@testing-library/user-event'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeleteConfirmationDialog } from './AppShell'
import { PendingChangesDialog } from './AppOverlays'
import { deleteConfirmationCopy } from '../workflows/deleteConfirmation'
import { draftFixture, findingFixture, sessionFixture } from '../test/fixtures'
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
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
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

describe('UC-0 pending changes actions', () => {
  afterEach(cleanup)

  it('orders ordinary discard separately from Keep editing and Save, with safe focus', async () => {
    const user = userEvent.setup()
    const cancel = vi.fn()
    const discard = vi.fn()
    const save = vi.fn()
    render(<PendingChangesDialog isBusy={false} onCancel={cancel} onDiscard={discard} onSave={save} />)
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Discard changes', 'Keep editing', 'Save and continue'])
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(discard).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps the exact recovery choice routing, recovered=%s', async (recoveredSummaryConflict) => {
    const user = userEvent.setup()
    const discard = vi.fn()
    const save = vi.fn()
    render(<PendingChangesDialog recoveredSummaryConflict={recoveredSummaryConflict} isBusy={false} onCancel={vi.fn()} onDiscard={discard} onSave={save} />)
    await user.click(screen.getByRole('button', { name: recoveredSummaryConflict ? 'Keep generated Summary' : 'Discard changes' }))
    expect(discard).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: recoveredSummaryConflict ? 'Restore authored text' : 'Save and continue' }))
    expect(save).toHaveBeenCalledTimes(1)
    if (recoveredSummaryConflict) {
      expect(screen.getByText('A recovered Summary replaced locally authored text. Restore the authored text, keep the visible generated Summary and its edits, or stay here. Keeping the Summary also discards any other unsaved changes.')).toBeInTheDocument()
    }
  })

  it('blocks repeated decisions while settlement is busy and keeps Escape cancellation', async () => {
    const user = userEvent.setup()
    const cancel = vi.fn()
    const discard = vi.fn()
    const save = vi.fn()
    render(<PendingChangesDialog isBusy onCancel={cancel} onDiscard={discard} onSave={save} />)
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
      await user.click(button)
    }
    simulateDialogCancel(screen.getByRole('dialog'))
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(discard).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('UC-0 deletion target and consequence copy', () => {
  afterEach(cleanup)
  it.each([
    { confirmation: { kind: 'finding', finding: findingFixture({ title: 'Checkout finding' }) } as const,
      title: 'Delete "Checkout finding"?', body: 'This removes this finding and its evidence links. Source notes and attachments are kept. This cannot be undone.', label: 'Delete finding permanently' },
    { confirmation: { kind: 'draft', draft: draftFixture({ title: 'Checkout cases' }) } as const,
      title: 'Delete "Checkout cases"?', body: 'This removes this testware draft only. AI run history is kept. This cannot be undone.', label: 'Delete testware permanently' },
    { confirmation: { kind: 'session', session: sessionFixture({ title: 'Checkout Session' }) } as const,
      title: 'Delete “Checkout Session”?', body: 'This removes the Session, its Note Entry, testware, findings, and attachments. This cannot be undone.', label: 'Delete Session permanently' },
  ])('preserves $label identity and consequences', async ({ confirmation, title, body, label }) => {
    const confirm = vi.fn()
    const user = userEvent.setup()
    render(<DeleteConfirmationDialog copy={deleteConfirmationCopy(confirmation)} isBusy={false} onCancel={vi.fn()} onConfirm={confirm} />)
    expect(screen.getByRole('heading')).toHaveTextContent(title)
    expect(screen.getByText(body)).toBeInTheDocument()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Cancel', label])
    await user.click(screen.getByRole('button', { name: label }))
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
