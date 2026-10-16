import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { settingsFixture } from '../test/fixtures'
import { useSettingsController } from './useSettingsController'
import type { AppSettings } from '../tauri'

const bridge = vi.hoisted(() => ({ updateSettings: vi.fn() }))
vi.mock('../tauri', () => ({ updateSettings: bridge.updateSettings }))

beforeEach(() => {
  vi.clearAllMocks()
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } })
})
afterEach(cleanup)

function pendingSettings() {
  let resolve: (settings: AppSettings) => void = () => {}
  const promise = new Promise<AppSettings>((done) => { resolve = done })
  return { promise, resolve }
}
function mount() {
  const result = renderHook(() => useSettingsController({ setError: vi.fn(), setNotice: vi.fn() }))
  act(() => result.result.current.loadSettings(settingsFixture()))
  return result
}

it('serializes synchronous Settings saves through one owned write', async () => {
  const pending = pendingSettings()
  bridge.updateSettings.mockReturnValue(pending.promise)
  const { result } = mount()
  let first = Promise.resolve(false)
  let second = Promise.resolve(false)
  act(() => {
    first = result.current.handleSaveSettings()
    second = result.current.handleSaveSettings()
  })
  expect(bridge.updateSettings).toHaveBeenCalledTimes(1)
  pending.resolve(settingsFixture())
  await act(async () => { await Promise.all([first, second]) })
  expect(await second).toBe(false)
})

it('does not certify a clean Settings checkpoint during a pending write', async () => {
  const pending = pendingSettings()
  bridge.updateSettings.mockReturnValue(pending.promise)
  const { result } = mount()
  let save = Promise.resolve(false)
  act(() => { save = result.current.handleSaveSettings() })
  const checkpoint = result.current.captureSettingsCheckpoint()
  expect(checkpoint()).toBe(false)
  pending.resolve(settingsFixture())
  await act(async () => { await save })
  expect(checkpoint()).toBe(false)
})

it('saves a quick choice from confirmed settings while preserving staged provider and prompt edits', async () => {
  bridge.updateSettings.mockImplementation(async (settings: AppSettings) => settings)
  const { result } = mount()
  act(() => result.current.updateSettingsDraft({ selectedAiProvider: 'claude_code', generationSystemPrompt: 'Authored unsaved prompt',
    selectedAiModelsByProvider: { claude_code: 'staged-claude', codex_cli: 'staged-codex', copilot_cli: null } }))
  await act(async () => { expect(await result.current.persistModelChoice('codex_cli', 'quick-codex')).toBe(true) })
  expect(bridge.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ selectedAiProvider: 'codex_cli',
    generationSystemPrompt: settingsFixture().generationSystemPrompt, selectedAiModel: 'quick-codex' }))
  expect(result.current.settingsDraft).toMatchObject({ selectedAiProvider: 'claude_code', generationSystemPrompt: 'Authored unsaved prompt',
    selectedAiModelsByProvider: { claude_code: 'staged-claude', codex_cli: 'staged-codex' } })
  expect(result.current.selectedModel).toBe('quick-codex')
})

it('preserves draft edits made while awaiting a quick write and rejects a synchronous competing save', async () => {
  const pending = pendingSettings()
  bridge.updateSettings.mockReturnValue(pending.promise)
  const { result } = mount()
  let quick = Promise.resolve(false)
  act(() => { quick = result.current.persistModelChoice('codex_cli', 'chosen') })
  const checkpoint = result.current.captureSettingsCheckpoint()
  expect(checkpoint()).toBe(false)
  expect(result.current.selectedModel).toBe('default')
  await act(async () => {
    expect(await result.current.handleSaveSettings()).toBe(false)
    expect(await result.current.persistModelChoice('codex_cli', 'competing-choice')).toBe(false)
  })
  act(() => result.current.updateSettingsDraft({ generationSystemPrompt: 'Edited during save',
    selectedAiModelsByProvider: { claude_code: null, codex_cli: 'newer-draft', copilot_cli: null } }))
  pending.resolve(settingsFixture({ selectedAiModel: 'chosen', selectedAiModelsByProvider: { claude_code: null, codex_cli: 'chosen', copilot_cli: null } }))
  await act(async () => { await quick })
  expect(result.current.settingsDraft?.generationSystemPrompt).toBe('Edited during save')
  expect(result.current.settingsDraft?.selectedAiModelsByProvider?.codex_cli).toBe('newer-draft')
  expect(result.current.selectedModel).toBe('chosen')
  expect(checkpoint()).toBe(false)
  expect(bridge.updateSettings).toHaveBeenCalledTimes(1)
})

it('keeps the prior confirmed model and draft on a rejected quick save', async () => {
  bridge.updateSettings.mockRejectedValue(new Error('Injected save failure'))
  const { result } = mount()
  const before = result.current.settingsDraft
  await act(async () => { expect(await result.current.persistModelChoice('codex_cli', 'rejected')).toBe(false) })
  expect(result.current.selectedModel).toBe('default')
  expect(result.current.settingsDraft).toEqual(before)
  expect(result.current.settingsWritePending).toBe(false)
})

it('saves Copilot Automatic separately without changing another provider selection', async () => {
  bridge.updateSettings.mockImplementation(async (settings: AppSettings) => settings)
  const { result } = mount()
  await act(async () => { expect(await result.current.persistModelChoice('copilot_cli', 'Auto')).toBe(true) })
  expect(result.current.selectedProvider).toBe('codex_cli')
  expect(result.current.selectedModel).toBe('default')
  expect(result.current.settings?.selectedAiModel).toBe(null)
  expect(result.current.settings?.selectedAiModelsByProvider?.copilot_cli).toBe('auto')
})

it('treats reordered provider maps returned by a quick save as clean values', async () => {
  bridge.updateSettings.mockImplementation(async (settings: AppSettings) => ({ ...settings,
    selectedAiModelsByProvider: { copilot_cli: null, codex_cli: 'chosen', claude_code: null },
    selectedAiReasoningEffortsByProvider: { copilot_cli: null, codex_cli: null, claude_code: null },
  }))
  const { result } = mount()
  await act(async () => { expect(await result.current.persistModelChoice('codex_cli', 'chosen')).toBe(true) })
  expect(result.current.settingsDirty).toBe(false)
  expect(result.current.settingsDraft?.selectedAiModelsByProvider?.codex_cli).toBe('chosen')
  act(() => result.current.updateSettingsDraft({ generationSystemPrompt: 'A real unsaved edit' }))
  expect(result.current.settingsDirty).toBe(true)
})

it('keeps absent and explicit null provider overrides distinct in dirty checking', () => {
  const { result } = mount()
  act(() => result.current.updateSettingsDraft({ selectedAiModelsByProvider: undefined }))
  expect(result.current.settingsDirty).toBe(true)
})
