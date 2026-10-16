import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextModelSelection } from './NextModelSelection'
import { useSettingsController } from '../hooks/useSettingsController'
import { providerModelDescriptorFixture, providerStatusFixture, settingsFixture } from '../test/fixtures'
import type { AppSettings } from '../tauri'

const bridge = vi.hoisted(() => ({ updateSettings: vi.fn() }))
vi.mock('../tauri', () => ({ updateSettings: bridge.updateSettings }))
const initial = settingsFixture({ selectedAiModel: 'explicit-model', selectedAiModelsByProvider: { claude_code: null, codex_cli: 'explicit-model', copilot_cli: null } })
const provider = providerStatusFixture().providers[0]
provider.models = [providerModelDescriptorFixture({ id: 'default', label: 'Default' }), providerModelDescriptorFixture({ id: 'explicit-model', label: 'Explicit model' })]

function Harness() {
  const [error, setError] = useState<string | null>(null)
  const controller = useSettingsController({ setError, setNotice: vi.fn() })

  return <>
    <button onClick={() => controller.loadSettings(initial)}>Load settings</button>
    <label>Prompt draft<input value={controller.settingsDraft?.generationSystemPrompt ?? ''}
      onChange={(event) => controller.updateSettingsDraft({ generationSystemPrompt: event.target.value })} /></label>
    <NextModelSelection provider={provider} value={controller.selectedModel} pending={controller.settingsWritePending}
      disabled={!controller.settings} catalogEnabled onChange={(value) => { void controller.persistModelChoice('codex_cli', value) }} />
    {error ? <p role="alert">{error}</p> : null}
    <output aria-label="Confirmed model">{controller.selectedModel}</output>
  </>
}

beforeEach(() => {
  vi.clearAllMocks()
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } })
  bridge.updateSettings.mockImplementation(async (settings: AppSettings) => settings)
})
afterEach(() => { cleanup(); document.body.removeAttribute('tabindex') })

it('selects Default after an explicit model through the actual saved preference owner', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Load settings' }))
  await user.click(screen.getByRole('button', { name: 'Open model choices' }))
  await user.click(screen.getByRole('option', { name: /CLI default/ }))
  await waitFor(() => expect(screen.getByLabelText('Confirmed model')).toHaveTextContent('default'))
  expect(bridge.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ selectedAiModel: null,
    selectedAiModelsByProvider: { claude_code: null, codex_cli: null, copilot_cli: null } }))
})

it('keeps a dirty prompt when the rendered quick picker saves a model', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Load settings' }))
  await user.clear(screen.getByLabelText('Prompt draft'))
  await user.type(screen.getByLabelText('Prompt draft'), 'Unsaved prompt')
  await user.click(screen.getByRole('button', { name: 'Open model choices' }))
  await user.click(screen.getByRole('option', { name: /CLI default/ }))
  await waitFor(() => expect(screen.getByLabelText('Confirmed model')).toHaveTextContent('default'))
  expect(screen.getByLabelText('Prompt draft')).toHaveValue('Unsaved prompt')
  expect(bridge.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ generationSystemPrompt: initial.generationSystemPrompt }))
})

it('shows a failed quick save and retains the confirmed picker value', async () => {
  bridge.updateSettings.mockRejectedValueOnce(new Error('Injected save failure'))
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Load settings' }))
  await user.click(screen.getByRole('button', { name: 'Open model choices' }))
  await user.click(screen.getByRole('option', { name: /CLI default/ }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Injected save failure')
  expect(screen.getByLabelText('Confirmed model')).toHaveTextContent('explicit-model')
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('Explicit model')
})

it('returns focus after the owned quick write re-enables the selected combobox', async () => {
  let resolve: (settings: AppSettings) => void = () => {}
  bridge.updateSettings.mockReturnValueOnce(new Promise<AppSettings>((done) => { resolve = done }))
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Load settings' }))
  await user.click(screen.getByRole('button', { name: 'Open model choices' }))
  await user.click(screen.getByRole('option', { name: /CLI default/ }))
  const input = screen.getByRole('combobox', { name: 'Model' })
  expect(input).toBeDisabled()
  document.body.setAttribute('tabindex', '-1')
  document.body.focus()
  expect(input).not.toHaveFocus()
  resolve(settingsFixture())
  await waitFor(() => expect(input).toHaveFocus())
  expect(input).not.toBeDisabled()
  expect(input).toHaveAttribute('aria-expanded', 'false')
  expect(input).toHaveValue('CLI default · gpt-5.5')
})
