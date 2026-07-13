import {
  PROVIDER_MODEL_DEFAULTS,
  PROVIDER_REASONING_DEFAULTS,
  type AiProvider,
  type AppSettings,
  type ProviderDefaultOrigin,
  type ProviderDiscoveryState,
  type ProviderWarning,
  type ProviderStatus,
} from '../tauri'

export type EffectiveAiSelection = {
  model: string
  reasoning: string | null
  modelOverride: string | null
  reasoningOverride: string | null
  delegatesModel: boolean
  delegatesReasoning: boolean
  modelOrigin: ProviderDefaultOrigin | null
  reasoningOrigin: ProviderDefaultOrigin | null
  discoveryState: ProviderDiscoveryState | 'missing'
  checkedAt: string | null
  runtimeSummary: string
  warning: string | null
  advisories: ProviderWarning[]
}

// The provider defaults are single-sourced in Rust (`core::domain::settings`)
// and reach the frontend as generated bindings constants, so these can never
// drift from the backend's `AppSettings` defaults.
export function providerModelDefaults(): Record<AiProvider, string | null> {
  return PROVIDER_MODEL_DEFAULTS
}

export function providerReasoningDefaults(): Record<AiProvider, string | null> {
  return PROVIDER_REASONING_DEFAULTS
}

export function modelForProvider(settings: AppSettings, provider: AiProvider): string {
  return modelOverrideForProvider(settings, provider) ?? 'default'
}

export function modelOverrideForProvider(settings: AppSettings, provider: AiProvider): string | null {
  return settings.selectedAiModelsByProvider?.[provider]
    ?? (provider === settings.selectedAiProvider ? settings.selectedAiModel : null)
    ?? null
}

export function reasoningOverrideForProvider(settings: AppSettings, provider: AiProvider): string | null {
  return settings.selectedAiReasoningEffortsByProvider?.[provider] ?? null
}

export function effectiveSelection(
  settings: AppSettings,
  provider: ProviderStatus['providers'][number] | null,
): EffectiveAiSelection {
  const providerId = (provider?.id ?? settings.selectedAiProvider) as AiProvider
  const modelOverride = modelOverrideForProvider(settings, providerId)
  const reasoningOverride = reasoningOverrideForProvider(settings, providerId)
  const model = modelOverride ?? provider?.defaultSnapshot.model.value ?? 'CLI resolves at run time'
  const descriptor = provider?.models.find((candidate) => candidate.id === model)
  const modelRecommendation = descriptor?.defaultReasoningEffort
    ?? (model === provider?.defaultSnapshot.model.value ? provider.defaultSnapshot.reasoningEffort.recommendedValue : null)
  const reasoning = reasoningOverride === 'model-recommended'
    ? modelRecommendation
    : reasoningOverride ?? provider?.defaultSnapshot.reasoningEffort.value ?? null
  const warning = reasoning && descriptor?.reasoningEfforts.length
    && !descriptor.reasoningEfforts.includes(reasoning)
    ? `Reasoning “${reasoning}” is not advertised for ${model}. Choose a compatible value before generation.`
    : null
  const delegatesModel = modelOverride === null
  const delegatesReasoning = reasoningOverride === null
  return {
    model,
    reasoning,
    modelOverride,
    reasoningOverride,
    delegatesModel,
    delegatesReasoning,
    modelOrigin: delegatesModel ? provider?.defaultSnapshot.model.origin ?? null : null,
    reasoningOrigin: delegatesReasoning ? provider?.defaultSnapshot.reasoningEffort.origin ?? null : null,
    discoveryState: provider?.defaultSnapshot.state ?? 'missing',
    checkedAt: provider?.defaultSnapshot.checkedAt ?? null,
    runtimeSummary: runtimeSelectionSummary(delegatesModel, delegatesReasoning),
    warning,
    advisories: provider?.defaultSnapshot.warnings.filter((item) => item.severity === 'advisory') ?? [],
  }
}

export function executionReasoningOverride(
  settings: AppSettings,
  provider: ProviderStatus['providers'][number] | null,
): string | null {
  const providerId = (provider?.id ?? settings.selectedAiProvider) as AiProvider
  const override = reasoningOverrideForProvider(settings, providerId)
  if (override !== 'model-recommended') return override
  return effectiveSelection(settings, provider).reasoning
}

export function originSummary(origin: ProviderDefaultOrigin | null): string | null {
  if (!origin) return null
  if (origin.displayPath && ['userConfig', 'projectConfig', 'configFile'].includes(origin.kind)) {
    return origin.displayPath
  }
  return origin.displayPath ? `${origin.label} (${origin.displayPath})` : origin.label
}

export function defaultSnapshotNeedsRefresh(
  provider: ProviderStatus['providers'][number] | null,
  now = Date.now(),
): boolean {
  const snapshot = provider?.defaultSnapshot
  if (!snapshot || ['unchecked', 'stale', 'unresolved'].includes(snapshot.state)) return true
  if (!snapshot.checkedAt) return true
  const checkedAt = Date.parse(snapshot.checkedAt)
  return Number.isNaN(checkedAt) || now - checkedAt >= 5 * 60 * 1000
}

function runtimeSelectionSummary(delegatesModel: boolean, delegatesReasoning: boolean): string {
  if (delegatesModel && delegatesReasoning) {
    return 'QA Scribe will not pass model or reasoning overrides. The CLI resolves its live configuration when generation starts.'
  }
  if (delegatesModel) {
    return 'QA Scribe will pass the reasoning override and let the CLI resolve its live model configuration.'
  }
  if (delegatesReasoning) {
    return 'QA Scribe will pass the model override and let the CLI resolve reasoning at run time.'
  }
  return 'QA Scribe will pass both model and reasoning overrides for the next run.'
}

export function reasoningEffortsFor(provider: ProviderStatus['providers'][number] | null): string[] {
  const efforts = provider?.models.flatMap((model) => model.reasoningEfforts) ?? []
  const unique = Array.from(new Set(efforts))
  return unique.length > 0 ? unique : ['low', 'medium', 'high', 'xhigh', 'max']
}
