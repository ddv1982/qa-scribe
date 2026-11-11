import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entryFixture, sessionFixture } from '../test/fixtures'
import { cleanupControllerTest, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const { AppShell } = await import('./AppShell')
const api = getTauriMock()
function Workspace() { return <AppShell {...useAppController()} /> }

beforeEach(() => {
  setupControllerTest()
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanupControllerTest()
  vi.restoreAllMocks()
})

describe('Ctrl+K Session search', () => {
  it('searches every Session while the sidebar keeps only the recent ones loaded at startup', async () => {
    const recent = Array.from({ length: 50 }, (_, index) => sessionFixture({ id: `session-${index + 1}`, title: `Recent ${index + 1}` }))
    const archived = sessionFixture({ id: 'session-archived', title: 'Archived release checks' })
    api.listRecentSessions.mockResolvedValue(recent)
    api.listSessions.mockResolvedValue([...recent, archived])
    api.listDraftLibrary.mockResolvedValue([])
    api.listFindingLibrary.mockResolvedValue([])
    render(<Workspace />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load All Sessions' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
    await waitFor(() => expect(api.listSessions).toHaveBeenCalled())
    fireEvent.change(within(screen.getByRole('dialog', { name: 'Command palette' })).getByRole('searchbox'), { target: { value: 'archived release' } })

    expect(await within(screen.getByRole('dialog', { name: 'Command palette' })).findByRole('group', { name: 'Sessions' })).toHaveTextContent('Archived release checks')
    expect(within(screen.getByRole('listbox', { name: 'Sessions' })).queryByText('Archived release checks')).not.toBeInTheDocument()

    api.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ session: archived, noteEntry: entryFixture({ id: 'entry-archived', sessionId: 'session-archived' }) }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Sessions' })).getByRole('option', { name: /archived release checks/i }))
    expect(await within(screen.getByRole('listbox', { name: 'Sessions' })).findByRole('option', { name: /archived release checks/i, selected: true })).toBeInTheDocument()
  })
})
