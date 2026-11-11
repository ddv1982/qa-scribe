import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette, type SearchTarget } from './AppOverlays'
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
    const search = screen.getByRole('searchbox', { name: 'Search Sessions, records, and commands' })
    if (query) await user.type(search, query)
    expect(search).toHaveFocus()
    expect(search).toHaveValue(query)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(run).not.toHaveBeenCalled()
    await user.click(trigger)
    expect(screen.getByRole('searchbox', { name: 'Search Sessions, records, and commands' })).toHaveValue('')
  })

  it('filters commands and moves with arrows past disabled options before running a command', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const run = vi.fn()
    render(<PaletteHarness onClose={onClose} run={run} />)
    await user.click(screen.getByRole('button', { name: 'Open commands' }))
    const search = screen.getByRole('searchbox', { name: 'Search Sessions, records, and commands' })
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

describe('Command palette search', () => {
  const settings: AppCommand = { id: 'settings.open', label: 'Open Settings', description: 'Configure appearance', keywords: [], available: true, run: () => {} }
  const target = (group: SearchTarget['group'], label: string, detail: string, open = vi.fn()): SearchTarget =>
    ({ key: `${group}:${label}`, group, label, detail, text: `${label} ${detail}`.toLocaleLowerCase(), open })

  it('keeps an empty palette to commands and groups saved work once there is a query', async () => {
    const user = userEvent.setup()
    const openCase = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette commands={[settings]} onClose={onClose} targets={[
      target('Sessions', 'Testplan IRIS Oracle2Cloud', 'Updated 25 Jun'),
      target('Test cases', 'Smoketest passes for IRIS apps', 'Testplan IRIS Oracle2Cloud', openCase),
      target('Findings', 'Checkout total drifts', 'Bug · Checkout'),
    ]} />)
    expect(screen.getAllByRole('option')).toHaveLength(1)

    await user.type(screen.getByRole('searchbox'), 'iris smoke')
    expect(screen.queryByRole('group', { name: 'Sessions' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Test cases' })).toHaveTextContent('Smoketest passes for IRIS apps')
    expect(screen.queryByRole('group', { name: 'Commands' })).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(openCase).toHaveBeenCalledTimes(1)
  })

  it('says when nothing matches', async () => {
    const user = userEvent.setup()
    render(<CommandPalette commands={[settings]} onClose={vi.fn()} targets={[target('Sessions', 'Goldengate', 'Updated 21 Oct')]} />)
    await user.type(screen.getByRole('searchbox'), 'nothing here')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByText(/Nothing matches “nothing here”/)).toBeInTheDocument()
  })
})
