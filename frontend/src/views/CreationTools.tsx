import { createPortal } from 'react-dom'
import { customModelCatalogAdvisory } from '../settings/modelAdvisories'
import { CreationComposer } from './CreationComposer'
import { FindingFields } from './FindingsView'
import { ShowNoteButton } from './CreationNotePanel'
import { useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { Field } from '../components/Field'
import { ModelCombobox } from '../components/ModelSelector'
import { RichTextEditor } from '../editor/RichTextEditor'
import { richEditorDocumentFromHtml } from '../editor/editorDocument'
import { stripHtml } from '../editor/editorHtml'
import { effectiveSelection, executionReasoningOverride, reasoningEffortsFor } from '../settings/defaults'
import { catalogSelectorEnabled } from '../settings/catalog'
import { GenerationPreflight } from '../workflows/generationPreflight'
import { creationIsAuthored, type CreationIntent } from '../app/creationIntent'
import type { AppController } from '../app/useAppController'
import type { AiProvider, AppSettings } from '../tauri'

/** "Generate with AI" in the draft's action row, and its setup dialog. The Note it uses shows beside the draft. */
export function GenerateWithAi({ intent, c }: { intent: CreationIntent; c: AppController }) {
  const [open, setOpen] = useState(intent.setup === 'ai')
  const [confirming, setConfirming] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  function cancel() {
    if (confirming) void c.creation.cancelGeneration()
    setOpen(false)
    requestAnimationFrame(() => {
      const trigger = triggerRef.current
      if (trigger && !trigger.disabled) trigger.focus()
      else trigger?.closest('.creation-composer')?.querySelector<HTMLInputElement>('input')?.focus()
    })
  }
  const [selection, setSelection] = useState({ provider: c.selectedProvider, model: c.selectedModel, reasoning: c.selectedReasoningEffort })
  const provider = c.providerStatus?.providers.find((candidate) => candidate.id === selection.provider) ?? null
  const settings = c.settingsDraft
  if (!settings) return <ActionButton icon={Sparkles} disabled>Generate with AI</ActionButton>
  const localSettings: AppSettings = { ...settings, selectedAiProvider: selection.provider,
    selectedAiModelsByProvider: { ...settings.selectedAiModelsByProvider, [selection.provider]: selection.model === 'default' ? null : selection.model },
    selectedAiReasoningEffortsByProvider: { ...settings.selectedAiReasoningEffortsByProvider, [selection.provider]: selection.reasoning } }
  const execution = effectiveSelection(localSettings, provider)
  const customAdvisory = customModelCatalogAdvisory(provider?.models ?? [], selection.model, catalogSelectorEnabled(provider, c.providerStatus?.catalogRollout ?? null) && ['fresh', 'stale'].includes(provider?.catalogSnapshot.state ?? ''))
  const authored = creationIsAuthored(intent)
  const ready = Boolean(intent.source) && !c.noteReadOnly
  const imagesReady = Object.keys(intent.imageOperations).length === 0
  const locked = intent.phase.state !== 'editing'
  const sourceReview = <>{c.error ? <p className="inline-message blocking" role="alert">{c.error}</p> : null}
    {intent.source ? <section className="creation-source-review" aria-label="Reviewed Note source">
      <h3>Source Note</h3><p>{intent.source.entry.title || c.sessionTitle} · Revision {intent.source.revision}</p>
      <RichTextEditor value={richEditorDocumentFromHtml(intent.source.entry.body)} readOnly ariaLabel="Reviewed Note content" />
    </section> : null}</>
  return <>
    <ActionButton ref={triggerRef} icon={Sparkles} disabled={locked || !ready || !imagesReady} onClick={() => { c.setError(null); setOpen(true) }}>Generate with AI</ActionButton>
    {open ? createPortal(<GenerationPreflight action={intent.kind} initialOutputFormat={intent.format.kind === 'testware' ? intent.format.outputFormat : undefined} sourceReview={sourceReview}
      disclosure={authored ? 'Success immediately saves one AI result, closes this draft, and discards its unsaved text and local images. Cancellation or failure keeps this exact draft.' : 'Success immediately saves one AI result. No blank record is saved first.'}
      confirmLabel={authored ? 'Generate and replace draft' : 'Generate'} isBusy={confirming}
      activeProviderAvailable={Boolean(provider?.available)} activeProviderLabel={provider?.label ?? selection.provider}
      sessionTitle={c.sessionTitle} noteWordCount={intent.source ? stripHtml(intent.source.entry.body).split(/\s+/).filter(Boolean).length : 0}
      noteScreenshotCount={intent.source ? new DOMParser().parseFromString(intent.source.entry.body, 'text/html').querySelectorAll('img').length : 0}
      selectedModel={execution.model} selectedReasoning={execution.reasoning} modelOrigin={execution.modelOrigin} reasoningOrigin={execution.reasoningOrigin}
      delegatesModel={execution.delegatesModel} delegatesReasoning={execution.delegatesReasoning} executionSummary={execution.runtimeSummary}
      selectionWarning={!imagesReady ? 'Finish adding images or continue without failed images before generating.' : c.noteReadOnly ? 'Recover the Session Note before using it as a source.' : !ready ? (intent.sourceNoteId ? 'Wait for the Note to show beside the draft before generating.' : 'This Session has no Note to generate from.') : execution.warning ?? provider?.defaultSnapshot.warnings.find((warning) => warning.severity === 'blocking')?.message}
      selectionAdvisories={[...execution.advisories.map((warning) => warning.message), ...(customAdvisory ? [customAdvisory] : [])]}
      modelSelectionControl={<>
        <p>These choices apply only to this generation. Settings defaults stay as saved.</p>
        <Field label="Provider"><select disabled={confirming} value={selection.provider} onChange={(event) => setSelection({ provider: event.target.value as AiProvider, model: 'default', reasoning: null })}>{c.providerStatus?.providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
        <ModelCombobox disabled={confirming} models={provider?.models ?? []} value={selection.model} onChange={(model) => setSelection({ ...selection, model })}
          providerLabel={provider?.label} catalogChecked={catalogSelectorEnabled(provider, c.providerStatus?.catalogRollout ?? null)} />
        <Field label="Reasoning"><select disabled={confirming} value={selection.reasoning ?? ''} onChange={(event) => setSelection({ ...selection, reasoning: event.target.value || null })}>
          <option value="">CLI default</option><option value="model-recommended">Model recommendation</option>{reasoningEffortsFor(provider).map((effort) => <option key={effort} value={effort}>{effort}</option>)}
        </select></Field>
      </>}
      onConfigureAi={() => { setOpen(false); c.openSettingsSection('ai-execution-settings') }} onCancel={cancel}
      onConfirm={(preferences) => {
        if (confirming || !ready) return
        setConfirming(true)
        void c.creation.generate({ selectedProvider: selection.provider, selectedModel: selection.model,
          selectedReasoningEffort: executionReasoningOverride(localSettings, provider) }, preferences)
          .then((started) => { if (started) setOpen(false) }).finally(() => setConfirming(false))
      }} />, document.body) : null}
  </>
}

export function CreationWorkspace({ c, onShowNote }: { c: AppController; onShowNote?: () => void }) {
  const intent = c.creationIntent
  if (!intent) return null
  return <CreationComposer intent={intent} actions={c.creation} copyState={c.copyState} onCopy={c.copy}
    headerAction={onShowNote ? <ShowNoteButton onShow={onShowNote} /> : undefined}
    generate={<GenerateWithAi key={intent.id} intent={intent} c={c} />}
    fields={intent.kind === 'finding' ? <FindingFields finding={{ kind: intent.findingKind, metadataJson: intent.metadataJson }} onChange={(patch) => c.creation.update({ ...(patch.kind ? { findingKind: patch.kind } : {}), ...('metadataJson' in patch ? { metadataJson: patch.metadataJson } : {}) })} /> : undefined} />
}
