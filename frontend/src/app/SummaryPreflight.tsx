import type { GenerateAiActionKind } from '../tauri'
import { GenerationPreflight } from '../workflows/generationPreflight'
import { useGenerationSelection } from '../workflows/generationSelection'
import type { AppController } from './useAppController'

export function SummaryPreflight({ c, action, onConfigureAi }: {
  c: AppController
  action: GenerateAiActionKind
  onConfigureAi: () => void
}) {
  const disabled = c.isBusy || c.settingsWritePending
  const execution = useGenerationSelection(c.savedSettings, c.providerStatus, disabled)
  if (!execution) return null

  return <GenerationPreflight
    {...execution.details}
    action={action}
    isBusy={c.isBusy}
    sessionTitle={c.sessionTitle}
    noteWordCount={c.noteWordCount}
    noteScreenshotCount={c.noteScreenshotCount}
    modelSelectionPending={c.settingsWritePending}
    executionControls={<div className="preflight-generation-choices">
      <p className="field-description">These choices apply to this generation.</p>
      {execution.controls}
    </div>}
    onConfigureAi={onConfigureAi}
    onCancel={() => c.setPendingGenerationAction(null)}
    onConfirm={preferences => {
      if (disabled) return
      c.setPendingGenerationAction(null)
      void c.handleAiAction(action, preferences, execution.selection)
    }}
  />
}
