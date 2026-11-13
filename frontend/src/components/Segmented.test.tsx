import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Segmented, type SegmentedOption } from './Segmented'
import { ThemeToggle } from './ThemeToggle'

afterEach(cleanup)

const options: SegmentedOption<'passed' | 'failed'>[] = [
  { value: 'passed', label: 'Passed', tone: 'success' },
  { value: 'failed', label: 'Failed', tone: 'danger' },
]

describe('Segmented', () => {
  it('is a named group of toggle buttons with at most one pressed', () => {
    render(<Segmented label="Result" options={options} value="failed" onChange={vi.fn()} />)
    const group = screen.getByRole('group', { name: 'Result' })
    expect(within(group).getByRole('button', { name: 'Passed' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getByRole('button', { name: 'Failed' })).toHaveAttribute('aria-pressed', 'true')
    cleanup()
    render(<Segmented label="Result" options={options} value={null} onChange={vi.fn()} />)
    for (const button of screen.getAllByRole('button')) expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports the option pressed', () => {
    const onChange = vi.fn()
    render(<Segmented label="Result" options={options} value="failed" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Passed' }))
    expect(onChange).toHaveBeenCalledWith('passed')
  })

  it('reports null when the pressed option is pressed again, only with allowDeselect', () => {
    const onChange = vi.fn()
    render(<Segmented label="Result" options={options} value="failed" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    expect(onChange).not.toHaveBeenCalled()
    cleanup()
    render(<Segmented label="Result" allowDeselect options={options} value="failed" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('disables every option', () => {
    render(<Segmented label="Result" disabled options={options} value={null} onChange={vi.fn()} />)
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })
})

describe('ThemeToggle on Segmented', () => {
  it('keeps its names and pressed state', () => {
    const onThemeChange = vi.fn()
    render(<ThemeToggle theme="dark" onThemeChange={onThemeChange} />)
    const group = screen.getByRole('group', { name: 'Theme' })
    expect(within(group).getAllByRole('button').map((button) => [button.textContent, button.getAttribute('aria-pressed')]))
      .toEqual([['Light', 'false'], ['Dark', 'true'], ['System', 'false']])
    fireEvent.click(screen.getByRole('button', { name: 'System' }))
    expect(onThemeChange).toHaveBeenCalledWith('system')
  })
})
