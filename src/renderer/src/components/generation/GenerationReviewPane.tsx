import type { ReactElement } from 'react'
import { Bot, Bug, ImagePlus, Loader2, Sparkles } from 'lucide-react'
import { reasoningEffortDescriptor } from '../../../../shared/contracts'
import type { AiProviderId, AiProviderStatus, ProviderStatus, ReasoningEffort, Session } from '../../../../shared/contracts'
import type { ContextAttachment, ContextRow, Finding } from '../../domain/types'
import { firstLine, formatEntryType, providerSummary } from '../../domain/formatters'
import { ReviewAttachmentList } from '../evidence/Attachments'

export function GenerationReviewPane(props: {
  session: Session
  rows: ContextRow[]
  sessionAttachments: ContextAttachment[]
  findings: Finding[]
  providerStatus: ProviderStatus | null
  selectedProvider: AiProviderId | null
  selectedModel: string
  selectedReasoningEffort: ReasoningEffort | null
  busy: boolean
  generating: boolean
  contextReady: boolean
  onProviderChange: (provider: AiProviderId | null) => void
  onModelChange: (model: string) => void
  onReasoningEffortChange: (effort: ReasoningEffort | null) => void
  onToggleEntry: (row: ContextRow) => Promise<void>
  onToggleAttachment: (item: ContextAttachment) => Promise<void>
  onGenerate: () => Promise<void>
}): ReactElement {
  const includedRows = props.rows.filter((row) => row.included)
  const excludedRows = props.rows.filter((row) => !row.included)
  const includedSessionAttachments = props.sessionAttachments.filter((item) => item.included)
  const includedAttachments = [...includedRows.flatMap((row) => row.attachments), ...includedSessionAttachments.map((item) => item.attachment)]
  const availableProviders = props.providerStatus?.providers.filter((provider) => provider.available) ?? []
  const unavailableProviders = props.providerStatus?.providers.filter((provider) => !provider.available) ?? []
  const selectedProviderStatus = availableProviders.find((provider) => provider.provider === props.selectedProvider) ?? null
  const reasoningDescriptor = selectedProviderStatus ? reasoningEffortDescriptor(selectedProviderStatus, props.selectedModel) : null
  const hasProvider = Boolean(selectedProviderStatus)
  const providerReadiness = selectedProviderStatus
    ? `${selectedProviderStatus.label}${props.selectedModel ? ` / ${props.selectedModel}` : ''}`
    : availableProviders.length > 0
      ? 'Choose a provider before generating'
      : 'No available providers'

  return (
    <section className="review-pane">
      <div className="review-header">
        <div>
          <span className="eyebrow">Review before provider call</span>
          <h2>Generation Context</h2>
          <p>
            {includedRows.length} included Entries, {excludedRows.length} excluded, {includedAttachments.length} included
            attachments, {props.findings.length} Findings.
          </p>
        </div>
        <button
          className="primary-command"
          disabled={props.generating || props.busy || !hasProvider || (includedRows.length === 0 && includedAttachments.length === 0)}
          type="button"
          onClick={() => void props.onGenerate()}
        >
          {props.generating ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
          Generate
        </button>
      </div>

      <div className="context-summary">
        <SummaryItem label="Session" value={props.session.title} />
        <SummaryItem label="Target" value={props.session.testTarget || 'Not set'} />
        <SummaryItem label="Providers" value={providerSummary(props.providerStatus)} />
      </div>

      <details className="provider-panel" aria-label="Generation provider options" open={!hasProvider}>
        <summary className="provider-panel-summary">
          <span>
            <span className="eyebrow">Provider settings</span>
            <strong>{providerReadiness}</strong>
          </span>
          <span className={hasProvider ? 'provider-ready' : 'provider-missing'}>{hasProvider ? 'Ready' : 'Needs setup'}</span>
        </summary>
        <div className="provider-controls">
          <label className="field">
            <span>Provider (required)</span>
            <select
              value={props.selectedProvider ?? ''}
              onChange={(event) => props.onProviderChange(event.target.value ? (event.target.value as AiProviderId) : null)}
              disabled={availableProviders.length === 0}
            >
              {availableProviders.length === 0 ? <option value="">No available providers</option> : null}
              {availableProviders.map((provider) => (
                <option value={provider.provider} key={provider.provider}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>

          {selectedProviderStatus ? (
            <ModelSelector
              provider={selectedProviderStatus}
              selectedModel={props.selectedModel}
              onModelChange={props.onModelChange}
            />
          ) : null}

          {reasoningDescriptor ? (
            <label className="field">
              <span>{reasoningDescriptor.label} (optional)</span>
              <select
                value={props.selectedReasoningEffort ?? ''}
                onChange={(event) =>
                  props.onReasoningEffortChange(event.target.value ? (event.target.value as ReasoningEffort) : null)
                }
              >
                <option value="">Provider default</option>
                {reasoningDescriptor.options.map((option) => (
                  <option value={option.value} key={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {unavailableProviders.length > 0 ? (
          <div className="provider-unavailable" aria-label="Unavailable provider reasons">
            {unavailableProviders.map((provider) => (
              <span key={provider.provider}>
                {provider.label}: {provider.reason || 'Unavailable'}
              </span>
            ))}
          </div>
        ) : null}
      </details>

      <div className="review-columns">
        <ReviewList
          title="Included"
          rows={includedRows}
          empty="No Entries included."
          disabled={!props.contextReady || props.busy}
          onToggleEntry={props.onToggleEntry}
        />
        <ReviewList
          title="Excluded"
          rows={excludedRows}
          empty="No Entries excluded."
          disabled={!props.contextReady || props.busy}
          onToggleEntry={props.onToggleEntry}
        />
      </div>

      <section className="finding-strip">
        <div className="section-heading">
          <ImagePlus size={16} />
          <h3>Session attachments in context (optional)</h3>
        </div>
        <ReviewAttachmentList
          attachments={props.sessionAttachments}
          disabled={!props.contextReady || props.busy}
          onToggleAttachment={props.onToggleAttachment}
        />
      </section>

      <section className="finding-strip">
        <div className="section-heading">
          <Bug size={16} />
          <h3>Findings in context</h3>
        </div>
        {props.findings.length === 0 ? (
          <p className="muted">No Findings created yet.</p>
        ) : (
          props.findings.map((finding) => (
            <article className="finding-row" key={finding.id}>
              <strong>{finding.title}</strong>
              <span>{finding.summary}</span>
              <small>{finding.evidenceEntryIds.length} linked Entries</small>
            </article>
          ))
        )}
      </section>
    </section>
  )
}

function ReviewList(props: {
  title: string
  rows: ContextRow[]
  empty: string
  disabled: boolean
  onToggleEntry: (row: ContextRow) => Promise<void>
}): ReactElement {
  return (
    <section className="review-list">
      <h3>{props.title}</h3>
      {props.rows.length === 0 ? <p className="muted">{props.empty}</p> : null}
      {props.rows.map((row) => (
        <article className="context-entry" key={row.entry.id}>
          <div>
            <span className="eyebrow">{formatEntryType(row.entry.type)}</span>
            <strong>{row.entry.title || firstLine(row.entry.body) || 'Untitled Entry'}</strong>
            <p>{row.entry.body}</p>
          </div>
          <div className="context-entry-footer">
            <span>{row.attachments.length} attachments</span>
            <button
              className="secondary-command compact"
              disabled={props.disabled}
              type="button"
              onClick={() => void props.onToggleEntry(row)}
            >
              {row.included ? 'Exclude' : 'Include'}
            </button>
          </div>
        </article>
      ))}
    </section>
  )
}

function SummaryItem(props: { label: string; value: string }): ReactElement {
  return (
    <div>
      <span className="eyebrow">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function ModelSelector(props: {
  provider: AiProviderStatus
  selectedModel: string
  onModelChange: (model: string) => void
}): ReactElement {
  const isPreset = props.provider.models.includes(props.selectedModel)
  const selectValue = isPreset ? props.selectedModel : 'custom'
  const modelLabels = new Map(props.provider.modelDescriptors.map((descriptor) => [descriptor.id, descriptor.label]))

  return (
    <div className="model-selector">
      <label className="field">
        <span>Model (optional)</span>
        <select
          value={selectValue}
          onChange={(event) => {
            if (event.target.value === 'custom') {
              props.onModelChange(isPreset ? '' : props.selectedModel)
              return
            }
            props.onModelChange(event.target.value)
          }}
        >
          {props.provider.models.map((model) => (
            <option value={model} key={model}>
              {modelLabels.get(model) ?? model}
            </option>
          ))}
          <option value="custom">Custom model</option>
        </select>
      </label>
      {selectValue === 'custom' ? (
        <label className="field">
          <span>Custom model (optional)</span>
          <input
            value={props.selectedModel}
            onChange={(event) => props.onModelChange(event.target.value)}
            placeholder={props.provider.defaultModel ?? 'Model name'}
          />
        </label>
      ) : null}
    </div>
  )
}

export function StatusPill({ providerStatus }: { providerStatus: ProviderStatus | null }): ReactElement {
  const availableCount = providerStatus?.providers.filter((provider) => provider.available).length ?? 0
  const totalCount = providerStatus?.providers.length ?? 0
  const summary = providerSummary(providerStatus)

  return (
    <div className={availableCount > 0 ? 'status-pill ready' : 'status-pill'} title={totalCount > 0 ? summary : undefined}>
      <Bot size={15} />
      <span>{summary}</span>
    </div>
  )
}
