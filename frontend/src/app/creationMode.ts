import type { CreationIntent, CreationMode } from './creationIntent'
import type { AppSettings, ProviderStatus } from '../tauri'

/** Whether a new draft offers Generate: at least one AI provider is ready. */
export function creationAiActive({ providerStatus, settingsDraft }: { providerStatus: ProviderStatus | null; settingsDraft: AppSettings | null }): boolean {
  return Boolean(settingsDraft) && Boolean(providerStatus?.providers.some((provider) => provider.available))
}

/** The mode a draft shows: Write whenever Generate is not offered. */
export function shownCreationMode(intent: CreationIntent, aiActive: boolean): CreationMode {
  return aiActive ? intent.mode : 'write'
}
