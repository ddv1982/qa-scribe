import { Field } from '../components/Field'
import { useEffect, useRef, type ReactNode } from 'react'
import type { GenerateAiActionKind, ProviderDefaultOrigin, TestwareDepth, TestwareGenerationPreferences, TestwareOutputFormat } from '../tauri'
import { testwareDepthOptions, testwareOutputFormatOptions, testwareTechniquePresets } from '../testware/generationPreferences'
import { originSummary } from '../settings/defaults'

export type GenerationSetupProps = {
  action: GenerateAiActionKind
  activeProviderAvailable: boolean
  activeProviderLabel: string
  isBusy: boolean
  noteScreenshotCount: number
  sessionTitle: string
  noteWordCount: number
  selectedModel: string
  selectedReasoning?: string | null
  modelOrigin?: ProviderDefaultOrigin | null
  reasoningOrigin?: ProviderDefaultOrigin | null
  delegatesModel?: boolean
  delegatesReasoning?: boolean
  executionSummary?: string
  checkedAt?: string | null
  selectionWarning?: string | null
  selectionAdvisories?: string[]
  modelSelectionControl?: ReactNode
  modelSelectionPending?: boolean
  /** The choices for test cases; ignored for other actions. */
  testwarePreferences: TestwareGenerationPreferences
  onTestwarePreferencesChange: (preferences: TestwareGenerationPreferences) => void
}

/** The setup for one AI generation: its warnings, execution details and, for test cases, the output choices. */
export function GenerationSetup({
  action,
  activeProviderAvailable,
  activeProviderLabel,
  isBusy,
  noteScreenshotCount,
  sessionTitle,
  noteWordCount,
  selectedModel,
  selectedReasoning = null,
  modelOrigin = null,
  reasoningOrigin = null,
  delegatesModel = false,
  delegatesReasoning = false,
  executionSummary,
  checkedAt = null,
  selectionWarning = null,
  selectionAdvisories = [],
  modelSelectionControl,
  modelSelectionPending = false,
  testwarePreferences,
  onTestwarePreferencesChange,
}: GenerationSetupProps) {
  const update = (patch: Partial<TestwareGenerationPreferences>) => onTestwarePreferencesChange({ ...testwarePreferences, ...patch })
  const executionDetailsRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (executionDetailsRef.current && (selectionWarning || !activeProviderAvailable || modelSelectionPending)) {
      executionDetailsRef.current.open = true
    }
  }, [selectionWarning, activeProviderAvailable, modelSelectionPending])
  const screenshots = `${noteScreenshotCount} screenshot${noteScreenshotCount === 1 ? '' : 's'}`

  return <>
    {selectionWarning ? <p className="inline-message blocking" role="alert">{selectionWarning}</p> : null}
    {selectionAdvisories.map((advisory) => <p className="inline-message advisory" role="status" key={advisory}>{advisory}</p>)}
    {!activeProviderAvailable ? <p className="inline-message blocking" role="alert">{activeProviderLabel} is unavailable. Configure AI execution to review setup and choose a ready provider.</p> : null}
    {modelSelectionPending ? <p className="inline-message advisory" role="status">Saving model preference… Wait before generating.</p> : null}
    <details className="preflight-execution-details" ref={executionDetailsRef}>
      <summary tabIndex={0}>
        Execution details
        <span>{noteWordCount} words · {screenshots} · {activeProviderLabel} · {delegatesModel ? 'CLI default' : selectedModel}</span>
      </summary>
      <div className="preflight-execution-content">
        <dl className="preflight-list">
          <div>
            <dt>Session</dt>
            <dd>{sessionTitle.trim() || 'Untitled session'}</dd>
          </div>
          <div>
            <dt>Material</dt>
            <dd>{noteWordCount} words, {screenshots}</dd>
          </div>
          <div>
            <dt>Provider</dt>
            <dd>{activeProviderLabel}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>
              {selectedModel} {delegatesModel ? <small>CLI default</small> : <small>QA Scribe override</small>}
              {modelOrigin ? <span>{originSummary(modelOrigin)}</span> : null}
            </dd>
          </div>
          <div>
            <dt>Reasoning</dt>
            <dd>
              {selectedReasoning ?? 'CLI resolves at run time'} {delegatesReasoning ? <small>CLI default</small> : <small>QA Scribe override</small>}
              {reasoningOrigin ? <span>{originSummary(reasoningOrigin)}</span> : null}
            </dd>
          </div>
        </dl>
        {executionSummary ? <p className="preflight-execution-summary">{executionSummary}{checkedAt ? ` Last checked ${formatCheckedAt(checkedAt)}.` : ''}</p> : null}
        {modelSelectionControl}
      </div>
    </details>
    {action === 'testware' ? (
      <div className="preflight-testware-options">
        <div className="preflight-control-grid">
          <Field label="Output">
            <select disabled={isBusy} value={testwarePreferences.outputFormat}
              onChange={(event) => update({ outputFormat: event.target.value as TestwareOutputFormat })}>
              {testwareOutputFormatOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </Field>
          <Field label="Depth">
            <select disabled={isBusy} value={testwarePreferences.depth}
              onChange={(event) => update({ depth: event.target.value as TestwareDepth })}>
              {testwareDepthOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </Field>
        </div>

        <fieldset className="preflight-fieldset">
          <legend>Test design</legend>
          <div className="preflight-technique-grid">
            {testwareTechniquePresets.map((preset) => (
              <button
                disabled={isBusy}
                className={testwarePreferences.technique === preset.id ? 'preflight-choice active' : 'preflight-choice'}
                type="button"
                key={preset.id}
                aria-pressed={testwarePreferences.technique === preset.id}
                title={preset.description}
                onClick={() => update({ technique: preset.id })}
              >
                <span>{preset.shortLabel}</span>
                <strong>{preset.bestFor}</strong>
              </button>
            ))}
          </div>
          <p className="field-description preflight-technique-description">
            {testwareTechniquePresets.find((preset) => preset.id === testwarePreferences.technique)?.description}
          </p>
        </fieldset>

        <fieldset className="preflight-fieldset compact">
          <legend>Include</legend>
          <div className="preflight-toggle-grid">
            {includeOptions.map(([key, label]) => <label key={key}>
              <input type="checkbox" disabled={isBusy} checked={testwarePreferences[key]} onChange={(event) => update({ [key]: event.target.checked })} />
              {label}
            </label>)}
          </div>
        </fieldset>

        <Field label="Additional guidance">
          <textarea className="preflight-guidance" disabled={isBusy}
            value={testwarePreferences.customInstructions ?? ''}
            placeholder="Optional constraints, priorities, or areas to emphasize."
            onChange={(event) => update({ customInstructions: event.target.value || null })}
          />
        </Field>
      </div>
    ) : null}
  </>
}

const includeOptions = [
  ['includeNegativeCases', 'Negative cases'],
  ['includeBoundaryCases', 'Boundary cases'],
  ['includeTestData', 'Test data'],
  ['preserveEvidence', 'Preserve evidence'],
] as const

function formatCheckedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}
