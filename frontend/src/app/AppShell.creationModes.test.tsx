import '@testing-library/jest-dom/vitest'
import { fireEvent, isInaccessible, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { entryFixture, findingFixture, generationStatusFixture, providerStatusFixture, sessionFixture } from '../test/fixtures'
import type { GenerationJobEvent } from '../tauri'
import { creationComposer, creationMode, generateAction } from '../test/creationModes'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const { AppShell } = await import('./AppShell')
const tauri = getTauriMock()
function Subject() {
  const controller = useAppController()
  return <>
    <button type="button" onClick={() => void controller.openGenerationPreflight('testware')}>AI entry point</button>
    <button type="button" onClick={() => void controller.openGenerationPreflight('finding')}>AI finding entry point</button>
    <AppShell {...controller} />
  </>
}

beforeEach(() => {
  setupControllerTest()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  tauri.readNoteSource.mockResolvedValue({ entry: entryFixture({ body: '<p>Pay with a saved card.</p>' }), revision: 0 })
})
afterEach(cleanupControllerTest)

async function createDraft(kind: 'testware' | 'finding' = 'testware') {
  const create = await screen.findByRole('button', { name: kind === 'finding' ? 'Create finding' : 'Create test cases' })
  await waitFor(() => expect(create).toBeEnabled())
  fireEvent.click(create)
  return screen.findByRole('textbox', { name: kind === 'finding' ? 'Finding title' : 'Test case title' })
}

async function generateMode(kind: 'testware' | 'finding' = 'testware') {
  fireEvent.click(await waitFor(() => creationMode('Generate')))
  return creationComposer(kind)
}

it('offers no switch and writes only when no AI provider is available', async () => {
  const status = providerStatusFixture()
  status.providers = status.providers.map((provider) => ({ ...provider, available: false }))
  tauri.getProviderStatus.mockResolvedValue(status)
  tauri.refreshProviderStatus.mockResolvedValue(status)
  render(<Subject />)
  const title = await createDraft()
  await waitFor(() => expect(tauri.getProviderStatus).toHaveBeenCalled())
  expect(screen.queryByRole('group', { name: 'How to create' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument()
  expect(title).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Save test cases' })).toBeInTheDocument()
})

it('starts in Write, and Generate shows the choices first and the execution details last', async () => {
  render(<Subject />)
  const title = await createDraft()
  await waitFor(() => expect(creationMode('Write')).toHaveAttribute('aria-pressed', 'true'))
  expect(title).toHaveFocus()
  expect(screen.getByText('Draft, not saved yet')).toBeInTheDocument()

  const composer = await generateMode()
  expect(creationMode('Generate')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: 'Save test cases' })).not.toBeInTheDocument()
  expect(screen.queryByText('Draft, not saved yet')).not.toBeInTheDocument()
  const output = within(composer).getByRole('combobox', { name: 'Output' })
  expect(output).toHaveFocus()
  const summary = within(composer).getByText('Execution details').closest('summary')!
  for (const choice of [output, within(composer).getByRole('group', { name: 'Test design' }), within(composer).getByRole('group', { name: 'Include' }), within(composer).getByRole('textbox', { name: 'Additional guidance' })]) {
    expect(choice.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
  expect(summary.closest('details')!.open).toBe(false)
  expect(summary).toHaveTextContent('5 words · 0 screenshots')
  expect(composer).toHaveTextContent('The AI result is saved as new test cases and opens for you to review.')
  expect(composer).not.toHaveTextContent('What you wrote under Write')
  expect(screen.getByRole('complementary', { name: 'Note' })).toBeInTheDocument()
  await waitFor(() => expect(generateAction(composer)).toBeEnabled())
  expect(generateAction(composer)).toHaveTextContent('Generate test cases')

  fireEvent.click(creationMode('Write'))
  expect(title).toBeVisible()
  expect(title).toHaveFocus()
})

it('keeps the hidden Write fields inert: out of the accessibility tree, not focusable and not pasted into', async () => {
  render(<Subject />)
  const title = await createDraft()
  const editor = screen.getByRole('textbox', { name: 'Creation draft body' })
  fireEvent.change(title, { target: { value: 'Written by hand' } })
  await generateMode()
  for (const field of [title, editor, screen.getByRole('combobox', { name: 'Test case output format', hidden: true })]) {
    expect(field.closest('[hidden]')).not.toBeNull()
    expect(isInaccessible(field)).toBe(true)
  }
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'evidence.png', { type: 'image/png' })
  fireEvent.paste(editor, { clipboardData: { files: [file], items: [], types: ['Files'], getData: () => '' } })
  fireEvent.click(creationMode('Write'))
  expect(screen.queryByText('Adding image…')).not.toBeInTheDocument()
  expect(editor.querySelector('img')).toBeNull()
})

it('says what an authored draft risks, and names the action after the record it creates', async () => {
  render(<Subject />)
  const title = await createDraft('finding')
  fireEvent.change(title, { target: { value: 'Written by hand' } })
  const composer = await generateMode('finding')
  expect(composer).toHaveTextContent('The AI result is saved as a new finding and opens for you to review. What you wrote under Write is discarded when that succeeds, and kept if it fails or you cancel.')
  await waitFor(() => expect(generateAction(composer)).toBeEnabled())
  expect(generateAction(composer)).toHaveTextContent('Generate finding')
  // A finding has no choices to make, so the primary action takes the focus.
  expect(generateAction(composer)).toHaveFocus()
})

it.each([
  ['finding', null],
  ['testware', null],
  ['testware', '   '],
] as const)('disables Generate for a %s with an empty Note (acceptance criteria %j)', async (kind, acceptanceCriteria) => {
  tauri.listSessions.mockResolvedValue([sessionFixture({ acceptanceCriteria })])
  tauri.listRecentSessions.mockResolvedValue([sessionFixture({ acceptanceCriteria })])
  tauri.openSessionNoteState.mockResolvedValue(sessionNoteStateFixture({ session: sessionFixture({ acceptanceCriteria }) }))
  tauri.readNoteSource.mockResolvedValue({ entry: entryFixture({ body: '<p></p>' }), revision: 0 })
  render(<Subject />)
  await createDraft(kind)
  const composer = await generateMode(kind)
  await waitFor(() => expect(within(composer).getByRole('alert')).toHaveTextContent('Write a Note first. There is nothing to generate from yet.'))
  expect(generateAction(composer)).toBeDisabled()
  expect(composer.querySelector('details')!.open).toBe(false)
})

it('generates test cases from the acceptance criteria when the Note is empty', async () => {
  tauri.listSessions.mockResolvedValue([sessionFixture({ acceptanceCriteria: 'AC-1 Empty street shows an error' })])
  tauri.listRecentSessions.mockResolvedValue([sessionFixture({ acceptanceCriteria: 'AC-1 Empty street shows an error' })])
  tauri.openSessionNoteState.mockResolvedValue(sessionNoteStateFixture({ session: sessionFixture({ acceptanceCriteria: 'AC-1 Empty street shows an error' }) }))
  tauri.readNoteSource.mockResolvedValue({ entry: entryFixture({ body: '' }), revision: 0 })
  render(<Subject />)
  await createDraft()
  const composer = await generateMode()
  await waitFor(() => expect(generateAction(composer)).toBeEnabled())
  expect(within(composer).queryByRole('alert')).not.toBeInTheDocument()
})

it('keeps Generate disabled with the reason while the Note is not shown yet', async () => {
  const source = deferred<Awaited<ReturnType<typeof tauri.readNoteSource>>>()
  tauri.readNoteSource.mockReturnValue(source.promise)
  render(<Subject />)
  await createDraft()
  const composer = await generateMode()
  expect(within(composer).getByRole('alert')).toHaveTextContent('Wait for the Note to show beside the draft before generating.')
  expect(generateAction(composer)).toBeDisabled()
  source.resolve({ entry: entryFixture({ body: '<p>Arrived.</p>' }), revision: 0 })
  await waitFor(() => expect(generateAction(composer)).toBeEnabled())
  expect(within(composer).queryByRole('alert')).not.toBeInTheDocument()
})

it('does not save the hidden draft with Ctrl+S or Cmd+S in Generate, and does in Write', async () => {
  render(<Subject />)
  const title = await createDraft()
  fireEvent.change(title, { target: { value: 'Written by hand' } })
  await generateMode()
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  fireEvent.keyDown(window, { key: 's', metaKey: true })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(tauri.prepareCreationSave).not.toHaveBeenCalled()
  fireEvent.click(creationMode('Write'))
  fireEvent.keyDown(window, { key: 's', ctrlKey: true })
  fireEvent.keyDown(window, { key: 's', metaKey: true })
  await waitFor(() => expect(tauri.prepareCreationSave).toHaveBeenCalled())
})

it('generates with the chosen output and locks the switch while it runs', async () => {
  const started = deferred<Awaited<ReturnType<typeof tauri.startAiActionJob>>>()
  tauri.startAiActionJob.mockReturnValue(started.promise)
  render(<Subject />)
  await createDraft()
  const composer = await generateMode()
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

it('offers Open saved result in Generate when the generated finding is saved but could not be opened, with no title', async () => {
  const saved = findingFixture({ id: 'generated-finding', title: 'Generated finding' })
  const status = generationStatusFixture({ action: 'finding', jobId: 'job-1', state: 'completed' })
  const completed: GenerationJobEvent = { type: 'completed', job_id: 'job-1', status, result: {
    generationContext: { id: 'context-1', sessionId: 'session-1', createdAt: 'now' },
    aiRun: { id: 'run-1', sessionId: 'session-1', generationContextId: 'context-1', provider: 'codex_cli', modelSelection: { kind: 'recorded', requested: { kind: 'default' }, reported: null }, reasoningEffort: null, promptVersion: 'finding-v4', status: 'completed', errorMessage: null, createdAt: 'now', completedAt: 'now' },
    finding: saved, draft: null, noteEntry: null,
  } }
  tauri.startAiActionJob.mockImplementation(async (_request: unknown, onEvent: (event: GenerationJobEvent) => void) => {
    setTimeout(() => onEvent(completed), 0)
    return { jobId: 'job-1', status: { ...status, state: 'running' } }
  })
  render(<Subject />)
  await createDraft('finding')
  const composer = await generateMode('finding')
  await waitFor(() => expect(generateAction(composer)).toBeEnabled())
  // The record list reload after the commit fails once, so the saved finding cannot be opened yet.
  tauri.listFindings.mockRejectedValueOnce(new Error('list failed'))
  fireEvent.click(generateAction(composer))
  const open = await within(composer).findByRole('button', { name: 'Open saved result' })
  expect(composer).toHaveTextContent('Saved result, opening for review')
  expect(open).toBeEnabled()
  tauri.listFindings.mockResolvedValue([saved])
  fireEvent.click(open)
  await waitFor(() => expect(screen.queryByRole('article', { name: 'New finding' })).not.toBeInTheDocument())
})

it('makes Create with AI unavailable in Commands without a ready AI provider', async () => {
  const status = providerStatusFixture()
  status.providers = status.providers.map((provider) => ({ ...provider, available: false }))
  tauri.getProviderStatus.mockResolvedValue(status)
  tauri.refreshProviderStatus.mockResolvedValue(status)
  render(<Subject />)
  await screen.findByRole('textbox', { name: 'Session title' })
  await waitFor(() => expect(tauri.getProviderStatus).toHaveBeenCalled())
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  const palette = await screen.findByRole('dialog')
  const option = (label: string) => within(palette).getAllByRole('option').find((node) => node.textContent?.startsWith(label) && !node.textContent.startsWith(`${label} with AI`))!
  expect(option('Create test cases with AI')).toBeDisabled()
  expect(option('Create finding with AI')).toBeDisabled()
  expect(option('Create test cases')).toBeEnabled()
})

it('focuses the Generate option when a finding opens in Generate before its Note is shown', async () => {
  const source = deferred<Awaited<ReturnType<typeof tauri.readNoteSource>>>()
  tauri.readNoteSource.mockReturnValue(source.promise)
  render(<Subject />)
  await screen.findByRole('textbox', { name: 'Session title' })
  await waitFor(() => expect(tauri.getProviderStatus).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'AI finding entry point' }))
  await waitFor(() => expect(creationMode('Generate')).toHaveAttribute('aria-pressed', 'true'))
  expect(generateAction(creationComposer('finding'))).toBeDisabled()
  expect(creationMode('Generate')).toHaveFocus()
  source.resolve({ entry: entryFixture({ body: '<p>Arrived.</p>' }), revision: 0 })
  await waitFor(() => expect(generateAction(creationComposer('finding'))).toBeEnabled())
})

it('says where to finish or drop images that block Generate', async () => {
  tauri.readClipboardImageDataUrl.mockReturnValue(new Promise<string | null>(() => {}))
  render(<Subject />)
  await createDraft('finding')
  const editor = screen.getByRole('textbox', { name: 'Creation draft body' })
  fireEvent.paste(editor, { clipboardData: { files: [], items: [], types: ['image/png'], getData: () => '' } })
  await screen.findByText('Adding image…')
  const composer = await generateMode('finding')
  expect(within(composer).getByRole('alert')).toHaveTextContent('Finish adding images under Write, or continue without the failed ones there, before generating.')
  expect(generateAction(composer)).toBeDisabled()
})
