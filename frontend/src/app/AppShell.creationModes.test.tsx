import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { entryFixture, providerStatusFixture } from '../test/fixtures'
import { creationComposer, creationMode, generateAction } from '../test/creationModes'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const { AppShell } = await import('./AppShell')
const tauri = getTauriMock()
function Subject() {
  const controller = useAppController()
  return <>
    <button type="button" onClick={() => void controller.openGenerationPreflight('testware')}>AI entry point</button>
    <AppShell {...controller} />
  </>
}

beforeEach(() => {
  setupControllerTest()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  tauri.readNoteSource.mockResolvedValue({ entry: entryFixture({ body: '<p>Pay with a saved card.</p>' }), revision: 0 })
})
afterEach(cleanupControllerTest)

async function createTestCases() {
  const create = await screen.findByRole('button', { name: 'Create test cases' })
  await waitFor(() => expect(create).toBeEnabled())
  fireEvent.click(create)
  return screen.findByRole('textbox', { name: 'Test case title' })
}

it('offers no switch and writes only when no AI provider is available', async () => {
  const status = providerStatusFixture()
  status.providers = status.providers.map((provider) => ({ ...provider, available: false }))
  tauri.getProviderStatus.mockResolvedValue(status)
  tauri.refreshProviderStatus.mockResolvedValue(status)
  render(<Subject />)
  const title = await createTestCases()
  await waitFor(() => expect(tauri.getProviderStatus).toHaveBeenCalled())
  expect(screen.queryByRole('group', { name: 'How to create' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument()
  expect(title).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Save test cases' })).toBeInTheDocument()
})

it('starts in Write, and Generate shows the setup in place of the draft fields', async () => {
  render(<Subject />)
  const title = await createTestCases()
  await waitFor(() => expect(creationMode('Write')).toHaveAttribute('aria-pressed', 'true'))
  expect(title).toHaveFocus()
  expect(screen.getByText('Draft, not saved yet')).toBeInTheDocument()

  fireEvent.click(creationMode('Generate'))
  const composer = creationComposer('testware')
  expect(creationMode('Generate')).toHaveAttribute('aria-pressed', 'true')
  expect(title).not.toBeVisible()
  expect(screen.queryByRole('textbox', { name: 'Creation draft body' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save test cases' })).not.toBeInTheDocument()
  expect(screen.queryByText('Draft, not saved yet')).not.toBeInTheDocument()
  expect(within(composer).getByRole('combobox', { name: 'Output' })).toBeVisible()
  expect(within(composer).getByRole('group', { name: 'Test design' })).toBeVisible()
  expect(within(composer).getByText('Execution details').closest('summary')).toHaveFocus()
  expect(composer).toHaveTextContent('5 words · 0 screenshots')
  expect(screen.getByRole('complementary', { name: 'Note' })).toBeInTheDocument()
  await waitFor(() => expect(generateAction(composer)).toBeEnabled())

  fireEvent.click(creationMode('Write'))
  expect(title).toBeVisible()
  expect(title).toHaveFocus()
})

it('keeps Generate disabled with the reason while the Note is not shown yet', async () => {
  const source = deferred<Awaited<ReturnType<typeof tauri.readNoteSource>>>()
  tauri.readNoteSource.mockReturnValue(source.promise)
  render(<Subject />)
  await createTestCases()
  fireEvent.click(await waitFor(() => creationMode('Generate')))
  const composer = creationComposer('testware')
  expect(within(composer).getByRole('alert')).toHaveTextContent('Wait for the Note to show beside the draft before generating.')
  expect(generateAction(composer)).toBeDisabled()
  source.resolve({ entry: entryFixture({ body: '<p>Arrived.</p>' }), revision: 0 })
  await waitFor(() => expect(generateAction(composer)).toBeEnabled())
  expect(within(composer).queryByRole('alert')).not.toBeInTheDocument()
})

it('generates with the chosen output and locks the switch while it runs', async () => {
  const started = deferred<Awaited<ReturnType<typeof tauri.startAiActionJob>>>()
  tauri.startAiActionJob.mockReturnValue(started.promise)
  render(<Subject />)
  await createTestCases()
  fireEvent.click(await waitFor(() => creationMode('Generate')))
  const composer = creationComposer('testware')
  fireEvent.change(within(composer).getByRole('combobox', { name: 'Output' }), { target: { value: 'gherkin' } })
  await waitFor(() => expect(generateAction(composer)).toBeEnabled())
  fireEvent.click(generateAction(composer))
  await waitFor(() => expect(tauri.startAiActionJob).toHaveBeenCalledWith(expect.objectContaining({
    action: 'testware', provider: 'codex_cli', model: 'default', testwarePreferences: expect.objectContaining({ outputFormat: 'gherkin' }),
  }), expect.any(Function)))
  expect(creationMode('Write')).toBeDisabled()
  expect(creationMode('Generate')).toBeDisabled()
})

it('opens a draft started from an AI entry point in Generate mode', async () => {
  render(<Subject />)
  await screen.findByRole('textbox', { name: 'Session title' })
  await waitFor(() => expect(tauri.getProviderStatus).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'AI entry point' }))
  await waitFor(() => expect(creationMode('Generate')).toHaveAttribute('aria-pressed', 'true'))
  expect(within(creationComposer('testware')).getByRole('combobox', { name: 'Output' })).toBeVisible()
})
