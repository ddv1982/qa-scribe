import type { AiModelDescriptor, AiProviderId, AiProviderStatus, ProviderCapabilities, ReasoningEffort } from '../../../shared/contracts'

export type ProviderMetadata = Omit<AiProviderStatus, 'provider' | 'available' | 'reason'>

export const defaultProviderModels: Record<AiProviderId, string> = {
  claude_code: process.env.CLAUDE_MODEL || 'sonnet',
  codex_cli: process.env.CODEX_MODEL || 'gpt-5.4',
  copilot_cli: process.env.COPILOT_MODEL || 'auto'
}

export const providerPresetModels: Record<AiProviderId, string[]> = {
  claude_code: ['sonnet', 'haiku', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  codex_cli: ['gpt-5.4', 'gpt-5.4-mini'],
  copilot_cli: ['auto', 'gpt-5.3-codex', 'gpt-5.2', 'claude-sonnet-4.6', 'claude-haiku-4.5']
}

const providerReasoningEfforts: Record<AiProviderId, ReasoningEffort[]> = {
  claude_code: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex_cli: ['low', 'medium', 'high', 'xhigh'],
  copilot_cli: []
}

const defaultReasoningEfforts: Record<AiProviderId, ReasoningEffort | null> = {
  claude_code: 'medium',
  codex_cli: 'high',
  copilot_cli: null
}

export const reasoningEffortValues: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
export const copilotReasoningEfforts: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export function available(provider: AiProviderId, metadata: ProviderMetadata = providerMetadata(provider)): AiProviderStatus {
  return {
    provider,
    label: metadata.label,
    available: true,
    reason: null,
    models: metadata.models,
    modelDescriptors: metadata.modelDescriptors,
    defaultModel: metadata.defaultModel,
    reasoningEfforts: metadata.reasoningEfforts,
    defaultReasoningEffort: metadata.defaultReasoningEffort,
    capabilities: metadata.capabilities,
    localOnly: metadata.localOnly,
    requiresNetwork: metadata.requiresNetwork
  }
}

export function unavailable(provider: AiProviderId, reason: string): AiProviderStatus {
  const metadata = providerMetadata(provider)
  return {
    provider,
    label: metadata.label,
    available: false,
    reason,
    models: metadata.models,
    modelDescriptors: metadata.modelDescriptors,
    defaultModel: metadata.defaultModel,
    reasoningEfforts: metadata.reasoningEfforts,
    defaultReasoningEffort: metadata.defaultReasoningEffort,
    capabilities: metadata.capabilities,
    localOnly: metadata.localOnly,
    requiresNetwork: metadata.requiresNetwork
  }
}

export function providerMetadata(provider: AiProviderId): ProviderMetadata {
  const defaultModel = defaultProviderModels[provider]
  const presetModels = providerPresetModels[provider]
  const models = [defaultModel, ...presetModels.filter((model) => model !== defaultModel)]
  const capabilities = providerCapabilities(provider)
  return {
    label: providerLabel(provider),
    models,
    modelDescriptors: modelDescriptorsFromModels(models, capabilities),
    defaultModel,
    reasoningEfforts: providerReasoningEfforts[provider],
    defaultReasoningEffort: defaultReasoningEfforts[provider],
    capabilities,
    localOnly: true,
    requiresNetwork: provider === 'claude_code' || provider === 'codex_cli' || provider === 'copilot_cli'
  }
}

export function modelDescriptorsFromModels(models: string[], capabilities: ProviderCapabilities): AiModelDescriptor[] {
  return models.map((model) => ({ id: model, label: model, capabilities }))
}

function providerCapabilities(provider: AiProviderId): ProviderCapabilities {
  const reasoningEfforts = providerReasoningEfforts[provider]
  return capabilitiesFromReasoningEfforts(reasoningEfforts, defaultReasoningEfforts[provider])
}

export function capabilitiesFromReasoningEfforts(
  reasoningEfforts: ReasoningEffort[],
  defaultValue: ReasoningEffort | null
): ProviderCapabilities {
  if (reasoningEfforts.length === 0) return { optionDescriptors: [] }

  return {
    optionDescriptors: [
      {
        id: 'reasoningEffort',
        type: 'select',
        label: 'Reasoning',
        options: reasoningEfforts.map((effort) => ({ value: effort, label: formatReasoningEffort(effort) })),
        defaultValue: defaultValue && reasoningEfforts.includes(defaultValue) ? defaultValue : null
      }
    ]
  }
}

export function reasoningEffortsFromCapabilities(capabilities: ProviderCapabilities): ReasoningEffort[] {
  return capabilities.optionDescriptors.find((descriptor) => descriptor.id === 'reasoningEffort')?.options.map((option) => option.value) ?? []
}

export function reasoningEffortFromCapabilities(capabilities: ProviderCapabilities): ReasoningEffort | null {
  return capabilities.optionDescriptors.find((descriptor) => descriptor.id === 'reasoningEffort')?.defaultValue ?? null
}

export function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && (reasoningEffortValues as string[]).includes(value)
}

export function copilotCapabilitiesForModel(model: string): ProviderCapabilities {
  return model === 'auto' ? { optionDescriptors: [] } : capabilitiesFromReasoningEfforts(copilotReasoningEfforts, null)
}

function formatReasoningEffort(effort: ReasoningEffort): string {
  if (effort === 'xhigh') return 'Extra high'
  return effort[0].toUpperCase() + effort.slice(1)
}

function providerLabel(provider: AiProviderId): string {
  if (provider === 'claude_code') return 'Claude Code'
  if (provider === 'codex_cli') return 'Codex CLI'
  return 'GitHub Copilot CLI'
}
