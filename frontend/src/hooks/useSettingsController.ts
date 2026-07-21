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
  const providerStatusRef = useRef<ProviderStatus | null>(initialCachedProviderStatus)
  const providerObservationRef = useRef<ProviderObservationCoordinator>({
    nextSequence: 0,
    accepted: null,
    leading: null,
  })
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

  function loadSettings(nextSettings: AppSettings) {
    settingsDraftVersionRef.current += 1
    setSettings(nextSettings)
    setSettingsDraft(nextSettings)
  }

  async function refreshProviderStatus() {
    const observation = beginProviderObservation('deep', 'refreshing')
    try {
      const status = await refreshProviderStatusCommand()
      acceptProviderObservation(observation, status, true)
    } catch (cause) {
      if (failProviderObservation(observation)) throw cause
    }
  }

  async function loadProviderStatus() {
    const observation = beginProviderObservation('fast', 'checking')
    try {
      const fastStatus = await getProviderStatus()
      const status = mergeFastProviderStatus(fastStatus, cachedProviderStatusRef.current)
      acceptProviderObservation(observation, status, false)
    } catch (cause) {
      if (failProviderObservation(observation)) throw cause
    }
  }

  async function discoverProviderDefaults() {
    const observation = beginProviderObservation('deep', 'checking')
    try {
      const deepStatus = await refreshProviderStatusCommand()
      acceptProviderObservation(observation, deepStatus, true)
    } catch {
      failProviderObservation(observation)
    }
  }

  function beginProviderObservation(
    depth: ProviderObservationDepth,
    pendingState: ProviderDiscoveryUiState,
  ): ProviderObservation {
    const coordinator = providerObservationRef.current
    const observation = { sequence: ++coordinator.nextSequence, depth }
    const boundary = coordinator.leading ?? coordinator.accepted
    if (!boundary || compareProviderObservations(observation, boundary) > 0) {
      coordinator.leading = observation
      setProviderDiscoveryState(pendingState)
    }
    return observation
  }

  function acceptProviderObservation(
    observation: ProviderObservation,
    status: ProviderStatus,
    cache: boolean,
  ): boolean {
    const coordinator = providerObservationRef.current
    if (coordinator.accepted && compareProviderObservations(observation, coordinator.accepted) < 0) return false
    const isLeading = !coordinator.leading
      || compareProviderObservations(observation, coordinator.leading) >= 0

    coordinator.accepted = observation
    if (isLeading) coordinator.leading = observation
    cachedProviderStatusRef.current = null
    providerStatusRef.current = status
    if (cache) writeCachedProviderStatus(status)
    setProviderStatus(status)
    if (isLeading) setProviderDiscoveryState(discoveryUiState(status))
    return true
  }

  function failProviderObservation(observation: ProviderObservation): boolean {
    const coordinator = providerObservationRef.current
    if (!sameProviderObservation(observation, coordinator.leading)) return false
    coordinator.leading = coordinator.accepted
    setProviderDiscoveryState(providerStatusRef.current ? 'stale' : 'error')
    return true
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

type ProviderObservationDepth = 'fast' | 'deep'

type ProviderObservation = {
  sequence: number
  depth: ProviderObservationDepth
}

type ProviderObservationCoordinator = {
  nextSequence: number
  accepted: ProviderObservation | null
  leading: ProviderObservation | null
}

const PROVIDER_OBSERVATION_DEPTH: Record<ProviderObservationDepth, number> = {
  fast: 0,
  deep: 1,
}

function compareProviderObservations(left: ProviderObservation, right: ProviderObservation): number {
  return PROVIDER_OBSERVATION_DEPTH[left.depth] - PROVIDER_OBSERVATION_DEPTH[right.depth]
    || left.sequence - right.sequence
}

function sameProviderObservation(
  left: ProviderObservation,
  right: ProviderObservation | null,
): boolean {
  return Boolean(right && left.sequence === right.sequence && left.depth === right.depth)
}

function discoveryUiState(status: ProviderStatus): ProviderDiscoveryUiState {
  const states = status.providers.map((provider) => provider.defaultSnapshot.state)
  if (states.some((state) => state === 'stale')) return 'stale'
  if (states.some((state) => state === 'unresolved')) return 'error'
  if (states.some((state) => state === 'unchecked')) return 'checking'
  return 'ready'
}
