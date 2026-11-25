import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { generationStatusFixture, providerStatusFixture, settingsFixture } from '../test/fixtures'
import { AppShell } from './AppShell'
import { cleanupControllerTest, getTauriMock, renderWithControllerStartup, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
function Subject() { return <AppShell {...useAppController()} /> }
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it('lets Summary switch away from an unavailable default and discards canceled choices', async () => {
  const status = providerStatusFixture()
  status.providers.push({ ...status.providers[0], id: 'claude_code', label: 'Claude Code', available: false, status: 'authRequired' })
  api.getProviderStatus.mockResolvedValue(status)
  api.refreshProviderStatus.mockResolvedValue(status)
  api.getSettings.mockResolvedValue(settingsFixture({ selectedAiProvider: 'claude_code' }))
  api.startAiActionJob.mockResolvedValue({ jobId: 'job-1', status: generationStatusFixture() })
  await renderWithControllerStartup(() => render(<Subject />))
  const summarize = screen.getByRole('button', { name: 'Summarize' })
  const open = async () => {
    fireEvent.click(summarize)
    return within(await screen.findByRole('dialog', { name: 'Summarize note?' }))
  }
  let dialog = await open()
  const provider = () => dialog.getByRole('combobox', { name: 'Provider' })
  const confirm = () => dialog.getByRole('button', { name: 'Summarize note' })
  expect(provider()).toHaveValue('claude_code')
  expect(confirm()).toBeDisabled()
  fireEvent.change(provider(), { target: { value: 'codex_cli' } })
  expect(confirm()).toBeEnabled()
  fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
  dialog = await open()
  expect(provider()).toHaveValue('claude_code')
  fireEvent.change(provider(), { target: { value: 'codex_cli' } })
  fireEvent.click(confirm())
  await waitFor(() => expect(api.startAiActionJob).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'summary', provider: 'codex_cli', model: 'default', reasoningEffort: null }), expect.any(Function),
  ))
  expect(api.updateSettings).not.toHaveBeenCalled()
})
