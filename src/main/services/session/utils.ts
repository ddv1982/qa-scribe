import type { AiProviderId, Entry, ReasoningEffort, SessionRequirementKey } from '../../../shared/contracts'

export function isoNow(): string {
  return new Date().toISOString()
}

export function cleanNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

export function defaultReasoningEffort(provider: AiProviderId): ReasoningEffort | null {
  if (provider === 'codex_cli') return 'high'
  if (provider === 'claude_code') return 'medium'
  if (provider === 'copilot_cli') return null
  return null
}

export function formatRequirementLabels(keys: SessionRequirementKey[]): string {
  const labels: Record<SessionRequirementKey, string> = {
    title: 'Title',
    testTarget: 'Test Target',
    testObjective: 'Test Objective'
  }
  return keys.map((key) => labels[key]).join(', ')
}

export function labelEntryType(type: Entry['type']): string {
  return type
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}
