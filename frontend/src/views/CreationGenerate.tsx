import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { Field } from '../components/Field'
import { ModelCombobox } from '../components/ModelSelector'
import { stripHtml } from '../editor/editorHtml'
import { customModelCatalogAdvisory } from '../settings/modelAdvisories'
import { effectiveSelection, executionReasoningOverride, reasoningEffortsFor } from '../settings/defaults'
import { catalogSelectorEnabled } from '../settings/catalog'
import { defaultTestwareGenerationPreferences } from '../testware/generationPreferences'
import { GenerationSetup } from '../workflows/generationSetup'
import { generationSetupBlocked } from '../workflows/generationReadiness'
import { creationIsAuthored, type CreationIntent } from '../app/creationIntent'
import type { AppController } from '../app/useAppController'
import type { AiProvider, AppSettings, TestwareGenerationPreferences } from '../tauri'
import type { CreationGenerateMode } from './CreationComposer'

/** Whether AI can be offered beside a new draft: at least one provider is ready. */
export function creationAiActive(c: AppController): boolean {
  return Boolean(c.settingsDraft) && Boolean(c.providerStatus?.providers.some((provider) => provider.available))
}

/**
 * Generate mode of a new draft: the generation setup inline, with Generate as its one primary action.
 * Generation never fills the draft. Success saves one AI result and closes the draft. The choices here
 * apply only to this generation and last while the draft is open.
 */
export function useCreationGenerate(intent: CreationIntent, c: AppController) {
  const [selection, setSelection] = useState({ provider: c.selectedProvider, model: c.selectedModel, reasoning: c.selectedReasoningEffort })
  const [preferences, setPreferences] = useState<TestwareGenerationPreferences>(() => withDraftFormat(defaultTestwareGenerationPreferences, intent))
  const [confirming, setConfirming] = useState(false)
  const busy = confirming || intent.phase.state === 'generating' || intent.phase.state === 'cancelling'

  function mode(): CreationGenerateMode | null {
    const settings = c.settingsDraft
    if (!settings) return null
    const provider = c.providerStatus?.providers.find((candidate) => candidate.id === selection.provider) ?? null
    const localSettings: AppSettings = { ...settings, selectedAiProvider: selection.provider,
      selectedAiModelsByProvider: { ...settings.selectedAiModelsByProvider, [selection.provider]: selection.model === 'default' ? null : selection.model },
      selectedAiReasoningEffortsByProvider: { ...settings.selectedAiReasoningEffortsByProvider, [selection.provider]: selection.reasoning } }
    const execution = effectiveSelection(localSettings, provider)
    const catalogChecked = catalogSelectorEnabled(provider, c.providerStatus?.catalogRollout ?? null)
    const customAdvisory = customModelCatalogAdvisory(provider?.models ?? [], selection.model, catalogChecked && ['fresh', 'stale'].includes(provider?.catalogSnapshot.state ?? ''))
    const ready = Boolean(intent.source) && !c.noteReadOnly
    const imagesReady = Object.keys(intent.imageOperations).length === 0
    const source = intent.source?.entry.body ?? ''
    const setup = {
      action: intent.kind, isBusy: busy, sessionTitle: c.sessionTitle,
      activeProviderAvailable: Boolean(provider?.available), activeProviderLabel: provider?.label ?? selection.provider,
      noteWordCount: stripHtml(source).split(/\s+/).filter(Boolean).length,
      noteScreenshotCount: new DOMParser().parseFromString(source, 'text/html').querySelectorAll('img').length,
      selectedModel: execution.model, selectedReasoning: execution.reasoning, modelOrigin: execution.modelOrigin, reasoningOrigin: execution.reasoningOrigin,
      delegatesModel: execution.delegatesModel, delegatesReasoning: execution.delegatesReasoning, executionSummary: execution.runtimeSummary,
      selectionWarning: !imagesReady ? 'Finish adding images or continue without failed images before generating.'
        : c.noteReadOnly ? 'Recover the Session Note before using it as a source.'
          : !ready ? (intent.sourceNoteId ? 'Wait for the Note to show beside the draft before generating.' : 'This Session has no Note to generate from.')
            : execution.warning ?? provider?.defaultSnapshot.warnings.find((warning) => warning.severity === 'blocking')?.message,
      selectionAdvisories: [...execution.advisories.map((warning) => warning.message), ...(customAdvisory ? [customAdvisory] : [])],
    }
    const authored = creationIsAuthored(intent)
    function confirm() {
      if (busy || !ready) return
      setConfirming(true)
      void c.creation.generate({ selectedProvider: selection.provider, selectedModel: selection.model,
        selectedReasoningEffort: executionReasoningOverride(localSettings, provider) }, intent.kind === 'testware' ? preferences : undefined)
        .finally(() => setConfirming(false))
    }
    return {
      form: <>
        <p className="field-description">{authored
          ? 'Success immediately saves one AI result, closes this draft, and discards its unsaved text and local images. Cancellation or failure keeps this exact draft.'
          : 'Success immediately saves one AI result. No blank record is saved first.'}</p>
        <GenerationSetup {...setup} testwarePreferences={preferences} onTestwarePreferencesChange={setPreferences} modelSelectionControl={<>
          <p>These choices apply only to this generation. Settings defaults stay as saved.</p>
          <Field label="Provider"><select disabled={busy} value={selection.provider} onChange={(event) => setSelection({ provider: event.target.value as AiProvider, model: 'default', reasoning: null })}>{c.providerStatus?.providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
          <ModelCombobox disabled={busy} models={provider?.models ?? []} value={selection.model} onChange={(model) => setSelection({ ...selection, model })}
            providerLabel={provider?.label} catalogChecked={catalogChecked} />
          <Field label="Reasoning"><select disabled={busy} value={selection.reasoning ?? ''} onChange={(event) => setSelection({ ...selection, reasoning: event.target.value || null })}>
            <option value="">CLI default</option><option value="model-recommended">Model recommendation</option>{reasoningEffortsFor(provider).map((effort) => <option key={effort} value={effort}>{effort}</option>)}
          </select></Field>
          <ActionButton variant="quiet" disabled={busy} onClick={() => c.openSettingsSection('ai-execution-settings')}>Configure AI execution…</ActionButton>
        </>} />
      </>,
      confirm: <ActionButton variant="primary" icon={Sparkles} loading={busy} disabled={intent.phase.state !== 'editing' || generationSetupBlocked(setup)} onClick={confirm}>
        {authored ? 'Generate and replace draft' : 'Generate'}
      </ActionButton>,
    }
  }

  return {
    busy,
    mode,
    /** Generate starts from the output format chosen in Write. */
    followDraftFormat: () => setPreferences((current) => withDraftFormat(current, intent)),
  }
}

function withDraftFormat(preferences: TestwareGenerationPreferences, intent: CreationIntent): TestwareGenerationPreferences {
  return intent.format.kind === 'testware' ? { ...preferences, outputFormat: intent.format.outputFormat } : preferences
}
