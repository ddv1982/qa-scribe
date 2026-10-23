import { createPortal } from 'react-dom'
import { customModelCatalogAdvisory } from '../settings/modelAdvisories'
import { CreationComposer } from './CreationComposer'
import { FindingFields } from './FindingsView'
import { useRef, useState } from 'react'
import { FileText, Sparkles } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { ModelCombobox } from '../components/ModelSelector'
import { RichTextEditor } from '../editor/RichTextEditor'
import { richEditorDocumentFromHtml } from '../editor/editorDocument'
import { stripHtml } from '../editor/editorHtml'
import { useModalDialog } from '../hooks/useModalDialog'
import { effectiveSelection, executionReasoningOverride, reasoningEffortsFor } from '../settings/defaults'
import { catalogSelectorEnabled } from '../settings/catalog'
import { GenerationPreflight } from '../workflows/generationPreflight'
import { creationIsAuthored, type CreationIntent } from '../app/creationIntent'
import type { AppController } from '../app/useAppController'
import type { AiProvider, AppSettings } from '../tauri'

export function CreationTools({ intent, c }: { intent: CreationIntent; c: AppController }) {
  const [mode, setMode] = useState<'prefill' | 'ai' | null>(intent.setup)
  const [confirming, setConfirming] = useState(false)
  const prefillConfirmation = useRef<symbol | null>(null)
  function cancelPrefill() {
    prefillConfirmation.current = null
    c.creation.cancelPrefill()
    setConfirming(false)
    setMode(null)
  }
  const generateTriggerRef = useRef<HTMLButtonElement>(null)
  function cancelAiSetup() {
    if (confirming) void c.creation.cancelGeneration()
    setMode(null)
    requestAnimationFrame(() => {
      const trigger = generateTriggerRef.current
      if (trigger && !trigger.disabled) trigger.focus()
      else trigger?.closest('.creation-composer')?.querySelector<HTMLInputElement>('input')?.focus()
    })
  }
  const [selection, setSelection] = useState({ provider: c.selectedProvider, model: c.selectedModel, reasoning: c.selectedReasoningEffort })
  const provider = c.providerStatus?.providers.find((candidate) => candidate.id === selection.provider) ?? null
  const settings = c.settingsDraft
  if (!settings) return <p role="status">Loading creation setup…</p>
  const localSettings: AppSettings = { ...settings, selectedAiProvider: selection.provider,
    selectedAiModelsByProvider: { ...settings.selectedAiModelsByProvider, [selection.provider]: selection.model === 'default' ? null : selection.model },
    selectedAiReasoningEffortsByProvider: { ...settings.selectedAiReasoningEffortsByProvider, [selection.provider]: selection.reasoning } }
  const execution = effectiveSelection(localSettings, provider)
  const customAdvisory = customModelCatalogAdvisory(provider?.models ?? [], selection.model, catalogSelectorEnabled(provider, c.providerStatus?.catalogRollout ?? null) && ['fresh', 'stale'].includes(provider?.catalogSnapshot.state ?? ''))
  const authored = creationIsAuthored(intent)
  const ready = Boolean(intent.source) && !c.noteReadOnly
  const imagesReady = Object.keys(intent.imageOperations).length === 0
  const locked = intent.phase.state !== 'editing'
  function openSetup(next: 'prefill' | 'ai') { c.setError(null); setMode(next) }
  const reviewedSource = intent.source ? <section className="creation-source-review" aria-label="Reviewed Note source">
    <h3>Source Note</h3><p>{intent.source.entry.title || c.sessionTitle} · Revision {intent.source.revision}</p>
    <RichTextEditor value={richEditorDocumentFromHtml(intent.source.entry.body)} readOnly ariaLabel="Reviewed Note content" />
  </section> : <p role="status">{intent.sourceNoteId ? 'Read the latest saved Note before continuing.' : 'This Session has no Note. You can still write and save this draft.'}</p>
  const source = <>{c.error ? <p className="inline-message blocking" role="alert">{c.error}</p> : null}{reviewedSource}</>
  return <section className="creation-tools" aria-label="Optional Note content and AI">
    <h3>Start with your Note, if useful</h3>
    <p>Ordinary writing works without AI. Source actions use the latest saved Note.</p>
    <div className="creation-source-actions">
      <ActionButton icon={FileText} disabled={locked || !ready || !imagesReady} onClick={() => openSetup('prefill')}>Prefill from note</ActionButton>
      <ActionButton ref={generateTriggerRef} icon={Sparkles} disabled={locked || !ready || !imagesReady} onClick={() => openSetup('ai')}>Generate with AI</ActionButton>
      {!ready && intent.sourceNoteId ? <ActionButton variant="quiet" disabled={locked} onClick={() => void c.creation.reviewSource()}>Read source Note</ActionButton> : null}
    </div>
    {c.noteReadOnly ? <p role="status">Recover the Session Note before using it as a source. Ordinary writing remains available.</p> : !ready ? source : null}
    {mode === 'prefill' ? <PrefillReview source={source} authored={authored} finding={intent.kind === 'finding'} busy={confirming}
      onCancel={cancelPrefill} onConfirm={() => {
        if (prefillConfirmation.current) return
        const confirmation = Symbol('prefill-confirmation')
        prefillConfirmation.current = confirmation
        setConfirming(true)
        void c.creation.prefill().then((applied) => { if (prefillConfirmation.current === confirmation && applied) setMode(null) }).finally(() => {
          if (prefillConfirmation.current !== confirmation) return
          prefillConfirmation.current = null
          setConfirming(false)
        })
      }} /> : null}
    {mode === 'ai' ? createPortal(<GenerationPreflight action={intent.kind} sourceReview={source}
      disclosure={authored ? 'Success immediately saves one AI result, closes this draft, and discards its unsaved text and local images. Cancellation or failure keeps this exact draft.' : 'Success immediately saves one AI result. No blank record is saved first.'}
      confirmLabel={authored ? 'Generate and replace draft' : 'Generate'} isBusy={confirming}
      activeProviderAvailable={Boolean(provider?.available)} activeProviderLabel={provider?.label ?? selection.provider}
      sessionTitle={c.sessionTitle} noteWordCount={intent.source ? stripHtml(intent.source.entry.body).split(/\s+/).filter(Boolean).length : 0}
      noteScreenshotCount={intent.source ? new DOMParser().parseFromString(intent.source.entry.body, 'text/html').querySelectorAll('img').length : 0}
      selectedModel={execution.model} selectedReasoning={execution.reasoning} modelOrigin={execution.modelOrigin} reasoningOrigin={execution.reasoningOrigin}
      delegatesModel={execution.delegatesModel} delegatesReasoning={execution.delegatesReasoning} executionSummary={execution.runtimeSummary}
      selectionWarning={!imagesReady ? 'Finish adding images or continue without failed images before generating.' : c.noteReadOnly ? 'Recover the Session Note before using it as a source.' : !ready ? (intent.sourceNoteId ? 'Read the source Note before generating.' : 'This Session has no Note to generate from.') : execution.warning ?? provider?.defaultSnapshot.warnings.find((warning) => warning.severity === 'blocking')?.message}
      selectionAdvisories={[...execution.advisories.map((warning) => warning.message), ...(customAdvisory ? [customAdvisory] : [])]}
      modelSelectionControl={<>
        <p>These choices apply only to this generation. Settings defaults stay as saved.</p>
        <label className="field-stack"><span>Provider</span><select disabled={confirming} value={selection.provider} onChange={(event) => setSelection({ provider: event.target.value as AiProvider, model: 'default', reasoning: null })}>{c.providerStatus?.providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <ModelCombobox disabled={confirming} models={provider?.models ?? []} value={selection.model} onChange={(model) => setSelection({ ...selection, model })}
          providerLabel={provider?.label} catalogChecked={catalogSelectorEnabled(provider, c.providerStatus?.catalogRollout ?? null)} />
        <label className="field-stack"><span>Reasoning</span><select disabled={confirming} value={selection.reasoning ?? ''} onChange={(event) => setSelection({ ...selection, reasoning: event.target.value || null })}>
          <option value="">CLI default</option><option value="model-recommended">Model recommendation</option>{reasoningEffortsFor(provider).map((effort) => <option key={effort} value={effort}>{effort}</option>)}
        </select></label>
      </>}
      onConfigureAi={() => { setMode(null); c.openSettingsSection('ai-execution-settings') }} onCancel={cancelAiSetup}
      onConfirm={(preferences) => {
        if (confirming || !ready) return
        setConfirming(true)
        void c.creation.generate({ selectedProvider: selection.provider, selectedModel: selection.model,
          selectedReasoningEffort: executionReasoningOverride(localSettings, provider) }, preferences)
          .then((started) => { if (started) setMode(null) }).finally(() => setConfirming(false))
      }} />, document.body) : null}
  </section>
}

function PrefillReview({ source, authored, finding, busy, onCancel, onConfirm }: {
  source: import('react').ReactNode; authored: boolean; finding: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void
}) {
  const dialogRef = useModalDialog(onCancel)
  return createPortal(<dialog ref={dialogRef} className="confirmation-dialog generation-preflight" aria-labelledby="prefill-title">
    <div className="preflight-header"><h2 id="prefill-title">Use this Note content?</h2>
      <p>Prefill uses plain text without formatting or screenshots.{finding ? ' Only the first 4,000 characters are included.' : ''}{authored ? ' This replaces the text in this unsaved draft.' : ''}</p></div>
    <div className="preflight-body">{source}</div>
    <div className="confirmation-actions"><ActionButton disabled={busy} onClick={onCancel}>Keep editing</ActionButton><ActionButton variant="primary" loading={busy} onClick={onConfirm}>{authored ? 'Prefill and replace draft' : 'Prefill draft'}</ActionButton></div>
  </dialog>, document.body)
}

export function CreationWorkspace({ c }: { c: AppController }) {
  const intent = c.creationIntent
  if (!intent) return null
  return <CreationComposer intent={intent} actions={c.creation} copyState={c.copyState} onCopy={c.copy}
    source={<CreationTools key={intent.id} intent={intent} c={c} />}
    fields={intent.kind === 'finding' ? <FindingFields finding={{ kind: intent.findingKind, metadataJson: intent.metadataJson }} onChange={(patch) => c.creation.update({ ...(patch.kind ? { findingKind: patch.kind } : {}), ...('metadataJson' in patch ? { metadataJson: patch.metadataJson } : {}) })} /> : undefined} />
}
