import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { ActionButton } from './ActionButton'

afterEach(cleanup)

describe('ActionButton native behavior', () => {
  it('does not submit its enclosing form by default and forwards click and keyboard events', async () => {
    const user = userEvent.setup()
    const submit = vi.fn((event: FormEvent) => event.preventDefault())
    const click = vi.fn()
    const key = vi.fn()
    render(<form onSubmit={submit}><ActionButton onClick={click} onKeyDown={key}>Keep editing</ActionButton></form>)
    const button = screen.getByRole('button', { name: 'Keep editing' })
    await user.click(button)
    await user.keyboard('{Enter}')
    expect(button).toHaveAttribute('type', 'button')
    expect(click).toHaveBeenCalledTimes(2)
    expect(key).toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('supports submit buttons and forwards form data attributes', async () => {
    const user = userEvent.setup()
    const submit = vi.fn((event: FormEvent) => event.preventDefault())
    render(<form id="draft" onSubmit={submit}><ActionButton type="submit" name="intent" value="save" form="draft">Save draft</ActionButton></form>)
    await user.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button')).toHaveAttribute('name', 'intent')
    expect(screen.getByRole('button')).toHaveAttribute('value', 'save')
    expect(screen.getByRole('button')).toHaveAttribute('form', 'draft')
  })

  it.each([{ disabled: true }, { loading: true }])('blocks pointer and keyboard submission when %j', async (state) => {
    const user = userEvent.setup()
    const submit = vi.fn((event: FormEvent) => event.preventDefault())
    const click = vi.fn()
    render(<form onSubmit={submit}><ActionButton type="submit" onClick={click} {...state}>Save draft</ActionButton></form>)
    const button = screen.getByRole('button', { name: 'Save draft' })
    await user.click(button)
    button.focus()
    await user.keyboard('{Enter}{Space}')
    expect(button).toBeDisabled()
    expect(click).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('retains the visible label and announces busy until the caller settles', () => {
    const { rerender } = render(<ActionButton loading>Save draft</ActionButton>)
    const button = screen.getByRole('button', { name: 'Save draft' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveTextContent('Save draft')
    rerender(<ActionButton loading={false}>Save draft</ActionButton>)
    expect(button).toBeEnabled()
    expect(button).not.toHaveAttribute('aria-busy')
  })

  it('names icon-only actions without exposing decorative SVGs', async () => {
    const user = userEvent.setup()
    const remove = vi.fn()
    render(<ActionButton iconOnly icon={Trash2} aria-label="Delete finding" variant="destructive-quiet" onClick={remove} />)
    await user.click(screen.getByRole('button', { name: 'Delete finding' }))
    expect(remove).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
