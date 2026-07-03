import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenerationPreflight } from './generationPreflight'

function renderPreflight(overrides: Partial<Parameters<typeof GenerationPreflight>[0]> = {}) {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <GenerationPreflight
      action="summary"
      activeProviderAvailable
      activeProviderLabel="Codex CLI"
      isBusy={false}
      noteScreenshotCount={0}
      noteTitle="Checkout"
      noteWordCount={12}
      selectedModel="default"
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  )
  return { onCancel, onConfirm }
}

describe('GenerationPreflight modal accessibility', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('moves focus into the dialog on open', () => {
    renderPreflight()
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('Escape invokes cancel', async () => {
    const user = userEvent.setup()
    const { onCancel } = renderPreflight()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('returns focus to the trigger when the dialog unmounts', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = render(
      <GenerationPreflight
        action="summary"
        activeProviderAvailable
        activeProviderLabel="Codex CLI"
        isBusy={false}
        noteScreenshotCount={0}
        noteTitle="Checkout"
        noteWordCount={12}
        selectedModel="default"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(document.activeElement).not.toBe(trigger)

    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
