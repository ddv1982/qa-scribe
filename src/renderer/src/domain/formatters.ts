import type { EntryType, ProviderStatus } from '../../../shared/contracts'
import { labelForEntryType } from './session'

export function providerSummary(providerStatus: ProviderStatus | null): string {
  if (!providerStatus) return 'Checking providers'
  const availableCount = providerStatus.providers.filter((provider) => provider.available).length
  if (availableCount > 0) return availableCount + ' provider' + (availableCount === 1 ? '' : 's') + ' available'
  const unavailableCount = providerStatus.providers.length
  if (unavailableCount > 0) return unavailableCount + ' provider' + (unavailableCount === 1 ? '' : 's') + ' unavailable'
  return 'No providers found'
}

export function formatReasoningEffort(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function firstLine(value: string): string {
  return value.split('\n')[0]?.slice(0, 96) ?? ''
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatEntryType(type: EntryType): string {
  return labelForEntryType(type)
}
