import { useEffect, useRef, useState } from 'react'
import {
  getProviderStatus,
  refreshProviderStatus as refreshProviderStatusCommand,
  updateSettings,
  type AiProvider,
  type AppSettings,
  type ProviderStatus,
} from '../tauri'
import { modelForProvider, providerModelDefaults } from '../settings/defaults'
import { currentSystemTheme, formatError, initialTheme, resolveThemePreference } from '../ui/format'
import type { SettingsSaveState, ThemePreference } from '../ui/types'

export function useSettingsController({
  bootedRef,
  setError,
  setNotice,
}: {
  bootedRef: { current: boolean }
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>('codex_cli')
  const [selectedModel, setSelectedModel] = useState('default')
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null)
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>('idle')
  const [theme, setTheme] = useState<ThemePreference>(() => initialTheme())
  const [systemTheme, setSystemTheme] = useState(() => currentSystemTheme())
  const settingsSaveResetRef = useRef<number | null>(null)

  const providerOptions = providerStatus?.providers ?? []
  const activeProvider = providerOptions.find((provider) => provider.id === selectedProvider) ?? providerOptions[0] ?? null
  const selectedReasoningEffort = settings?.selectedAiReasoningEffortsByProvider?.[selectedProvider] ?? null
  const resolvedTheme = resolveThemePreference(theme, systemTheme)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = () => setSystemTheme(mediaQuery.matches ? 'dark' : 'light')

    updateSystemTheme()
    mediaQuery.addEventListener('change', updateSystemTheme)
    return () => mediaQuery.removeEventListener('change', updateSystemTheme)
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
    window.localStorage.setItem('qa-scribe-theme', theme)
  }, [resolvedTheme, theme])

  useEffect(() => {
    return () => {
      if (settingsSaveResetRef.current) window.clearTimeout(settingsSaveResetRef.current)
    }
  }, [])

  useEffect(() => {
    if (!settings || !bootedRef.current) return
    if (selectedProvider === settings.selectedAiProvider && selectedModel === settings.selectedAiModel) return

    const timeout = window.setTimeout(() => {
      const selectedAiModelsByProvider = {
        ...providerModelDefaults(),
        ...settings.selectedAiModelsByProvider,
        [selectedProvider]: selectedModel.trim() || 'default',
      }
      void persistSettings({
        ...settings,
        selectedAiProvider: selectedProvider,
        selectedAiModel: selectedModel.trim() || 'default',
        selectedAiModelsByProvider,
      })
    }, 550)
    return () => window.clearTimeout(timeout)
  }, [settings, selectedProvider, selectedModel]) // eslint-disable-line react-hooks/exhaustive-deps -- persistence is intentionally keyed to saved settings and selected model fields

  function loadSettings(nextSettings: AppSettings, nextProviderStatus: ProviderStatus | null = null) {
    setSettings(nextSettings)
    setSettingsDraft(nextSettings)
    setProviderStatus(nextProviderStatus)
    setSelectedProvider(nextSettings.selectedAiProvider)
    setSelectedModel(modelForProvider(nextSettings, nextSettings.selectedAiProvider))
  }

  async function refreshProviderStatus() {
    setProviderStatus(await refreshProviderStatusCommand())
  }

  async function loadProviderStatus() {
    setProviderStatus(await getProviderStatus())
  }

  async function persistSettings(nextSettings: AppSettings): Promise<AppSettings | null> {
    try {
      setError(null)
      const saved = await updateSettings(nextSettings)
      setSettings(saved)
      setSettingsDraft(saved)
      setSelectedProvider(saved.selectedAiProvider)
      setSelectedModel(saved.selectedAiModel)
      setNotice('Settings saved')
      return saved
    } catch (cause) {
      setError(formatError(cause))
      return null
    }
  }

  async function handleSaveSettings() {
    if (!settingsDraft) return
    try {
      setSettingsSaveState('saving')
      const saved = await persistSettings({
        ...settingsDraft,
        selectedAiModel: modelForProvider(settingsDraft, settingsDraft.selectedAiProvider),
      })
      setSettingsSaveState(saved ? 'saved' : 'error')
      if (saved) scheduleSettingsSaveReset()
    } finally {
      // The caller owns busyAction so saving can share the app-wide spinner contract.
    }
  }

  function updateSettingsDraft(patch: Partial<AppSettings>) {
    setSettingsSaveState('idle')
    setSettingsDraft((previous) => (previous ? { ...previous, ...patch } : previous))
  }

  function scheduleSettingsSaveReset() {
    if (settingsSaveResetRef.current) window.clearTimeout(settingsSaveResetRef.current)
    settingsSaveResetRef.current = window.setTimeout(() => {
      setSettingsSaveState('idle')
      settingsSaveResetRef.current = null
    }, 1800)
  }

  return {
    activeProvider,
    handleSaveSettings,
    loadProviderStatus,
    loadSettings,
    persistSettings,
    providerStatus,
    refreshProviderStatus,
    selectedModel,
    selectedProvider,
    selectedReasoningEffort,
    setTheme,
    settings,
    settingsDraft,
    settingsSaveState,
    theme,
    updateSettingsDraft,
  }
}
