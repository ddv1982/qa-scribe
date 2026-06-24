import type { GenerateAiActionKind } from '../tauri'

export function GenerationPreflight({
  action,
  activeProviderAvailable,
  activeProviderLabel,
  isBusy,
  noteScreenshotCount,
  noteTitle,
  noteWordCount,
  selectedModel,
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
  onCancel: () => void
  onConfirm: () => void
}) {
  const copy = generationPreflightCopy(action)
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="confirmation-dialog generation-preflight" role="dialog" aria-modal="true" aria-labelledby="generation-preflight-title">
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
        </dl>
        <div className="confirmation-actions">
          <button className="secondary-button" type="button" disabled={isBusy} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="button" disabled={isBusy || !activeProviderAvailable} onClick={onConfirm}>
            {copy.confirmLabel}
          </button>
        </div>
      </section>
    </div>
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
