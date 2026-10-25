import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

function Harness({ disabled = false, showPicker = true }: { disabled?: boolean; showPicker?: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const controller = useSettingsController({ setError, setNotice: vi.fn() })

  return <>
    <button onClick={() => controller.loadSettings(initial)}>Load settings</button>
    <label>Prompt draft<input value={controller.settingsDraft?.generationSystemPrompt ?? ''}
      onChange={(event) => controller.updateSettingsDraft({ generationSystemPrompt: event.target.value })} /></label>
    <textarea aria-label="Chat draft" defaultValue="Keep this draft" />
    {showPicker ? <NextModelSelection provider={provider} value={controller.selectedModel} pending={controller.settingsWritePending}
      disabled={disabled || !controller.settings} catalogEnabled onChange={(value) => { void controller.persistModelChoice('codex_cli', value) }} /> : null}
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
afterEach(() => {
  cleanup()
  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers()
  document.body.removeAttribute('tabindex')
})

async function beginPendingChoice() {
  let resolve: (settings: AppSettings) => void = () => {}
  let reject: (cause: Error) => void = () => {}
  bridge.updateSettings.mockReturnValueOnce(new Promise<AppSettings>((done, fail) => { resolve = done; reject = fail }))
  const user = userEvent.setup()
  const view = render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Load settings' }))
  const arrow = screen.getByRole('button', { name: 'Open model choices' })
  await user.click(arrow)
  act(() => arrow.focus())
  expect(arrow).toHaveFocus()
  await user.click(screen.getByRole('option', { name: /CLI default/ }))
  const input = screen.getByRole('combobox', { name: 'Model' })
  expect(input).toBeDisabled()
  expect(arrow).toHaveFocus()
  vi.useFakeTimers()
  return { view, input, arrow, resolve, reject }
}

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

it.each([false, true])('returns focus from its own arrow after saving with a separate disabled cycle=%s', async (keepDisabled) => {
  const { view, input, arrow, resolve } = await beginPendingChoice()
  if (keepDisabled) view.rerender(<Harness disabled />)
  await act(async () => resolve(settingsFixture()))
  expect(screen.getByLabelText('Confirmed model')).toHaveTextContent('default')
  expect(input).toHaveValue('CLI default · gpt-5.5')
  if (keepDisabled) {
    act(() => { vi.runOnlyPendingTimers() })
    expect(input).toBeDisabled()
    expect(arrow).toHaveFocus()
    view.rerender(<Harness />)
  }
  act(() => { vi.runOnlyPendingTimers() })
  expect(input).not.toBeDisabled()
  expect(input).toHaveFocus()
  expect(input).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Chat draft' })).toHaveValue('Keep this draft')
})

it('preserves external textarea focus during a pending save and consumes the restoration request', async () => {
  const { input, resolve } = await beginPendingChoice()
  const draft = screen.getByRole('textbox', { name: 'Chat draft' })
  act(() => draft.focus())
  await act(async () => resolve(settingsFixture()))
  act(() => { vi.runOnlyPendingTimers() })
  expect(input).toHaveValue('CLI default · gpt-5.5')
  expect(draft).toHaveFocus()
  document.body.setAttribute('tabindex', '-1')
  act(() => document.body.focus())
  fireEvent.click(screen.getByRole('button', { name: 'Load settings' }))
  act(() => { vi.runOnlyPendingTimers() })
  expect(input).toHaveValue('Explicit model')
  expect(document.body).toHaveFocus()
})

it.each(['combobox', 'button'] as const)('preserves another model selector %s focused during a pending save', async (role) => {
  const { input, resolve } = await beginPendingChoice()
  const other = render(<NextModelSelection provider={provider} value="explicit-model" pending={false}
    disabled={false} catalogEnabled onChange={vi.fn()} />)
  const target = within(other.container).getByRole(role, { name: role === 'combobox' ? 'Model' : 'Open model choices' })
  act(() => target.focus())
  await act(async () => resolve(settingsFixture()))
  act(() => { vi.runOnlyPendingTimers() })
  expect(target).toHaveFocus()
  expect(input).toHaveAttribute('aria-expanded', 'false')
  if (role === 'combobox') expect(target).toHaveAttribute('aria-expanded', 'true')
})

it('preserves external focus acquired after settlement before the queued restoration', async () => {
  const { input, resolve } = await beginPendingChoice()
  await act(async () => resolve(settingsFixture()))
  const draft = screen.getByRole('textbox', { name: 'Chat draft' })
  act(() => draft.focus())
  act(() => { vi.runOnlyPendingTimers() })
  expect(draft).toHaveFocus()
  expect(input).not.toHaveFocus()
})

it.each(['resolve', 'reject'] as const)('does not focus an unmounted picker when its pending save later %ss', async (settlement) => {
  const { view, input, resolve, reject } = await beginPendingChoice()
  view.rerender(<Harness showPicker={false} />)
  const draft = screen.getByRole('textbox', { name: 'Chat draft' })
  act(() => draft.focus())
  await act(async () => {
    if (settlement === 'resolve') resolve(settingsFixture())
    else reject(new Error('Cancelled pending choice'))
  })
  act(() => { vi.runOnlyPendingTimers() })
  expect(input.isConnected).toBe(false)
  expect(draft).toHaveFocus()
  expect(screen.queryByRole('combobox', { name: 'Model' })).not.toBeInTheDocument()
  if (settlement === 'resolve') expect(screen.getByLabelText('Confirmed model')).toHaveTextContent('default')
  else expect(screen.getByRole('alert')).toHaveTextContent('Cancelled pending choice')
})

it('cancels queued focus restoration when the picker unmounts', async () => {
  const { view, input, resolve } = await beginPendingChoice()
  await act(async () => resolve(settingsFixture()))
  expect(vi.getTimerCount()).toBeGreaterThan(0)
  view.rerender(<Harness showPicker={false} />)
  expect(vi.getTimerCount()).toBe(0)
  const draft = screen.getByRole('textbox', { name: 'Chat draft' })
  act(() => draft.focus())
  act(() => { vi.runOnlyPendingTimers() })
  expect(input.isConnected).toBe(false)
  expect(draft).toHaveFocus()
})

it('cancels queued focus restoration when disabled before the picker is replaced', async () => {
  const { view, input, resolve } = await beginPendingChoice()
  await act(async () => resolve(settingsFixture()))
  expect(vi.getTimerCount()).toBeGreaterThan(0)
  view.rerender(<Harness disabled />)
  expect(vi.getTimerCount()).toBe(0)
  act(() => { vi.runOnlyPendingTimers() })
  expect(input).toBeDisabled()
  expect(input).not.toHaveFocus()
  view.rerender(<Harness showPicker={false} />)
  const draft = screen.getByRole('textbox', { name: 'Chat draft' })
  act(() => draft.focus())
  act(() => { vi.runOnlyPendingTimers() })
  expect(input.isConnected).toBe(false)
  expect(draft).toHaveFocus()
})
