import { type MouseEvent, type ReactElement } from 'react'
import {
  Bot,
  Bug,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  Filter,
  ImagePlus,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2
} from 'lucide-react'
import type {
  Attachment,
  AiProviderId,
  AiProviderStatus,
  Entry,
  EntryType,
  ProviderStatus,
  ReasoningEffort,
  Session,
  SessionSnapshot
} from '../../../shared/contracts'
import { entryTypes } from '../domain/session'
import type { ContextAttachment, ContextRow, Finding, ReviewDraft, WorkspaceMode } from '../domain/types'
import { formatJiraDraft, jiraDraftFromFinding } from '../domain/reviewDrafts'
import { firstLine, formatEntryType, formatReasoningEffort, formatTime, providerSummary } from '../domain/formatters'

export function CapturePane(props: {
  snapshot: SessionSnapshot
  filteredEntries: Entry[]
  selectedEntryId: string | null
  query: string
  filter: EntryType | 'all'
  entryType: EntryType
  entryTitle: string
  entryBody: string
  setQuery: (value: string) => void
  setFilter: (value: EntryType | 'all') => void
  setEntryType: (value: EntryType) => void
  setEntryTitle: (value: string) => void
  setEntryBody: (value: string) => void
  onAddEntry: () => Promise<void>
  onAttach: (entryId?: string) => Promise<void>
  onSelect: (entryId: string) => void
  onDelete: (entry: Entry) => Promise<void>
  onToggleExclude: (entry: Entry) => Promise<void>
  onCreateFinding: (entry: Entry) => Promise<void>
}): ReactElement {
  return (
    <>
      <div className="timeline-tools">
        <label className="search-box">
          <Search size={15} />
          <input
            aria-label="Search Entries"
            placeholder="Search Entries"
            value={props.query}
            onChange={(event) => props.setQuery(event.target.value)}
          />
        </label>
        <label className="select-box">
          <Filter size={15} />
          <select
            aria-label="Filter by Entry type"
            value={props.filter}
            onChange={(event) => props.setFilter(event.target.value as EntryType | 'all')}
          >
            <option value="all">All types</option>
            {entryTypes.map((type) => (
              <option value={type.value} key={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
        <button className="secondary-command compact" type="button" onClick={() => props.onAttach()}>
          <ImagePlus size={16} />
          Attach
        </button>
      </div>

      <div className="timeline" aria-label="Session Timeline">
        {props.filteredEntries.length === 0 ? (
          <div className="empty-state">
            <Clipboard size={34} />
            <h2>No Entries yet</h2>
            <p>Capture notes, observations, API responses, logs, and possible Findings as they happen.</p>
          </div>
        ) : (
          props.filteredEntries.map((entry) => (
            <TimelineEntry
              attachments={props.snapshot.attachments.filter((attachment) => attachment.entryId === entry.id)}
              entry={entry}
              key={entry.id}
              onAttach={() => props.onAttach(entry.id)}
              onCreateFinding={() => props.onCreateFinding(entry)}
              onDelete={() => props.onDelete(entry)}
              onSelect={() => props.onSelect(entry.id)}
              onToggleExclude={() => props.onToggleExclude(entry)}
              selected={props.selectedEntryId === entry.id}
            />
          ))
        )}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onAddEntry()
        }}
      >
        <div className="composer-header">
          <select value={props.entryType} onChange={(event) => props.setEntryType(event.target.value as EntryType)}>
            {entryTypes.map((type) => (
              <option value={type.value} key={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <input
            placeholder="Entry title (optional)"
            value={props.entryTitle}
            onChange={(event) => props.setEntryTitle(event.target.value)}
          />
        </div>
        <textarea
          placeholder="Capture what happened..."
          value={props.entryBody}
          onChange={(event) => props.setEntryBody(event.target.value)}
        />
        <div className="composer-actions">
          <span>{props.snapshot.entries.length} Entries</span>
          <button className="primary-command fit" disabled={props.entryBody.trim().length === 0} type="submit">
            <Plus size={16} />
            Add Entry
          </button>
        </div>
      </form>
    </>
  )
}

export function ModeTabs(props: {
  mode: WorkspaceMode
  setMode: (mode: WorkspaceMode) => void
  onOpenGeneration: () => Promise<void>
}): ReactElement {
  return (
    <nav className="mode-tabs" aria-label="Workspace mode">
      <button className={props.mode === 'capture' ? 'selected' : ''} type="button" onClick={() => props.setMode('capture')}>
        Capture
      </button>
      <button
        className={props.mode === 'generation' ? 'selected' : ''}
        type="button"
        onClick={() => void props.onOpenGeneration()}
      >
        Generation Context
      </button>
      <button className={props.mode === 'drafts' ? 'selected' : ''} type="button" onClick={() => props.setMode('drafts')}>
        Drafts
      </button>
    </nav>
  )
}

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
  const hasProvider = Boolean(selectedProviderStatus)

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

      <section className="provider-panel" aria-label="Generation provider options">
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

          {selectedProviderStatus && selectedProviderStatus.reasoningEfforts.length > 0 ? (
            <label className="field">
              <span>Reasoning (optional)</span>
              <select
                value={props.selectedReasoningEffort ?? ''}
                onChange={(event) =>
                  props.onReasoningEffortChange(event.target.value ? (event.target.value as ReasoningEffort) : null)
                }
              >
                <option value="">Provider default</option>
                {selectedProviderStatus.reasoningEfforts.map((effort) => (
                  <option value={effort} key={effort}>
                    {formatReasoningEffort(effort)}
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

export function DraftsPane(props: {
  draft: ReviewDraft
  findings: Finding[]
  onUpdateContent: (content: string) => void
  onSave: () => Promise<void>
  onCopy: (text: string, message?: string) => Promise<void>
}): ReactElement {
  return (
    <section className="drafts-pane">
      <div className="draft-editor">
        <div className="review-header">
          <div>
            <span className="eyebrow">Editable Draft</span>
            <h2>{props.draft.title}</h2>
          </div>
          <div className="topbar-actions">
            <button className="secondary-command" type="button" onClick={() => props.onCopy(props.draft.content, 'Report copied')}>
              <Copy size={16} />
              Copy Report
            </button>
            <button className="primary-command" type="button" onClick={() => void props.onSave()}>
              <Check size={16} />
              Save Draft
            </button>
          </div>
        </div>
        <textarea
          aria-label="Session Report Draft"
          value={props.draft.content}
          onChange={(event) => props.onUpdateContent(event.target.value)}
        />
      </div>

      <div className="jira-drafts">
        <div className="section-heading">
          <Bug size={16} />
          <h3>Jira Bug Drafts</h3>
        </div>
        {props.draft.jiraBugDrafts.length === 0 && props.findings.length === 0 ? (
          <p className="muted">Create Findings to prepare copy-friendly bug sections.</p>
        ) : null}
        {(props.draft.jiraBugDrafts.length > 0 ? props.draft.jiraBugDrafts : props.findings.map(jiraDraftFromFinding)).map(
          (jiraDraft) => (
            <article className="jira-draft" key={jiraDraft.id}>
              <div className="jira-draft-title">
                <strong>{jiraDraft.title}</strong>
                <button
                  className="icon-command"
                  title="Copy Jira bug draft"
                  type="button"
                  onClick={() => props.onCopy(formatJiraDraft(jiraDraft), 'Jira draft copied')}
                >
                  <Copy size={15} />
                </button>
              </div>
              <dl>
                <dt>Description</dt>
                <dd>{jiraDraft.description}</dd>
                <dt>Steps</dt>
                <dd>{jiraDraft.steps}</dd>
                <dt>Expected</dt>
                <dd>{jiraDraft.expected}</dd>
                <dt>Actual</dt>
                <dd>{jiraDraft.actual}</dd>
                <dt>Evidence</dt>
                <dd>{jiraDraft.evidence}</dd>
              </dl>
            </article>
          )
        )}
      </div>
    </section>
  )
}

export function ReviewList(props: {
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

export function TextField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  optional?: boolean
  multiline?: boolean
  error?: string | null
}): ReactElement {
  const invalid = Boolean(props.error)
  const label = `${props.label}${props.required ? ' (required)' : props.optional ? ' (optional)' : ''}`

  return (
    <label className="field">
      <span>{label}</span>
      {props.multiline ? (
        <textarea
          aria-invalid={invalid}
          aria-required={props.required}
          required={props.required}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      ) : (
        <input
          aria-invalid={invalid}
          aria-required={props.required}
          required={props.required}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
        />
      )}
      {props.error ? <small className="field-error">{props.error}</small> : null}
    </label>
  )
}

export function SummaryItem(props: { label: string; value: string }): ReactElement {
  return (
    <div>
      <span className="eyebrow">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

export function ModelSelector(props: {
  provider: AiProviderStatus
  selectedModel: string
  onModelChange: (model: string) => void
}): ReactElement {
  const isPreset = props.provider.models.includes(props.selectedModel)
  const selectValue = isPreset ? props.selectedModel : 'custom'

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
              {model}
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

export function TimelineEntry(props: {
  entry: Entry
  attachments: Attachment[]
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onAttach: () => void
  onToggleExclude: () => void
  onCreateFinding: () => void
}): ReactElement {
  return (
    <article className={props.selected ? 'timeline-entry selected' : 'timeline-entry'} onClick={props.onSelect}>
      <div className="entry-marker">
        <span>{formatEntryType(props.entry.type)}</span>
        <time>{formatTime(props.entry.createdAt)}</time>
      </div>
      <div className="entry-body">
        <div className="entry-heading">
          <h2>{props.entry.title || formatEntryType(props.entry.type)}</h2>
          <div className="entry-actions">
            <button type="button" title="Create Finding" onClick={stopAnd(props.onCreateFinding)}>
              <Bug size={15} />
            </button>
            <button type="button" title="Attach evidence" onClick={stopAnd(props.onAttach)}>
              <ImagePlus size={15} />
            </button>
            <button type="button" title="Toggle generation inclusion" onClick={stopAnd(props.onToggleExclude)}>
              <Bot size={15} />
            </button>
            <button type="button" title="Delete Entry" onClick={stopAnd(props.onDelete)}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        <p>{props.entry.body}</p>
        <div className="entry-footer">
          {props.entry.excludedFromGeneration ? <span>Excluded from generation</span> : <span>Included for generation</span>}
          {props.attachments.length > 0 ? <span>{props.attachments.length} attachments</span> : null}
        </div>
      </div>
    </article>
  )
}

export function EntryInspector(props: {
  entry: Entry
  attachments: Attachment[]
  findings: Finding[]
  onAttach: () => void
  onCreateFinding: () => void
}): ReactElement {
  return (
    <div className="inspector-stack">
      <div>
        <span className="eyebrow">{formatEntryType(props.entry.type)}</span>
        <h2>{props.entry.title || 'Untitled Entry'}</h2>
      </div>
      <dl>
        <dt>Created</dt>
        <dd>{new Date(props.entry.createdAt).toLocaleString()}</dd>
        <dt>Generation</dt>
        <dd>{props.entry.excludedFromGeneration ? 'Excluded' : 'Included'}</dd>
        <dt>Findings</dt>
        <dd>{props.findings.length}</dd>
      </dl>
      <div className="button-row">
        <button className="secondary-command fit" type="button" onClick={props.onCreateFinding}>
          <Bug size={16} />
          Create Finding
        </button>
        <button className="secondary-command fit" type="button" onClick={props.onAttach}>
          <ImagePlus size={16} />
          Attach Evidence
        </button>
      </div>
      <AttachmentList attachments={props.attachments} />
      <FindingList findings={props.findings} />
    </div>
  )
}

export function SessionInspector(props: {
  attachmentCount: number
  findingCount: number
  onDelete: () => void
}): ReactElement {
  return (
    <div className="inspector-stack">
      <dl>
        <dt>Attachments</dt>
        <dd>{props.attachmentCount}</dd>
        <dt>Findings</dt>
        <dd>{props.findingCount}</dd>
      </dl>
      <button className="danger-command fit" type="button" onClick={props.onDelete}>
        <Trash2 size={16} />
        Delete Session
      </button>
    </div>
  )
}

export function AttachmentList({ attachments }: { attachments: Attachment[] }): ReactElement {
  if (attachments.length === 0) return <p className="muted">No evidence attached.</p>
  return (
    <ul className="attachment-list">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <span>{attachment.filename}</span>
          <small>{Math.ceil(attachment.sizeBytes / 1024)} KB</small>
        </li>
      ))}
    </ul>
  )
}

export function ReviewAttachmentList(props: {
  attachments: ContextAttachment[]
  disabled: boolean
  onToggleAttachment: (item: ContextAttachment) => Promise<void>
}): ReactElement {
  if (props.attachments.length === 0) return <p className="muted">No evidence attached.</p>
  return (
    <div className="finding-list">
      {props.attachments.map((item) => (
        <article className="finding-row" key={item.attachment.id}>
          <strong>{item.attachment.filename}</strong>
          <span>{Math.ceil(item.attachment.sizeBytes / 1024)} KB</span>
          <div className="context-entry-footer">
            <small>{item.included ? 'Included in context' : 'Excluded from context'}</small>
            <button
              className="secondary-command compact"
              disabled={props.disabled}
              type="button"
              onClick={() => void props.onToggleAttachment(item)}
            >
              {item.included ? 'Exclude' : 'Include'}
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

export function FindingList({ findings }: { findings: Finding[] }): ReactElement {
  if (findings.length === 0) return <p className="muted">No Findings linked.</p>
  return (
    <div className="finding-list">
      {findings.map((finding) => (
        <article className="finding-row" key={finding.id}>
          <strong>{finding.title}</strong>
          <span>{finding.summary}</span>
          <small>{finding.evidenceEntryIds.length} linked Entries</small>
        </article>
      ))}
    </div>
  )
}

export function stopAnd(callback: () => void): (event: MouseEvent<HTMLButtonElement>) => void {
  return (event) => {
    event.stopPropagation()
    callback()
  }
}
