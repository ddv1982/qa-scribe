import type { ReactElement } from 'react'
import { Bot, Bug, CheckCircle2, CircleMinus, FileText, Loader2, Paperclip, Sparkles, Target } from 'lucide-react'
import { reasoningEffortDescriptor } from '../../../../shared/contracts'
import type { AiProviderId, AiProviderStatus, ProviderStatus, ReasoningEffort, Session } from '../../../../shared/contracts'
import type { ContextAttachment, ContextRow, Finding } from '../../domain/types'
import { firstLine, formatEntryType, providerSummary } from '../../domain/formatters'
import { AttachmentSummaryList, ReviewAttachmentList } from '../evidence/Attachments'

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
  onAddAttachment: () => void
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
  const generateDisabled = props.generating || props.busy || !hasProvider || (includedRows.length === 0 && includedAttachments.length === 0)

  return (
    <section className="review-pane">
      <h2 className="visually-hidden">Generation Context</h2>
      <p className="context-intro">Review and confirm the information to guide generation.</p>

      <div className="context-summary">
        <SummaryItem
          icon={<FileText size={18} />}
          label="Session"
          title={props.session.title}
          value={`Created ${formatShortDate(props.session.createdAt)}`}
          meta={`${props.rows.length} notes · ${props.findings.length} findings`}
        />
        <SummaryItem
          icon={<Target size={18} />}
          label="Context"
          title={props.session.testTarget || 'No additional context'}
          value={props.session.charter || 'Add details, scope, or goals to improve results.'}
        />
        <SummaryItem
          icon={<Bot size={18} />}
          label="Provider"
          title={selectedProviderStatus?.label ?? 'No provider selected'}
          value={hasProvider ? 'Provider is ready' : providerReadiness}
          meta={providerSummary(props.providerStatus)}
          ready={hasProvider}
        />
      </div>

      <section className="provider-panel" aria-label="Generation provider options">
        <div className="provider-controls">
          <label className="field">
            <span>Provider</span>
            <select
              aria-label="Provider (required)"
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
      </section>

      <div className="review-grid">
        <ReviewList
          count={includedRows.length}
          icon={<FileText size={16} />}
          title="Included entries"
          rows={includedRows}
          empty="No included entries."
          disabled={!props.contextReady || props.busy}
          onToggleEntry={props.onToggleEntry}
        />
        <ReviewList
          count={excludedRows.length}
          icon={<CircleMinus size={16} />}
          title="Excluded entries"
          rows={excludedRows}
          empty="No excluded entries. Exclude notes or findings you don't want to include."
          disabled={!props.contextReady || props.busy}
          onToggleEntry={props.onToggleEntry}
        />
        <section className="review-list attachment-context-card">
          <div className="context-card-heading">
            <span>
              <Paperclip size={16} />
              <h3>Attachments</h3>
            </span>
            <strong>{props.sessionAttachments.length}</strong>
          </div>
          {props.sessionAttachments.length === 0 ? (
            <div className="context-empty">
              <Paperclip size={34} />
              <p>No attachments</p>
              <span>Add screenshots, docs, or files to provide more context.</span>
            </div>
          ) : (
            <ReviewAttachmentList
              attachments={props.sessionAttachments}
              disabled={!props.contextReady || props.busy}
              onToggleAttachment={props.onToggleAttachment}
            />
          )}
          <button className="context-link-action" disabled={!props.contextReady || props.busy} type="button" onClick={props.onAddAttachment}>
            + Add attachment
          </button>
        </section>
      </div>

      <section className="finding-strip">
        <div className="context-card-heading">
          <span>
            <Bug size={16} />
            <h3>Findings</h3>
          </span>
          <strong>{props.findings.length}</strong>
        </div>
        {props.findings.length === 0 ? (
          <div className="context-empty compact">
            <Bug size={26} />
            <p>No findings captured</p>
            <span>Findings from your notes will appear here.</span>
          </div>
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

      <section className={generateDisabled ? 'generation-ready-bar blocked' : 'generation-ready-bar'}>
        <div>
          <CheckCircle2 size={22} />
          <span>
            <strong>{generateDisabled ? 'Review context before generating' : 'Ready to generate'}</strong>
            <small>
              {generateDisabled
                ? 'Choose an available provider and include at least one Entry or attachment.'
                : 'Your context looks good. You can generate Testware when you are ready.'}
            </small>
          </span>
        </div>
        <button className="primary-command" disabled={generateDisabled} type="button" onClick={() => void props.onGenerate()}>
          {props.generating ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
          Generate Testware
        </button>
      </section>
    </section>
  )
}

function ReviewList(props: {
  count: number
  icon: ReactElement
  title: string
  rows: ContextRow[]
  empty: string
  disabled: boolean
  onToggleEntry: (row: ContextRow) => Promise<void>
}): ReactElement {
  return (
    <section className="review-list">
      <div className="context-card-heading">
        <span>
          {props.icon}
          <h3>{props.title}</h3>
        </span>
        <strong>{props.count}</strong>
      </div>
      {props.rows.length === 0 ? (
        <div className="context-empty compact">
          <CircleMinus size={26} />
          <p>{props.empty}</p>
        </div>
      ) : null}
      {props.rows.map((row) => (
        <article className="context-entry" key={row.entry.id}>
          <div>
            <span className="eyebrow">{formatEntryType(row.entry.type)}</span>
            <strong>{row.entry.title || firstLine(row.entry.body) || 'Untitled Entry'}</strong>
            <p>{row.entry.body}</p>
          </div>
          <AttachmentSummaryList attachments={row.attachments} compact />
          <div className="context-entry-footer">
            <span>
              {row.attachments.length === 1 ? '1 attachment' : `${row.attachments.length} attachments`}
            </span>
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

function SummaryItem(props: {
  icon: ReactElement
  label: string
  meta?: string
  ready?: boolean
  title: string
  value: string
}): ReactElement {
  return (
    <article className={props.ready ? 'summary-card ready' : 'summary-card'}>
      <span className="summary-icon">{props.icon}</span>
      <div>
        <span className="eyebrow">{props.label}</span>
        <strong>{props.title}</strong>
        <p>{props.value}</p>
        {props.meta ? <small>{props.meta}</small> : null}
      </div>
    </article>
  )
}

function formatShortDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'recently'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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
