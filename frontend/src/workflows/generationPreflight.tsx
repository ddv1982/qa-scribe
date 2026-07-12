import { useState } from 'react'
import type { GenerateAiActionKind, TestwareDepth, TestwareGenerationPreferences, TestwareOutputFormat } from '../tauri'
import { useModalDialog } from '../hooks/useModalDialog'
import {
  defaultTestwareGenerationPreferences,
  testwareDepthOptions,
  testwareOutputFormatOptions,
  testwareTechniquePresets,
} from '../testware/generationPreferences'

export function GenerationPreflight({
  action,
  activeProviderAvailable,
  activeProviderLabel,
  isBusy,
  noteScreenshotCount,
  noteTitle,
  noteWordCount,
  selectedModel,
  selectedReasoning = null,
  selectionWarning = null,
  onCancel,
  onConfirm,
}: {
  action: GenerateAiActionKind
  activeProviderAvailable: boolean
  activeProviderLabel: string
  isBusy: boolean
  noteScreenshotCount: number
  noteTitle: string
  noteWordCount: number
  selectedModel: string
  selectedReasoning?: string | null
  selectionWarning?: string | null
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
          <dt>Source note</dt>
          <dd>{noteTitle.trim() || 'Untitled note'}</dd>
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
          <dd>{selectedModel}</dd>
        </div>
        <div>
          <dt>Reasoning</dt>
          <dd>{selectedReasoning ?? 'Provider default'}</dd>
        </div>
      </dl>
      {selectionWarning ? <p role="alert">{selectionWarning}</p> : null}
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
        <button className="secondary-button" type="button" disabled={isBusy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={isBusy || !activeProviderAvailable}
          onClick={() => onConfirm(isTestware ? testwarePreferences : undefined)}
        >
          {copy.confirmLabel}
        </button>
      </div>
    </dialog>
  )
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
