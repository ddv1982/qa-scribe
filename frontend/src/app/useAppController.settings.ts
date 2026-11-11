import { useSettingsController } from '../hooks/useSettingsController'
import type { AiSelection } from './types'

export function useAppControllerSettings(feedback: Parameters<typeof useSettingsController>[0]) {
  const settingsController = useSettingsController(feedback)
  const selection: AiSelection = {
    modelWritePending: settingsController.modelWritePending,
    selectedProvider: settingsController.selectedProvider,
    selectedModel: settingsController.selectedModel,
    selectedReasoningEffort: settingsController.selectedReasoningEffort,
  }
  // The settings part of the AppController surface.
  const settingsView = {
    activeProvider: settingsController.activeProvider,
    discardSettingsDraft: settingsController.discardSettingsDraft,
    effectiveAiSelection: settingsController.effectiveAiSelection,
    providerDiscoveryState: settingsController.providerDiscoveryState,
    providerStatus: settingsController.providerStatus,
    selectedModel: settingsController.selectedModel,
    selectedProvider: settingsController.selectedProvider,
    settingsDraft: settingsController.settingsDraft,
    settingsDirty: settingsController.settingsDirty,
    settingsSaveState: settingsController.settingsSaveState,
    settingsSaveError: settingsController.settingsSaveError,
    setTheme: settingsController.setTheme,
    theme: settingsController.theme,
    updateSettingsDraft: settingsController.updateSettingsDraft,
    persistModelChoice: settingsController.persistModelChoice,
    settingsWritePending: settingsController.settingsWritePending,
    selectedReasoningEffort: settingsController.selectedReasoningEffort,
    modelSelectionReady: Boolean(settingsController.settings),
  }
  return { ...settingsController, selection, settingsView }
}
