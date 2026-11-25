import { useState } from 'react'
import type { AiSelection } from '../app/types'
import { Field } from '../components/Field'
import { ModelCombobox } from '../components/ModelSelector'
import { ProviderSelect } from '../components/ProviderSelect'
import { catalogSelectorEnabled } from '../settings/catalog'
import { effectiveSelection, executionReasoningOverride, modelForProvider, originSummary, reasoningEffortsFor, reasoningOverrideForProvider } from '../settings/defaults'
import { customModelCatalogAdvisory } from '../settings/modelAdvisories'
import type { AiProvider, AppSettings, ProviderStatus } from '../tauri'

export function useGenerationSelection(settings: AppSettings | null, status: ProviderStatus | null, disabled: boolean) {
  const [providerChoice, setProviderChoice] = useState<AiProvider | null>(null)
  const providerId = providerChoice ?? settings?.selectedAiProvider ?? 'codex_cli'
  const [modelChoice, setModelChoice] = useState<string | null>(null)
  const [reasoningChoice, setReasoningChoice] = useState<string | undefined>()
  if (!settings) return null

  const providers = status?.providers ?? []
  const provider = providers.find(candidate => candidate.id === providerId) ?? null
  const model = modelChoice ?? modelForProvider(settings, providerId)
  const reasoning = reasoningChoice ?? reasoningOverrideForProvider(settings, providerId) ?? ''
  const reasoningOptions = reasoningEffortsFor(provider)
  if (reasoning && reasoning !== 'model-recommended' && !reasoningOptions.includes(reasoning)) reasoningOptions.push(reasoning)
  const localSettings = { ...settings, selectedAiProvider: providerId,
    selectedAiModelsByProvider: { ...settings.selectedAiModelsByProvider, [providerId]: model === 'default' ? null : model },
    selectedAiReasoningEffortsByProvider: { ...settings.selectedAiReasoningEffortsByProvider, [providerId]: reasoning || null },
  }
  const execution = effectiveSelection(localSettings, provider)
  const catalogChecked = catalogSelectorEnabled(provider, status?.catalogRollout ?? null)
    && ['fresh', 'stale'].includes(provider?.catalogSnapshot.state ?? '')
  const customAdvisory = customModelCatalogAdvisory(provider?.models ?? [], model, catalogChecked)
  const selection: AiSelection = {
    selectedProvider: providerId, selectedModel: model, selectedReasoningEffort: executionReasoningOverride(localSettings, provider),
  }
  return {
    selection,
    details: {
      activeProviderAvailable: Boolean(provider?.available), activeProviderLabel: provider?.label ?? providerId,
      selectedModel: execution.model, selectedReasoning: execution.reasoning, modelOrigin: execution.modelOrigin, reasoningOrigin: execution.reasoningOrigin,
      delegatesModel: execution.delegatesModel, delegatesReasoning: execution.delegatesReasoning, executionSummary: execution.runtimeSummary,
      checkedAt: execution.checkedAt,
      selectionWarning: execution.warning ?? provider?.defaultSnapshot.warnings.find(warning => warning.severity === 'blocking')?.message,
      selectionAdvisories: [...execution.advisories.map(warning => warning.message), ...(customAdvisory ? [customAdvisory] : [])],
    },
    controls: <>
      <ProviderSelect providers={providers} value={providerId} disabled={disabled} onChange={next => {
        if (!next) return
        setProviderChoice(next)
        setModelChoice(null)
        setReasoningChoice(undefined)
      }} />
      <ModelCombobox key={providerId} disabled={disabled || !provider?.available} models={provider?.models ?? []} value={model} onChange={setModelChoice}
        providerLabel={provider?.label} showCustomAdvisory={false}
        resolvedDefaultModel={provider?.defaultSnapshot.model.value}
        resolvedDefaultOrigin={originSummary(provider?.defaultSnapshot.model.origin ?? null)} />
      <Field label="Reasoning"><select disabled={disabled || !provider?.available} value={reasoning} onChange={event => setReasoningChoice(event.target.value)}>
        <option value="">CLI default</option><option value="model-recommended">Model recommendation</option>
        {reasoningOptions.map(effort => <option key={effort} value={effort}>{effort}</option>)}
      </select></Field>
    </>,
  }
}
