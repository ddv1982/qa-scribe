import { useEffect, useRef, useState } from 'react'
import {
  getProviderStatus,
  refreshProviderStatus as refreshProviderStatusCommand,
  updateSettings,
  type AiProvider,
  type AppSettings,
  type ProviderStatus,
} from '../tauri'
import {
  effectiveSelection,
  executionReasoningOverride,
  modelForProvider,
  modelOverrideForProvider,
} from '../settings/defaults'
import { currentSystemTheme, formatError, initialTheme, resolveThemePreference } from '../ui/format'
import type { ProviderDiscoveryUiState, SettingsSaveState, ThemePreference } from '../ui/types'
import { mergeFastProviderStatus, readCachedProviderStatus, writeCachedProviderStatus } from '../settings/providerStatusCache'

export function useSettingsController({
  setError,
  setNotice,
}: {
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
}) {
  const [initialCachedProviderStatus] = useState<ProviderStatus | null>(() => readCachedProviderStatus())
  const cachedProviderStatusRef = useRef<ProviderStatus | null>(initialCachedProviderStatus)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(initialCachedProviderStatus)
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null)
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>('idle')
  const [providerDiscoveryState, setProviderDiscoveryState] = useState<ProviderDiscoveryUiState>(initialCachedProviderStatus ? 'stale' : 'checking')
  const [theme, setTheme] = useState<ThemePreference>(() => initialTheme())
  const [systemTheme, setSystemTheme] = useState(() => currentSystemTheme())
  const settingsSaveResetRef = useRef<number | null>(null)
  const settingsDraftVersionRef = useRef(0)

  const selectedProvider: AiProvider = settings?.selectedAiProvider ?? 'codex_cli'
  const selectedModel = settings ? modelForProvider(settings, selectedProvider) : 'default'
  const providerOptions = providerStatus?.providers ?? []
  const activeProvider = providerOptions.find((provider) => provider.id === selectedProvider) ?? providerOptions[0] ?? null
  // Generation must receive only the QA Scribe override. Passing the visible
  // CLI default back as an override makes "Use CLI default" depend on a stale
  // discovery snapshot instead of letting the CLI resolve its own settings.
  const selectedReasoningEffort = settings ? executionReasoningOverride(settings, activeProvider) : null
  const effectiveAiSelection = settings ? effectiveSelection(settings, activeProvider) : null
  const settingsDirty = Boolean(settings && settingsDraft && JSON.stringify(settings) !== JSON.stringify(settingsDraft))
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
    settingsDraftVersionRef.current += 1
    setSettings(nextSettings)
    setSettingsDraft(nextSettings)
    if (nextProviderStatus) {
      cachedProviderStatusRef.current = null
      setProviderStatus(nextProviderStatus)
    }
  }

  async function refreshProviderStatus() {
    setProviderDiscoveryState('refreshing')
    try {
      const status = await refreshProviderStatusCommand()
      writeCachedProviderStatus(status)
      setProviderStatus(status)
      setProviderDiscoveryState(discoveryUiState(status))
    } catch (cause) {
      setProviderDiscoveryState((previous) => previous === 'ready' || previous === 'stale' ? 'stale' : 'error')
      throw cause
    }
  }

  async function loadProviderStatus() {
    setProviderDiscoveryState('checking')
    const fastStatus = await getProviderStatus()
    const status = mergeFastProviderStatus(fastStatus, cachedProviderStatusRef.current)
    cachedProviderStatusRef.current = null
    setProviderStatus(status)
    setProviderDiscoveryState(discoveryUiState(status))
  }

  async function discoverProviderDefaults() {
    setProviderDiscoveryState('checking')
    try {
      const deepStatus = await refreshProviderStatusCommand()
      writeCachedProviderStatus(deepStatus)
      setProviderStatus(deepStatus)
      setProviderDiscoveryState(discoveryUiState(deepStatus))
    } catch {
      setProviderDiscoveryState('error')
    }
  }

  async function persistSettings(nextSettings: AppSettings, draftVersion: number): Promise<AppSettings | null> {
    try {
      setError(null)
      const saved = await updateSettings(nextSettings)
      setSettings(saved)
      if (settingsDraftVersionRef.current === draftVersion) setSettingsDraft(saved)
      setNotice('Settings saved')
      return saved
    } catch (cause) {
      setError(formatError(cause))
      return null
    }
  }

  async function handleSaveSettings(): Promise<boolean> {
    if (!settingsDraft) return false
    const draftVersion = settingsDraftVersionRef.current
    setSettingsSaveState('saving')
    const saved = await persistSettings({
      ...settingsDraft,
      selectedAiModel: modelOverrideForProvider(settingsDraft, settingsDraft.selectedAiProvider ?? 'codex_cli'),
    }, draftVersion)
    const draftUnchanged = settingsDraftVersionRef.current === draftVersion
    setSettingsSaveState(saved ? (draftUnchanged ? 'saved' : 'idle') : 'error')
    if (saved && draftUnchanged) scheduleSettingsSaveReset()
    return Boolean(saved)
  }

  function updateSettingsDraft(patch: Partial<AppSettings>) {
    settingsDraftVersionRef.current += 1
    setSettingsSaveState('idle')
    setSettingsDraft((previous) => (previous ? { ...previous, ...patch } : previous))
  }

  function discardSettingsDraft() {
    settingsDraftVersionRef.current += 1
    setSettingsDraft(settings)
    setSettingsSaveState('idle')
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
    effectiveAiSelection,
    handleSaveSettings,
    discoverProviderDefaults,
    loadProviderStatus,
    loadSettings,
    discardSettingsDraft,
    providerDiscoveryState,
    providerStatus,
    refreshProviderStatus,
    selectedModel,
    selectedProvider,
    selectedReasoningEffort,
    setTheme,
    settings,
    settingsDraft,
    settingsDirty,
    settingsSaveState,
    theme,
    updateSettingsDraft,
  }
}

function discoveryUiState(status: ProviderStatus): ProviderDiscoveryUiState {
  const states = status.providers.map((provider) => provider.defaultSnapshot.state)
  if (states.some((state) => state === 'stale')) return 'stale'
  if (states.some((state) => state === 'unresolved')) return 'error'
  if (states.some((state) => state === 'unchecked')) return 'checking'
  return 'ready'
}
