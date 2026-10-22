import { act, cleanup, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { settingsFixture } from '../test/fixtures'
import type { AppSettings } from '../tauri'
import { useSettingsController } from './useSettingsController'

const bridge = vi.hoisted(() => ({ updateSettings: vi.fn() }))
vi.mock('../tauri', () => ({ updateSettings: bridge.updateSettings }))

beforeEach(() => {
  vi.resetAllMocks()
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {} } })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function mount() {
  return renderHook(() => {
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const settings = useSettingsController({ setError, setNotice })
    return { ...settings, error, setError, notice }
  })
}

async function failedSave() {
  const controller = mount()
  act(() => {
    controller.result.current.loadSettings(settingsFixture())
    controller.result.current.updateSettingsDraft({ generationSystemPrompt: 'Keep this authored instruction' })
  })
  bridge.updateSettings.mockRejectedValueOnce(new Error('Settings disk is read-only'))
  await act(async () => { expect(await controller.result.current.handleSaveSettings()).toBe(false) })
  return controller
}

function pendingSettings() {
  let resolve: (settings: AppSettings) => void = () => {}
  let reject: (error: Error) => void = () => {}
  const promise = new Promise<AppSettings>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

it('retains the Save detail and draft when global feedback is cleared or replaced', async () => {
  const { result } = await failedSave()
  expect(result.current.error).toBe('Something went wrong: Settings disk is read-only')
  for (const error of [null, 'Provider bridge disconnected']) {
    act(() => result.current.setError(error))
    expect(result.current.error).toBe(error)
    expect(result.current.settingsSaveState).toBe('error')
    expect(result.current.settingsSaveError).toBe('Something went wrong: Settings disk is read-only')
    expect(result.current.settingsDraft?.generationSystemPrompt).toBe('Keep this authored instruction')
    expect(result.current.settingsDirty).toBe(true)
  }
})

it('clears the Save detail only when a retry starts and confirms the successful retry', async () => {
  const { result } = await failedSave()
  const pending = pendingSettings()
  bridge.updateSettings.mockReturnValueOnce(pending.promise)
  let retry = Promise.resolve(false)
  act(() => { retry = result.current.handleSaveSettings() })
  expect(result.current.settingsSaveState).toBe('saving')
  expect(result.current.settingsSaveError).toBeNull()
  expect(result.current.error).toBeNull()
  expect(result.current.settingsDraft?.generationSystemPrompt).toBe('Keep this authored instruction')
  await act(async () => { expect(await result.current.handleSaveSettings()).toBe(false) })
  expect(result.current.settingsSaveState).toBe('saving')
  expect(result.current.settingsSaveError).toBeNull()
  pending.resolve(settingsFixture({ generationSystemPrompt: 'Keep this authored instruction' }))
  await act(async () => { expect(await retry).toBe(true) })
  expect(result.current.settingsSaveState).toBe('saved')
  expect(result.current.settingsSaveError).toBeNull()
  expect(result.current.settingsDirty).toBe(false)
  expect(result.current.notice).toBe('Settings saved')
  expect(bridge.updateSettings).toHaveBeenCalledTimes(2)
})

it.each(['edit', 'discard', 'load'])('clears Save feedback on %s', async (action) => {
  const { result } = await failedSave()
  act(() => {
    if (action === 'edit') result.current.updateSettingsDraft({ generationSystemPrompt: 'New instruction' })
    if (action === 'discard') result.current.discardSettingsDraft()
    if (action === 'load') result.current.loadSettings(settingsFixture({ generationSystemPrompt: 'Loaded instruction' }))
  })
  expect(result.current.settingsSaveState).toBe('idle')
  expect(result.current.settingsSaveError).toBeNull()
  expect(result.current.settingsDraft?.generationSystemPrompt).toBe(action === 'edit' ? 'New instruction'
    : action === 'load' ? 'Loaded instruction' : settingsFixture().generationSystemPrompt)
  expect(result.current.settingsDirty).toBe(action === 'edit')
})

it.each(['edit', 'discard', 'load'])('does not restore stale Save feedback when %s supersedes a pending failure', async (action) => {
  const { result } = await failedSave()
  const pending = pendingSettings()
  bridge.updateSettings.mockReturnValueOnce(pending.promise)
  let retry = Promise.resolve(false)
  act(() => { retry = result.current.handleSaveSettings() })
  act(() => {
    if (action === 'edit') result.current.updateSettingsDraft({ generationSystemPrompt: 'New instruction' })
    if (action === 'discard') result.current.discardSettingsDraft()
    if (action === 'load') result.current.loadSettings(settingsFixture())
  })
  pending.reject(new Error('Late Save failure'))
  await act(async () => { expect(await retry).toBe(false) })
  expect(result.current.settingsSaveState).toBe('idle')
  expect(result.current.settingsSaveError).toBeNull()
  expect(result.current.error).toBe('Something went wrong: Late Save failure')
  expect(result.current.settingsDraft?.generationSystemPrompt).toBe(action === 'edit' ? 'New instruction' : settingsFixture().generationSystemPrompt)
})

it.each(['success', 'failure'])('retains the Save detail during a model write, rejected competing Save and model write %s', async (outcome) => {
  const { result } = await failedSave()
  const pending = pendingSettings()
  bridge.updateSettings.mockReturnValueOnce(pending.promise)
  let quickWrite = Promise.resolve(false)
  act(() => { quickWrite = result.current.persistModelChoice('codex_cli', 'chosen') })
  await act(async () => { expect(await result.current.handleSaveSettings()).toBe(false) })
  expect(result.current.error).toBeNull()
  expect(result.current.settingsSaveState).toBe('error')
  expect(result.current.settingsSaveError).toBe('Something went wrong: Settings disk is read-only')
  if (outcome === 'success') pending.resolve(settingsFixture({ selectedAiModelsByProvider: { codex_cli: 'chosen' } }))
  else pending.reject(new Error('Model preference failed'))
  await act(async () => { expect(await quickWrite).toBe(outcome === 'success') })
  expect(result.current.error).toBe(outcome === 'success' ? null : 'Something went wrong: Model preference failed')
  expect(result.current.settingsSaveState).toBe('error')
  expect(result.current.settingsSaveError).toBe('Something went wrong: Settings disk is read-only')
  expect(result.current.settingsDraft?.generationSystemPrompt).toBe('Keep this authored instruction')
  expect(result.current.settingsDirty).toBe(true)
  expect(bridge.updateSettings).toHaveBeenCalledTimes(2)
})

it('does not fabricate Save feedback before settings are loaded', async () => {
  const { result } = mount()
  await act(async () => { expect(await result.current.handleSaveSettings()).toBe(false) })
  expect(result.current.settingsSaveState).toBe('idle')
  expect(result.current.settingsSaveError).toBeNull()
  expect(result.current.error).toBeNull()
  expect(bridge.updateSettings).not.toHaveBeenCalled()
})

it('does not let an earlier saved-status timer erase a later Save failure', async () => {
  vi.useFakeTimers()
  const { result } = mount()
  act(() => result.current.loadSettings(settingsFixture()))
  bridge.updateSettings.mockResolvedValueOnce(settingsFixture())
  await act(async () => { expect(await result.current.handleSaveSettings()).toBe(true) })
  act(() => result.current.updateSettingsDraft({ generationSystemPrompt: 'New instruction' }))
  bridge.updateSettings.mockRejectedValueOnce(new Error('New Save failure'))
  await act(async () => { expect(await result.current.handleSaveSettings()).toBe(false) })
  act(() => { vi.advanceTimersByTime(1800) })
  expect(result.current.settingsSaveState).toBe('error')
  expect(result.current.settingsSaveError).toBe('Something went wrong: New Save failure')
})
