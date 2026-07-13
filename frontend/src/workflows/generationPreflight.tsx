import { useState } from 'react'
import type { GenerateAiActionKind, ProviderDefaultOrigin, TestwareDepth, TestwareGenerationPreferences, TestwareOutputFormat } from '../tauri'
import { useModalDialog } from '../hooks/useModalDialog'
import {
  defaultTestwareGenerationPreferences,
  testwareDepthOptions,
  testwareOutputFormatOptions,
  testwareTechniquePresets,
} from '../testware/generationPreferences'
import { originSummary } from '../settings/defaults'

export function GenerationPreflight({
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
  onConfigureAi,
  onCancel,
  onConfirm,
}: {
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
  onConfigureAi?: () => void
  onCancel: () => void
  onConfirm: (testwarePreferences?: TestwareGenerationPreferences) => void
}) {
  const copy = generationPreflightCopy(action)
  const [testwarePreferences, setTestwarePreferences] = useState<TestwareGenerationPreferences>(defaultTestwareGenerationPreferences)
  const isTestware = action === 'testware'
  const updateTestwarePreferences = (patch: Partial<TestwareGenerationPreferences>) =>
    setTestwarePreferences((previous) => ({ ...previous, ...patch }))
  const dialogRef = useModalDialog(onCancel)

  return (
    <dialog
      ref={dialogRef}
      className={isTestware ? 'confirmation-dialog generation-preflight testware-preflight' : 'confirmation-dialog generation-preflight'}
      aria-labelledby="generation-preflight-title"
    >
      <div>
        <p className="eyebrow">Generation preflight</p>
        <h2 id="generation-preflight-title">{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      <dl className="preflight-list">
        <div>
          <dt>Session</dt>
          <dd>{sessionTitle.trim() || 'Untitled session'}</dd>
        </div>
        <div>
          <dt>Material</dt>
          <dd>
            {noteWordCount} words, {noteScreenshotCount} screenshot{noteScreenshotCount === 1 ? '' : 's'}
          </dd>
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
      {selectionWarning ? <p className="inline-message blocking" role="alert">{selectionWarning}</p> : null}
      {selectionAdvisories.map((advisory) => <p className="inline-message advisory" role="status" key={advisory}>{advisory}</p>)}
      {isTestware ? (
        <div className="preflight-testware-options">
          <fieldset className="preflight-fieldset">
            <legend>Test design</legend>
            <div className="preflight-technique-grid">
              {testwareTechniquePresets.map((preset) => (
                <button
                  className={testwarePreferences.technique === preset.id ? 'preflight-choice active' : 'preflight-choice'}
                  type="button"
                  key={preset.id}
                  aria-pressed={testwarePreferences.technique === preset.id}
                  onClick={() => updateTestwarePreferences({ technique: preset.id })}
                >
                  <span>{preset.shortLabel}</span>
                  <strong>{preset.bestFor}</strong>
                  <small>{preset.description}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="preflight-control-grid">
            <label className="preflight-select-field">
              <span>Output</span>
              <select
                value={testwarePreferences.outputFormat}
                onChange={(event) => updateTestwarePreferences({ outputFormat: event.target.value as TestwareOutputFormat })}
              >
                {testwareOutputFormatOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="preflight-select-field">
              <span>Depth</span>
              <select
                value={testwarePreferences.depth}
                onChange={(event) => updateTestwarePreferences({ depth: event.target.value as TestwareDepth })}
              >
                {testwareDepthOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="preflight-fieldset compact">
            <legend>Include</legend>
            <div className="preflight-toggle-grid">
              <label>
                <input
                  type="checkbox"
                  checked={testwarePreferences.includeNegativeCases}
                  onChange={(event) => updateTestwarePreferences({ includeNegativeCases: event.target.checked })}
                />
                Negative cases
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={testwarePreferences.includeBoundaryCases}
                  onChange={(event) => updateTestwarePreferences({ includeBoundaryCases: event.target.checked })}
                />
                Boundary cases
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={testwarePreferences.includeTestData}
                  onChange={(event) => updateTestwarePreferences({ includeTestData: event.target.checked })}
                />
                Test data
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={testwarePreferences.preserveEvidence}
                  onChange={(event) => updateTestwarePreferences({ preserveEvidence: event.target.checked })}
                />
                Preserve evidence
              </label>
            </div>
          </fieldset>

          <label className="preflight-textarea-field">
            <span>Additional guidance</span>
            <textarea
              value={testwarePreferences.customInstructions ?? ''}
              placeholder="Optional constraints, priorities, or areas to emphasize."
              onChange={(event) => updateTestwarePreferences({ customInstructions: event.target.value || null })}
            />
          </label>
        </div>
      ) : null}
      <div className="confirmation-actions">
        {onConfigureAi ? <button className="text-button" type="button" disabled={isBusy} onClick={onConfigureAi}>Configure AI execution…</button> : null}
        <button className="secondary-button" type="button" disabled={isBusy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={isBusy || !activeProviderAvailable || Boolean(selectionWarning)}
          onClick={() => onConfirm(isTestware ? testwarePreferences : undefined)}
        >
          {copy.confirmLabel}
        </button>
      </div>
    </dialog>
  )
}

function formatCheckedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function generationPreflightCopy(action: GenerateAiActionKind) {
  if (action === 'testware') {
    return {
      title: 'Generate test cases?',
      body: 'QA Scribe will use the current note and attached evidence to draft testware.',
      confirmLabel: 'Generate test cases',
    }
  }
  if (action === 'finding') {
    return {
      title: 'Create finding?',
      body: 'QA Scribe will use the current note and attached evidence to draft a Jira-ready finding.',
      confirmLabel: 'Create finding',
    }
  }
  return {
    title: 'Summarize note?',
    body: 'QA Scribe will rewrite the current note into a tighter summary.',
    confirmLabel: 'Summarize note',
  }
}
