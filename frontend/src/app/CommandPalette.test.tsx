import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './AppOverlays'
import type { AppCommand } from './commandRegistry'

afterEach(cleanup)

function PaletteHarness({ onClose, run }: { onClose: () => void; run: () => void }) {
  const [open, setOpen] = useState(false)
  const commands: AppCommand[] = [
    { id: 'session.new', label: 'New Session', description: 'Create a Session', keywords: [], available: false, run },
    { id: 'settings.open', label: 'Open Settings', description: 'Configure appearance', keywords: ['preferences'], available: true, run },
    { id: 'providers.refresh', label: 'Refresh CLI Configuration', description: 'Check readiness', keywords: [], available: true, run },
  ]
  return <>
    <button onClick={() => setOpen(true)}>Open commands</button>
    {open ? <CommandPalette commands={commands} onClose={() => { onClose(); setOpen(false) }} /> : null}
  </>
}

describe('Command palette keyboard behavior', () => {
  it.each(['', 'Settings'])('closes once on the first Escape from search with query %j', async (query) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const run = vi.fn()
    render(<PaletteHarness onClose={onClose} run={run} />)
    const trigger = screen.getByRole('button', { name: 'Open commands' })
    await user.click(trigger)
    const search = screen.getByRole('searchbox', { name: 'Search commands' })
    if (query) await user.type(search, query)
    expect(search).toHaveFocus()
    expect(search).toHaveValue(query)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
    await user.click(trigger)
    expect(screen.getByRole('searchbox', { name: 'Search commands' })).toHaveValue('')
  })

  it('filters commands and moves with arrows past disabled options before running a command', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const run = vi.fn()
    render(<PaletteHarness onClose={onClose} run={run} />)
    await user.click(screen.getByRole('button', { name: 'Open commands' }))
    const search = screen.getByRole('searchbox', { name: 'Search commands' })
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /Open Settings/ })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: /Refresh CLI Configuration/ })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('option', { name: /Open Settings/ })).toHaveFocus()
    await user.click(search)
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('option', { name: /Refresh CLI Configuration/ })).toHaveFocus()
    await user.type(search, 'preferences')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: /Open Settings/ })).toBeEnabled()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
