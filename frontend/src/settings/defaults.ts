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
export function providerModelDefaults(): Record<AiProvider, string> {
  return PROVIDER_MODEL_DEFAULTS
}

export function providerReasoningDefaults(): Record<AiProvider, string | null> {
  return PROVIDER_REASONING_DEFAULTS
}

export function modelForProvider(settings: AppSettings, provider: AiProvider): string {
  return settings.selectedAiModelsByProvider?.[provider] || (provider === settings.selectedAiProvider ? settings.selectedAiModel : null) || providerModelDefaults()[provider]
}

export function reasoningEffortsFor(provider: ProviderStatus['providers'][number] | null): string[] {
  const efforts = provider?.models.flatMap((model) => model.reasoningEfforts) ?? []
  const unique = Array.from(new Set(efforts))
  return unique.length > 0 ? unique : ['low', 'medium', 'high', 'xhigh']
}
