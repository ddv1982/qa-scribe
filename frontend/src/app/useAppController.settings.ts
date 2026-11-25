import { useState } from 'react'
import { useSettingsController } from '../hooks/useSettingsController'
import { effectiveSelection, executionReasoningOverride, modelForProvider } from '../settings/defaults'
import type { AiProvider } from '../tauri'
import type { AiSelection } from './types'

export function useAppControllerSettings(feedback: Parameters<typeof useSettingsController>[0]) {
  const settingsController = useSettingsController(feedback)
  const [chatProviderChoice, setChatProviderChoice] = useState<AiProvider | ''>('')
  const selection: AiSelection = {
    modelWritePending: settingsController.modelWritePending,
    selectedProvider: settingsController.selectedProvider,
    selectedModel: settingsController.selectedModel,
    selectedReasoningEffort: settingsController.selectedReasoningEffort,
  }
  const { settings, providerStatus } = settingsController
  const chatProviderId = chatProviderChoice || selection.selectedProvider
  const chatProvider = providerStatus?.providers.find(provider => provider.id === chatProviderId) ?? null
  const chatSelection: AiSelection = {
    modelWritePending: selection.modelWritePending,
    selectedProvider: chatProviderId,
    selectedModel: settings ? modelForProvider(settings, chatProviderId) : 'default',
    selectedReasoningEffort: settings && chatProvider ? executionReasoningOverride(settings, chatProvider) : null,
  }
  const chatWarning = settings && chatProvider ? effectiveSelection(settings, chatProvider).warning
    ?? chatProvider.defaultSnapshot.warnings.find(warning => warning.severity === 'blocking')?.message ?? null : null
  // The settings part of the AppController surface.
  const settingsView = {
    savedSettings: settings,
    chatExecution: { provider: chatProvider, selection: chatSelection, warning: chatWarning, providerChoice: chatProviderChoice, setProviderChoice: setChatProviderChoice },
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
