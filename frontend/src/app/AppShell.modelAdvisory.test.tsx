import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AppShell } from './AppShell'
import { cleanupControllerTest, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'
import { generationStatusFixture, providerModelDescriptorFixture, providerStatusFixture, settingsFixture } from '../test/fixtures'

const api = getTauriMock()
function Subject() { return <AppShell {...useAppController()} /> }
beforeEach(() => {
  setupControllerTest()
  const status = providerStatusFixture()
  status.providers[0].models.push(providerModelDescriptorFixture({ id: 'gpt-5.5', reasoningEfforts: ['medium'] }))
  status.providers[0].catalogSnapshot = { ...status.providers[0].catalogSnapshot, state: 'fresh', models: status.providers[0].models }
  api.getProviderStatus.mockResolvedValue(status)
  api.refreshProviderStatus.mockResolvedValue(status)
})
afterEach(cleanupControllerTest)

it('keeps the exact custom-model advisory visible outside closed details without blocking literal generation', async () => {
  const user = userEvent.setup()
  const model = 'unlisted-literal-model'
  api.getSettings.mockResolvedValue(settingsFixture({ selectedAiModel: model,
    selectedAiModelsByProvider: { claude_code: null, codex_cli: model, copilot_cli: null } }))
  api.startAiActionJob.mockResolvedValue({ jobId: 'job-1', status: generationStatusFixture({ state: 'completed' }) })
  render(<Subject />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveValue('Checkout session'))
  await user.click(screen.getByRole('button', { name: 'Create test cases with AI' }))
  const dialog = screen.getByRole('dialog', { name: 'Generate test cases?' })
  const details = dialog.querySelector('details')!
  const text = 'Custom model “unlisted-literal-model” is not in the current catalog. The CLI will validate it at run time.'
  expect(details.open).toBe(false)
  const outside = within(dialog).queryAllByRole('status').filter(node => node.textContent === text && !node.closest('details'))
  expect(outside).toHaveLength(1)
  expect(outside[0]).toBeVisible()
  await user.click(within(dialog).getByText('Execution details'))
  await user.click(within(dialog).getByText('Execution details'))
  expect(outside[0]).toBeVisible()
  const generate = within(dialog).getByRole('button', { name: 'Generate test cases' })
  expect(generate).toBeEnabled()
  await user.click(generate)
  await waitFor(() => expect(api.startAiActionJob).toHaveBeenCalledWith(expect.objectContaining({ model }), expect.any(Function)))
  expect(api.updateSettings).not.toHaveBeenCalled()
})

it.each(['default', 'auto', 'gpt-5.5'])('does not create a catalog-absence advisory for %s', async model => {
  const user = userEvent.setup()
  api.getSettings.mockResolvedValue(settingsFixture({ selectedAiModel: model === 'default' ? null : model,
    selectedAiModelsByProvider: { claude_code: null, codex_cli: model === 'default' ? null : model, copilot_cli: null } }))
  render(<Subject />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Session title' })).toHaveValue('Checkout session'))
  await user.click(screen.getByRole('button', { name: 'Create test cases with AI' }))
  const dialog = screen.getByRole('dialog', { name: 'Generate test cases?' })
  expect(within(dialog).queryByText(/is not in the current catalog/)).toBeNull()
})
