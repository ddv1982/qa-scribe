import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { richEditorDocumentFromHtml } from '../editor/editorDocument'
import { entryFixture } from '../test/fixtures'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const { AppShell } = await import('./AppShell')
const tauri = getTauriMock()
beforeEach(() => { setupControllerTest(); HTMLElement.prototype.scrollIntoView = vi.fn() })
afterEach(cleanupControllerTest)

function Workspace() {
  const controller = useAppController()
  return <>
    <button onClick={() => controller.creation.update({ document: richEditorDocumentFromHtml('<p><strong>New body after Escape</strong></p>') })}>Write new draft body</button>
    <AppShell {...controller} />
  </>
}

it.each(['finding', 'testware'] as const)('keeps new %s edits after Escape dismisses a pending Prefill confirmation', async (kind) => {
  const source = { entry: entryFixture({ body: '<p>Canonical reviewed source</p>' }), revision: 0 }
  tauri.readNoteSource.mockResolvedValue(source)
  render(<Workspace />)
  const create = await screen.findByRole('button', { name: kind === 'finding' ? 'Create finding' : 'Create test cases' })
  await waitFor(() => expect(create).toBeEnabled())
  fireEvent.click(create)
  const title = await screen.findByRole('textbox', { name: kind === 'finding' ? 'Finding title' : 'Test case title' })
  fireEvent.change(title, { target: { value: 'Title before confirmation' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Prefill from note' })).toBeEnabled())
  const body = screen.getByRole('textbox', { name: 'Creation draft body' })
  const editorId = body.id
  const confirmation = deferred<typeof source>()
  tauri.readNoteSource.mockReturnValueOnce(confirmation.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Prefill from note' }))
  const dialog = screen.getByRole('dialog', { name: 'Use this Note content?' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Prefill and replace draft' }))
  await waitFor(() => expect(tauri.readNoteSource).toHaveBeenCalledTimes(2))
  expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toBeDisabled()
  fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.change(title, { target: { value: 'New title after Escape' } })
  fireEvent.click(screen.getByRole('button', { name: 'Write new draft body' }))
  await waitFor(() => expect(body).toHaveTextContent('New body after Escape'))
  await act(async () => { confirmation.resolve(source); await confirmation.promise })
  expect(title).toHaveValue('New title after Escape')
  expect(body).toHaveTextContent('New body after Escape')
  expect(body.id).toBe(editorId)
  expect(tauri.prepareCreationSave).not.toHaveBeenCalled()
  expect(tauri.commitCreationSave).not.toHaveBeenCalled()
  expect(tauri.startAiActionJob).not.toHaveBeenCalled()
  expect(tauri.createFinding).not.toHaveBeenCalled()
  expect(tauri.createDraft).not.toHaveBeenCalled()
})

it.each(['finding', 'testware'] as const)('keeps a newer %s confirmation busy when the dismissed read completes', async (kind) => {
  const source = { entry: entryFixture({ body: '<p>Accepted current source</p>' }), revision: 0 }
  tauri.readNoteSource.mockResolvedValue(source)
  render(<Workspace />)
  const create = await screen.findByRole('button', { name: kind === 'finding' ? 'Create finding' : 'Create test cases' })
  await waitFor(() => expect(create).toBeEnabled())
  fireEvent.click(create)
  const title = await screen.findByRole('textbox', { name: kind === 'finding' ? 'Finding title' : 'Test case title' })
  fireEvent.change(title, { target: { value: 'Retain this title' } })
  const trigger = screen.getByRole('button', { name: 'Prefill from note' })
  await waitFor(() => expect(trigger).toBeEnabled())
  const old = deferred<typeof source>()
  const next = deferred<typeof source>()
  tauri.readNoteSource.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
  fireEvent.click(trigger)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Prefill and replace draft' }))
  await waitFor(() => expect(tauri.readNoteSource).toHaveBeenCalledTimes(2))
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog')
  const confirm = within(dialog).getByRole('button', { name: 'Prefill and replace draft' })
  expect(confirm).toBeEnabled()
  fireEvent.click(confirm)
  await waitFor(() => expect(tauri.readNoteSource).toHaveBeenCalledTimes(3))
  await act(async () => { old.resolve({ ...source, revision: 9 }); await old.promise })
  expect(dialog).toBeInTheDocument()
  expect(confirm).toBeDisabled()
  expect(dialog).not.toHaveTextContent('Revision 9')
  expect(dialog).not.toHaveTextContent('The Note changed')
  await act(async () => { next.resolve(source); await next.promise })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(title).toHaveValue('Retain this title')
  expect(screen.getByRole('textbox', { name: 'Creation draft body' })).toHaveTextContent('Accepted current source')
  expect(tauri.prepareCreationSave).not.toHaveBeenCalled()
  expect(tauri.commitCreationSave).not.toHaveBeenCalled()
  expect(tauri.startAiActionJob).not.toHaveBeenCalled()
})
