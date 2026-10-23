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
  const [settingsSaveFeedback, setSettingsSaveFeedback] = useState<SettingsSaveFeedback>({ state: 'idle' })
  const [providerDiscoveryState, setProviderDiscoveryState] = useState<ProviderDiscoveryUiState>(initialCachedProviderStatus ? 'stale' : 'checking')
  const [theme, setTheme] = useState<ThemePreference>(() => initialTheme())
  const [systemTheme, setSystemTheme] = useState(() => currentSystemTheme())
  const settingsSaveResetRef = useRef<number | null>(null)
  const settingsDraftVersionRef = useRef(0)
  const settingsRef = useRef<AppSettings | null>(null)
  const settingsDraftRef = useRef<AppSettings | null>(null)
  const settingsWriteRef = useRef(false)
  const quickWriteVersionRef = useRef(0)
  const [settingsWritePending, setSettingsWritePending] = useState(false)

  const selectedProvider: AiProvider = settings?.selectedAiProvider ?? 'codex_cli'
  const selectedModel = settings ? modelForProvider(settings, selectedProvider) : 'default'
  const providerOptions = providerStatus?.providers ?? []
  const activeProvider = providerOptions.find((provider) => provider.id === selectedProvider) ?? providerOptions[0] ?? null
  // Generation must receive only the QA Scribe override. Passing the visible
  // CLI default back as an override makes "Use CLI default" depend on a stale
  // discovery snapshot instead of letting the CLI resolve its own settings.
  const selectedReasoningEffort = settings ? executionReasoningOverride(settings, activeProvider) : null
  const effectiveAiSelection = settings ? effectiveSelection(settings, activeProvider) : null
  const settingsDirty = Boolean(settings && settingsDraft && settingsFingerprint(settings) !== settingsFingerprint(settingsDraft))
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
    updateSettingsSaveFeedback({ state: 'idle' })
    settingsDraftVersionRef.current += 1
    settingsRef.current = nextSettings
    settingsDraftRef.current = nextSettings
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

  async function persistSettings(nextSettings: AppSettings, draftVersion: number): Promise<AppSettings> {
    setError(null)
    const saved = await updateSettings(nextSettings)
    settingsRef.current = saved
    setSettings(saved)
    if (settingsDraftVersionRef.current === draftVersion) {
      settingsDraftRef.current = saved
      setSettingsDraft(saved)
    }
    setNotice('Settings saved')
    return saved
  }

  async function handleSaveSettings(): Promise<boolean> {
    const draft = settingsDraftRef.current
    if (!draft || settingsWriteRef.current) return false
    settingsWriteRef.current = true
    setSettingsWritePending(true)
    const draftVersion = settingsDraftVersionRef.current
    updateSettingsSaveFeedback({ state: 'saving' })
    try {
      await persistSettings({
        ...draft,
        selectedAiModel: modelOverrideForProvider(draft, draft.selectedAiProvider ?? 'codex_cli'),
      }, draftVersion)
      const draftUnchanged = settingsDraftVersionRef.current === draftVersion
      updateSettingsSaveFeedback({ state: draftUnchanged ? 'saved' : 'idle' })
      if (draftUnchanged) scheduleSettingsSaveReset()
      return true
    } catch (cause) {
      const error = formatError(cause)
      setError(error)
      if (settingsDraftVersionRef.current === draftVersion) {
        updateSettingsSaveFeedback({ state: 'error', error })
      }
      return false
    } finally {
      settingsWriteRef.current = false
      setSettingsWritePending(false)
    }
  }

  async function persistModelChoice(provider: AiProvider, model: string): Promise<boolean> {
    const confirmed = settingsRef.current
    if (!confirmed || settingsWriteRef.current) return false
    const chosen = model.trim()
    const override = !chosen || chosen.toLowerCase() === 'default' ? null
      : provider === 'copilot_cli' && chosen.toLowerCase() === 'auto' ? 'auto' : chosen
    const previous = modelOverrideForProvider(confirmed, provider)
    if (previous === override) return true
    settingsWriteRef.current = true
    quickWriteVersionRef.current += 1
    setSettingsWritePending(true)
    setError(null)
    const next = { ...confirmed, selectedAiModelsByProvider: { ...confirmed.selectedAiModelsByProvider, [provider]: override } }
    next.selectedAiModel = modelOverrideForProvider(next, next.selectedAiProvider ?? 'codex_cli')
    try {
      const saved = await updateSettings(next)
      settingsRef.current = saved
      setSettings(saved)
      const draft = settingsDraftRef.current
      if (draft && modelOverrideForProvider(draft, provider) === previous) {
        const merged = { ...draft, selectedAiModelsByProvider: { ...draft.selectedAiModelsByProvider, [provider]: modelOverrideForProvider(saved, provider) } }
        merged.selectedAiModel = modelOverrideForProvider(merged, merged.selectedAiProvider ?? 'codex_cli')
        settingsDraftVersionRef.current += 1
        settingsDraftRef.current = merged
        setSettingsDraft(merged)
      }
      setNotice('Model preference saved for the next invocation')
      return true
    } catch (cause) {
      setError(formatError(cause))
      return false
    } finally {
      settingsWriteRef.current = false
      setSettingsWritePending(false)
    }
  }

  function modelWritePending() { return settingsWriteRef.current }

  function captureSettingsCheckpoint() {
    const version = settingsDraftVersionRef.current
    const quickVersion = quickWriteVersionRef.current
    const clear = !settingsWriteRef.current
    return () => clear && !settingsWriteRef.current && version === settingsDraftVersionRef.current
      && quickVersion === quickWriteVersionRef.current
  }

  function updateSettingsDraft(patch: Partial<AppSettings>) {
    settingsDraftVersionRef.current += 1
    updateSettingsSaveFeedback({ state: 'idle' })
    const previous = settingsDraftRef.current
    const next = previous ? { ...previous, ...patch } : previous
    settingsDraftRef.current = next
    setSettingsDraft(next)
  }

  function discardSettingsDraft() {
    settingsDraftVersionRef.current += 1
    settingsDraftRef.current = settingsRef.current
    setSettingsDraft(settingsRef.current)
    updateSettingsSaveFeedback({ state: 'idle' })
  }

  function updateSettingsSaveFeedback(feedback: SettingsSaveFeedback) {
    if (settingsSaveResetRef.current) window.clearTimeout(settingsSaveResetRef.current)
    settingsSaveResetRef.current = null
    setSettingsSaveFeedback(feedback)
  }

  function scheduleSettingsSaveReset() {
    if (settingsSaveResetRef.current) window.clearTimeout(settingsSaveResetRef.current)
    settingsSaveResetRef.current = window.setTimeout(() => {
      setSettingsSaveFeedback({ state: 'idle' })
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
    settingsSaveState: settingsSaveFeedback.state,
    settingsSaveError: settingsSaveFeedback.state === 'error' ? settingsSaveFeedback.error : null,
    theme,
    updateSettingsDraft,
    captureSettingsCheckpoint,
    persistModelChoice,
    settingsWritePending,
    modelWritePending,
  }
}

type SettingsSaveFeedback =
  | { state: Exclude<SettingsSaveState, 'error'> }
  | { state: 'error'; error: string }

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

function settingsFingerprint(settings: AppSettings): string {
  const models = settings.selectedAiModelsByProvider
  const efforts = settings.selectedAiReasoningEffortsByProvider
  return JSON.stringify({
    ...settings,
    selectedAiModelsByProvider: models === undefined ? undefined
      : Object.fromEntries(Object.entries(models).sort(([left], [right]) => left.localeCompare(right))),
    selectedAiReasoningEffortsByProvider: efforts === undefined ? undefined
      : Object.fromEntries(Object.entries(efforts).sort(([left], [right]) => left.localeCompare(right))),
  })
}
