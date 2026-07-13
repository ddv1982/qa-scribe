import type { Dispatch, SetStateAction } from 'react'
import type { GenerateAiActionKind, ProviderStatus } from '../tauri'
import { defaultSnapshotNeedsRefresh } from '../settings/defaults'
import type { BusyAction } from '../ui/types'

export function createOpenGenerationPreflight(
  activeProvider: ProviderStatus['providers'][number] | null,
  refreshProviderStatus: () => Promise<void>,
  setBusyAction: Dispatch<SetStateAction<BusyAction | null>>,
  setPendingGenerationAction: Dispatch<SetStateAction<GenerateAiActionKind | null>>,
) {
  return async (action: GenerateAiActionKind) => {
    if (defaultSnapshotNeedsRefresh(activeProvider)) {
      try {
        setBusyAction('refresh-providers')
        await refreshProviderStatus()
      } catch {
        // A previous successful snapshot remains visible as stale. Default
        // execution can still proceed because the CLI resolves it live.
      } finally {
        setBusyAction(null)
      }
    }
    setPendingGenerationAction(action)
  }
}
