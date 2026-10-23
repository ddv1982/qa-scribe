import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { SettingsView } from './SettingsView'
import { providerDefaultSnapshotFixture, providerStatusFixture, settingsFixture } from '../test/fixtures'

function renderSettings(overrides: Partial<Parameters<typeof SettingsView>[0]> = {}) {
  const callbacks = { updateSettingsDraft: vi.fn(), setTheme: vi.fn(), onSaveSettings: vi.fn(),
    onDiscardSettings: vi.fn(), onRefreshProviderStatus: vi.fn(), onBack: vi.fn() }
  render(<SettingsView busyAction={null} providerStatus={providerStatusFixture()} settingsDraft={settingsFixture()}
    settingsDirty={false} settingsSaveState="idle" providerDiscoveryState="ready" theme="dark" {...callbacks} {...overrides} />)
  return callbacks
}
afterEach(cleanup)

it('keeps provider, model and reasoning choices outside optional diagnostics without writing on expansion', async () => {
  const user = userEvent.setup()
  const callbacks = renderSettings()
  const diagnostics = screen.getByText('Execution diagnostics').closest('details')!
  expect(diagnostics.open).toBe(false)
  for (const name of ['Default AI provider', 'Model', 'Reasoning']) {
    expect(screen.getByRole('combobox', { name })).toBeVisible()
    expect(screen.getByRole('combobox', { name }).closest('details')).toBeNull()
  }
  await user.click(screen.getByText('Execution diagnostics'))
  expect(diagnostics.open).toBe(true)
  expect(screen.getByText('Resolution scope')).toBeVisible()
  expect(callbacks.updateSettingsDraft).not.toHaveBeenCalled()
  expect(callbacks.onSaveSettings).not.toHaveBeenCalled()
  expect(callbacks.onRefreshProviderStatus).not.toHaveBeenCalled()
})

it('shows provider recovery, discovery failures and warnings while diagnostics remain closed', () => {
  const status = providerStatusFixture()
  status.providers = status.providers.map(provider => ({ ...provider, available: false, status: 'authRequired',
    defaultSnapshot: providerDefaultSnapshotFixture({ state: 'unavailable', error: { code: 'authRequired', message: 'private failure', retryable: true },
      warnings: [{ code: 'fixture', severity: 'blocking', message: 'Review CLI access before generation.' }] }) }))
  renderSettings({ providerStatus: status, providerDiscoveryState: 'error' })
  expect(screen.getByText('Execution diagnostics').closest('details')!.open).toBe(false)
  expect(screen.getByRole('combobox', { name: 'Default AI provider' })).toBeDisabled()
  const alerts = screen.getAllByRole('alert')
  expect(alerts.map(node => node.textContent)).toContain('Sign in with Codex CLI, then refresh.')
  expect(alerts.map(node => node.textContent)).toContain('Review CLI access before generation.')
  for (const alert of alerts) {
    expect(alert.closest('details')).toBeNull()
    expect(alert).toBeVisible()
  }
  const recovery = screen.getByText('Provider unavailable. Sign in with the CLI, then retry.')
  expect(recovery).toHaveAttribute('role', 'status')
  expect(recovery.closest('details')).toBeNull()
})

it('keeps the pending preference write safeguard visible above diagnostics', () => {
  renderSettings({ settingsDirty: true, settingsWritePending: true })
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  const pending = screen.getByText('Saving model preference… Wait before saving settings.')
  expect(pending.closest('details')).toBeNull()
  expect(pending).toBeVisible()
})
