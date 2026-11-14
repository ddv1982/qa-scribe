import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { draftFixture, entryFixture, findingFixture } from '../test/fixtures'
import { cleanupControllerTest, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const { AppShell } = await import('./AppShell')
const tauri = getTauriMock()
function Subject() { return <AppShell {...useAppController()} /> }

beforeEach(() => {
  setupControllerTest()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  tauri.listDrafts.mockResolvedValue([
    draftFixture({ id: 'draft-new', title: 'Newer test cases', updatedAt: '2026-11-13T09:00:00Z' }),
    draftFixture({ id: 'draft-old', title: 'Older test cases', updatedAt: '2026-07-22T00:00:00Z' }),
  ])
  tauri.listFindings.mockResolvedValue([
    findingFixture({ id: 'finding-new', title: 'Newer finding', updatedAt: '2026-11-13T09:00:00Z' }),
    findingFixture({ id: 'finding-old', title: 'Older finding', updatedAt: '2026-07-22T00:00:00Z' }),
  ])
  tauri.readNoteSource.mockResolvedValue({ entry: entryFixture({ body: '<p>Pay with a saved card.</p>' }), revision: 0 })
})
afterEach(cleanupControllerTest)

const openTab = async (name: RegExp) => fireEvent.click(await screen.findByRole('tab', { name }))
const shownRecord = (title: string) => screen.findByRole('heading', { level: 2, name: title })

async function selectRecord(listName: string, title: string) {
  fireEvent.click(await within(await screen.findByRole('complementary', { name: listName })).findByText(title))
  await shownRecord(title)
}

async function openAndCancelDraft(createLabel: string, titleLabel: string) {
  const create = screen.getByRole('button', { name: createLabel })
  await waitFor(() => expect(create).toBeEnabled())
  fireEvent.click(create)
  await screen.findByRole('textbox', { name: titleLabel })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('textbox', { name: titleLabel })).not.toBeInTheDocument())
}

it('keeps the selected test cases when another tab opens and a new draft is cancelled', async () => {
  render(<Subject />)
  await openTab(/Test cases/)
  await selectRecord('Test cases records', 'Older test cases')

  await openTab(/Findings/)
  await shownRecord('Newer finding')
  await openTab(/Test cases/)
  expect(await shownRecord('Older test cases')).toBeInTheDocument()

  await openAndCancelDraft('Create test cases', 'Test case title')
  expect(await shownRecord('Older test cases')).toBeInTheDocument()
})

it('keeps the selected finding when the Note opens and a new draft is cancelled', async () => {
  render(<Subject />)
  await openTab(/Findings/)
  await selectRecord('Findings records', 'Older finding')

  await openTab(/Note/)
  await openTab(/Findings/)
  expect(await shownRecord('Older finding')).toBeInTheDocument()

  await openAndCancelDraft('Create finding', 'Finding title')
  expect(await shownRecord('Older finding')).toBeInTheDocument()
})
