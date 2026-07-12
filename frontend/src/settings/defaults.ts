import {
  PROVIDER_MODEL_DEFAULTS,
  PROVIDER_REASONING_DEFAULTS,
  type AiProvider,
  type AppSettings,
  type ProviderStatus,
} from '../tauri'

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

export function effectiveSelection(
  settings: AppSettings,
  provider: ProviderStatus['providers'][number] | null,
): { model: string; reasoning: string | null; warning: string | null } {
  const providerId = (provider?.id ?? settings.selectedAiProvider) as AiProvider
  const modelOverride = modelOverrideForProvider(settings, providerId)
  const reasoningOverride = settings.selectedAiReasoningEffortsByProvider?.[providerId] ?? null
  const model = modelOverride ?? provider?.defaultSnapshot.model ?? 'Provider managed'
  const descriptor = provider?.models.find((candidate) => candidate.id === model)
  const modelRecommendation = descriptor?.defaultReasoningEffort
    ?? (model === provider?.defaultSnapshot.model ? provider.defaultSnapshot.recommendedReasoningEffort : null)
  const reasoning = reasoningOverride === 'model-recommended'
    ? modelRecommendation
    : reasoningOverride ?? provider?.defaultSnapshot.reasoningEffort ?? null
  const warning = reasoning && descriptor?.reasoningEfforts.length
    && !descriptor.reasoningEfforts.includes(reasoning)
    ? `Reasoning “${reasoning}” is not advertised for ${model}. Choose a compatible value before generation.`
    : null
  return { model, reasoning, warning }
}

export function reasoningEffortsFor(provider: ProviderStatus['providers'][number] | null): string[] {
  const efforts = provider?.models.flatMap((model) => model.reasoningEfforts) ?? []
  const unique = Array.from(new Set(efforts))
  return unique.length > 0 ? unique : ['low', 'medium', 'high', 'xhigh', 'max']
}
