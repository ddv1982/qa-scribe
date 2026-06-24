import type { AiProvider, AppSettings, ProviderStatus } from '../tauri'

export function providerModelDefaults(): Record<AiProvider, string> {
  return {
    claude_code: 'default',
    codex_cli: 'default',
    copilot_cli: 'auto',
  }
}

export function providerReasoningDefaults(): Record<AiProvider, string | null> {
  return {
    claude_code: 'medium',
    codex_cli: 'low',
    copilot_cli: null,
  }
}

export function modelForProvider(settings: AppSettings, provider: AiProvider): string {
  return settings.selectedAiModelsByProvider?.[provider] || (provider === settings.selectedAiProvider ? settings.selectedAiModel : null) || providerModelDefaults()[provider]
}

export function reasoningEffortsFor(provider: ProviderStatus['providers'][number] | null): string[] {
  const efforts = provider?.models.flatMap((model) => model.reasoningEfforts) ?? []
  const unique = Array.from(new Set(efforts))
  return unique.length > 0 ? unique : ['low', 'medium', 'high', 'xhigh']
}
