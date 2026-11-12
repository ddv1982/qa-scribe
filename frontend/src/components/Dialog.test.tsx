import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { ActionButton } from './ActionButton'
import { Dialog } from './Dialog'
import { simulateDialogCancel } from '../test/dialogPolyfill'

afterEach(cleanup)

function actions(onCancel = vi.fn()) {
  return <><ActionButton onClick={onCancel}>Cancel</ActionButton><ActionButton variant="primary">Apply</ActionButton></>
}

describe('Dialog', () => {
  it('opens modally, named by its title and described by its description', () => {
    render(<Dialog eyebrow="Confirm" title="Replace the draft?" description={<p>This replaces the body.</p>} onCancel={vi.fn()} actions={actions()}>
      <p>Extra body</p>
    </Dialog>)
    const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Replace the draft?' })
    expect(dialog.open).toBe(true)
    expect(dialog).toHaveAccessibleDescription('This replaces the body.')
    expect(dialog).toHaveClass('confirmation-dialog')
    expect(screen.getByText('Confirm')).toHaveClass('eyebrow')
    expect(screen.getByRole('button', { name: 'Cancel' }).parentElement).toHaveClass('confirmation-actions')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('keeps a caller-supplied title id and extra classes', () => {
    render(<Dialog titleId="prefill-title" className="generation-preflight" headerClassName="preflight-header" title="Use this Note?" onCancel={vi.fn()} actions={actions()} />)
    const heading = screen.getByRole('heading', { name: 'Use this Note?' })
    expect(heading).toHaveAttribute('id', 'prefill-title')
    expect(heading.parentElement).toHaveClass('preflight-header')
    expect(screen.getByRole('dialog')).toHaveClass('confirmation-dialog', 'generation-preflight')
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby')
  })

  it('routes Escape to onCancel', () => {
    const onCancel = vi.fn()
    render(<Dialog title="Delete?" onCancel={onCancel} actions={actions()} />)
    simulateDialogCancel(screen.getByRole<HTMLDialogElement>('dialog'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('focuses the given element or the title first', () => {
    function SafeFirst() {
      const keepRef = useRef<HTMLButtonElement>(null)
      return <Dialog title="Leave?" initialFocus={keepRef} onCancel={vi.fn()}
        actions={<><ActionButton>Discard</ActionButton><ActionButton ref={keepRef}>Keep editing</ActionButton></>} />
    }
    render(<SafeFirst />)
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    cleanup()

    render(<Dialog title="Generate?" initialFocus="title" onCancel={vi.fn()} actions={actions()} />)
    const heading = screen.getByRole('heading', { name: 'Generate?' })
    expect(heading).toHaveAttribute('tabindex', '-1')
    expect(heading).toHaveFocus()
  })

  it('renders into document.body when portaled', () => {
    const { container } = render(<Dialog portal title="Portaled" onCancel={vi.fn()} actions={actions()} />)
    const dialog = screen.getByRole('dialog', { name: 'Portaled' })
    expect(container).not.toContainElement(dialog)
    expect(dialog.parentElement).toBe(document.body)
  })
})
