import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SaveSettingsButton } from './Common'
import { useSettingsController } from '../hooks/useSettingsController'
import { settingsFixture } from '../test/fixtures'
import type { AppSettings } from '../tauri'

const bridge = vi.hoisted(() => ({ updateSettings: vi.fn() }))
vi.mock('../tauri', () => ({ updateSettings: bridge.updateSettings }))

beforeEach(() => {
  vi.clearAllMocks()
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } })
})
afterEach(cleanup)

function SettingsSaveHarness() {
  const settings = useSettingsController({ setError: () => {}, setNotice: () => {} })
  return <>
    <button type="button" onClick={() => settings.loadSettings(settingsFixture())}>Load settings</button>
    <label>Instructions<input value={settings.settingsDraft?.generationSystemPrompt ?? ''} onChange={(event) => settings.updateSettingsDraft({ generationSystemPrompt: event.target.value })} /></label>
    <SaveSettingsButton label="Save settings" disabled={!settings.settingsDirty} state={settings.settingsSaveState} error={settings.settingsSaveError} busyAction={null} onSave={settings.handleSaveSettings} />
  </>
}

it('retains edits on failure, retries once, announces saved status and disables a clean Save', async () => {
  const user = userEvent.setup()
  let finish: (settings: AppSettings) => void = () => {}
  const pending = new Promise<AppSettings>((resolve) => { finish = resolve })
  bridge.updateSettings.mockRejectedValueOnce(new Error('Disk unavailable')).mockReturnValueOnce(pending)
  render(<SettingsSaveHarness />)
  await user.click(screen.getByRole('button', { name: 'Load settings' }))
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  await user.clear(screen.getByLabelText('Instructions'))
  await user.type(screen.getByLabelText('Instructions'), 'Keep this authored instruction')
  await user.click(screen.getByRole('button', { name: 'Save settings' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Disk unavailable')
  expect(screen.getByLabelText('Instructions')).toHaveValue('Keep this authored instruction')
  const retry = screen.getByRole('button', { name: 'Try again' })
  await user.click(retry)
  expect(retry).toHaveTextContent('Try again')
  expect(retry).toHaveAttribute('aria-busy', 'true')
  expect(retry).toBeDisabled()
  await user.click(retry)
  expect(bridge.updateSettings).toHaveBeenCalledTimes(2)
  await act(async () => { finish(settingsFixture({ generationSystemPrompt: 'Keep this authored instruction' })) })
  expect(screen.getByRole('status')).toHaveTextContent('Saved')
  expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('preserves the Save label and blocks duplicate commits during its first save', async () => {
  const user = userEvent.setup()
  const save = vi.fn().mockResolvedValue(undefined)
  const { rerender } = render(<SaveSettingsButton label="Save settings" disabled={false} state="idle" busyAction={null} onSave={save} />)
  rerender(<SaveSettingsButton label="Save settings" disabled={false} state="saving" busyAction={null} onSave={save} />)
  const button = screen.getByRole('button', { name: 'Save settings' })
  await user.click(button)
  expect(button).toHaveAttribute('aria-busy', 'true')
  expect(save).not.toHaveBeenCalled()
})
