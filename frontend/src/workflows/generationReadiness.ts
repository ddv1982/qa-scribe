import type { GenerationSetupProps } from './generationSetup'

/** Whether Generate must stay disabled: the same rule in the dialog and beside a new draft. */
export function generationSetupBlocked({ isBusy, modelSelectionPending = false, activeProviderAvailable, selectionWarning = null }:
  Pick<GenerationSetupProps, 'isBusy' | 'modelSelectionPending' | 'activeProviderAvailable' | 'selectionWarning'>): boolean {
  return isBusy || modelSelectionPending || !activeProviderAvailable || Boolean(selectionWarning)
}
