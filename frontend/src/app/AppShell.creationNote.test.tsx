import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { creationNoteStorageKey } from '../hooks/useRememberedVisible'
import { entryFixture, findingFixture } from '../test/fixtures'
import { cleanupControllerTest, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const { AppShell } = await import('./AppShell')
const tauri = getTauriMock()
function Subject() { return <AppShell {...useAppController()} /> }

beforeEach(() => {
  setupControllerTest()
  window.localStorage.removeItem(creationNoteStorageKey)
  HTMLElement.prototype.scrollIntoView = vi.fn()
  tauri.listFindings.mockResolvedValue([findingFixture({ title: 'Saved finding' })])
  tauri.readNoteSource.mockResolvedValue({ entry: entryFixture({ body: '<h2>Checkout</h2><ul><li><p>Pay with a saved card.</p></li></ul>' }), revision: 0 })
})
afterEach(cleanupControllerTest)

async function createFinding() {
  const create = await screen.findByRole('button', { name: 'Create finding' })
  await waitFor(() => expect(create).toBeEnabled())
  fireEvent.click(create)
  await screen.findByRole('textbox', { name: 'Finding title' })
}

it('shows the Note read-only beside a new draft in place of the record list, which returns with the draft closed', async () => {
  render(<Subject />)
  await createFinding()
  const note = await screen.findByRole('complementary', { name: 'Note' })
  await waitFor(() => expect(within(note).getByRole('heading', { name: 'Checkout' })).toBeInTheDocument())
  expect(within(note).getByText('Pay with a saved card.')).toBeInTheDocument()
  expect(within(note).getByRole('textbox', { name: 'Note content' })).toHaveAttribute('aria-readonly', 'true')
  expect(screen.queryByRole('complementary', { name: 'Findings records' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Hide list' })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Search Findings' })).not.toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Sort' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Show Note' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Note' })).not.toBeInTheDocument())
  expect(screen.getByRole('complementary', { name: 'Findings records' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Search Findings' })).toBeInTheDocument()
})

it('remembers that the Note was closed for the next draft, and brings it back from the draft header', async () => {
  render(<Subject />)
  await createFinding()
  fireEvent.click(within(await screen.findByRole('complementary', { name: 'Note' })).getByRole('button', { name: 'Close Note' }))
  expect(screen.queryByRole('complementary', { name: 'Note' })).not.toBeInTheDocument()
  expect(window.localStorage.getItem(creationNoteStorageKey)).toBe('hidden')
  // The draft takes the full width: the record list stays folded away.
  expect(screen.queryByRole('complementary', { name: 'Findings records' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await createFinding()
  expect(screen.queryByRole('complementary', { name: 'Note' })).not.toBeInTheDocument()
  fireEvent.click(within(screen.getByRole('article', { name: 'New finding' })).getByRole('button', { name: 'Show Note' }))
  expect(await screen.findByRole('complementary', { name: 'Note' })).toHaveTextContent('Pay with a saved card.')
  expect(window.localStorage.getItem(creationNoteStorageKey)).toBe('shown')
})

it('says so in the panel when the Session has no Note, and the draft still saves', async () => {
  tauri.readNoteSource.mockResolvedValue({ entry: entryFixture({ body: '' }), revision: 0 })
  render(<Subject />)
  await createFinding()
  const note = await screen.findByRole('complementary', { name: 'Note' })
  await waitFor(() => expect(note).toHaveTextContent('This Session has no Note yet'))
  expect(within(note).queryByRole('textbox')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Finding title' }), { target: { value: 'Written without a Note' } })
  expect(screen.getByRole('button', { name: 'Save finding' })).toBeEnabled()
})
