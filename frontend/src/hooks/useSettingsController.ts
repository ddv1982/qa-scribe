import { useEffect, useRef, useState } from 'react'
import {
  getProviderStatus,
  refreshProviderStatus as refreshProviderStatusCommand,
  updateSettings,
  type AiProvider,
  type AppSettings,
  type ProviderStatus,
} from '../tauri'
import { modelForProvider } from '../settings/defaults'
import { currentSystemTheme, formatError, initialTheme, resolveThemePreference } from '../ui/format'
import type { SettingsSaveState, ThemePreference } from '../ui/types'

export function useSettingsController({
  setError,
  setNotice,
}: {
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null)
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>('idle')
  const [theme, setTheme] = useState<ThemePreference>(() => initialTheme())
  const [systemTheme, setSystemTheme] = useState(() => currentSystemTheme())
  const settingsSaveResetRef = useRef<number | null>(null)

  const selectedProvider: AiProvider = settings?.selectedAiProvider ?? 'codex_cli'
  const selectedModel = settings ? modelForProvider(settings, selectedProvider) : 'default'
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

  function loadSettings(nextSettings: AppSettings, nextProviderStatus: ProviderStatus | null = null) {
    setSettings(nextSettings)
    setSettingsDraft(nextSettings)
    setProviderStatus(nextProviderStatus)
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
