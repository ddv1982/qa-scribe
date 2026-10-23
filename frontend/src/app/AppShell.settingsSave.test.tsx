import '@testing-library/jest-dom/vitest'
import { act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AppShell } from './AppShell'
import { cleanupControllerTest, getTauriMock, renderWithControllerStartup, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each(['success', 'failure'])('retains the Save failure under Try again after provider refresh %s', async (outcome) => {
  const { result } = await renderWithControllerStartup(() => renderHook(() => useAppController()))
  act(() => result.current.openSettingsSection('instructions-settings'))
  await waitFor(() => expect(result.current.providerDiscoveryState).toBe('ready'))
  act(() => result.current.updateSettingsDraft({ generationSystemPrompt: 'Keep this authored instruction' }))
  api.updateSettings.mockRejectedValueOnce(new Error('Settings disk is read-only'))
  await act(async () => { await result.current.handleSaveSettings() })
  const view = render(<AppShell {...result.current} />)
  const feedback = within(screen.getByRole('button', { name: 'Try again' }).closest('.settings-save-feedback')!)
  expect(feedback.getByRole('alert')).toHaveTextContent('Settings disk is read-only')

  if (outcome === 'failure') api.refreshProviderStatus.mockRejectedValueOnce(new Error('Provider bridge disconnected'))
  await act(async () => { await result.current.handleRefreshProviderStatus() })
  view.rerender(<AppShell {...result.current} />)

  expect(result.current.error).toBe(outcome === 'failure' ? 'Something went wrong: Provider bridge disconnected' : null)
  expect(result.current.settingsDraft?.generationSystemPrompt).toBe('Keep this authored instruction')
  expect(result.current.settingsDirty).toBe(true)
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  expect(feedback.getByRole('alert')).toHaveTextContent('Settings disk is read-only')
})
