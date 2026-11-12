import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Field } from './Field'

afterEach(cleanup)

describe('Field', () => {
  it('names its control by the label text', () => {
    render(<Field label="Severity"><select><option>Low</option></select></Field>)
    const select = screen.getByRole('combobox', { name: 'Severity' })
    expect(select.closest('label')).toHaveClass('field')
    expect(screen.getByText('Severity')).toHaveClass('field-label')
    expect(select).not.toHaveAttribute('aria-describedby')
    expect(select).not.toHaveAttribute('aria-invalid')
  })

  it('keeps an explicit aria-label as the name and links the hint', () => {
    render(<Field label="Template" hint="Steps, expected and actual." className="creation-format">
      <select aria-label="Finding template"><option>Bug</option></select>
    </Field>)
    const select = screen.getByRole('combobox', { name: 'Finding template' })
    expect(select).toHaveAccessibleDescription('Steps, expected and actual.')
    expect(select).not.toHaveAttribute('aria-invalid')
    expect(select.closest('label')).toHaveClass('field', 'creation-format')
  })

  it('links the error and marks the control invalid', () => {
    render(<Field label="Title" hint="Shown in the list." error="A title is required."><input /></Field>)
    const input = screen.getByRole('textbox')
    expect(input).toHaveAccessibleDescription('Shown in the list. A title is required.')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('A title is required.')).toHaveClass('field-error')
  })
})
