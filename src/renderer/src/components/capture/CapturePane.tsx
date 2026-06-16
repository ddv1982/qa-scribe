import type { KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { Bot, Bug, ChevronDown, Clipboard, Filter, ImagePlus, Plus, Search, Trash2 } from 'lucide-react'
import type { Attachment, Entry, EntryType, SessionSnapshot } from '../../../../shared/contracts'
import { entryTypes } from '../../domain/session'
import type { CaptureMode, StructuredFindingDraft } from '../../domain/types'
import { firstLine, formatEntryType, formatTime } from '../../domain/formatters'
import { RichTextContent } from '../RichTextContent'
import { RichTextEditor, type RichTextValue } from '../RichTextEditor'
import { AttachmentPreviewGrid } from '../evidence/Attachments'

export function CapturePane(props: {
  snapshot: SessionSnapshot
  filteredEntries: Entry[]
  selectedEntry: Entry | null
  selectedEntryId: string | null
  query: string
  filter: EntryType | 'all'
  captureMode: CaptureMode
  entryTitle: string
  entryBody: string
  entryMetadataJson: string | null
  findingDraft: StructuredFindingDraft
  richTextResetKey: number
  setQuery: (value: string) => void
  setFilter: (value: EntryType | 'all') => void
  setCaptureMode: (value: CaptureMode) => void
  setEntryTitle: (value: string) => void
  setEntryBody: (value: string) => void
  setEntryMetadataJson: (value: string | null) => void
  onUpdateFindingDraft: (patch: Partial<StructuredFindingDraft>) => void
  onAddEntry: () => Promise<void>
  onAddFinding: () => Promise<void>
  onAttach: (entryId?: string) => Promise<void>
  onSelect: (entryId: string) => void
  onDelete: (entry: Entry) => Promise<void>
  onToggleExclude: (entry: Entry) => Promise<void>
  onCreateFinding: (entry: Entry) => Promise<void>
}): ReactElement {
  const noteSubmitDisabled = props.entryBody.trim().length === 0
  const findingSubmitDisabled =
    props.findingDraft.title.trim().length === 0 || props.findingDraft.actual.trim().length === 0
  const submitDisabled = props.captureMode === 'note' ? noteSubmitDisabled : findingSubmitDisabled
  const selectedEvidenceLabel = props.selectedEntry
    ? props.selectedEntry.title || firstLine(props.selectedEntry.body) || formatEntryType(props.selectedEntry.type)
    : null

  function handleRichTextChange(value: RichTextValue): void {
    props.setEntryBody(value.text)
    props.setEntryMetadataJson(value.metadataJson)
  }

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
          Add Evidence
        </button>
      </div>

      <div className="timeline" aria-label="Session Timeline">
        {props.filteredEntries.length === 0 ? (
          <div className="empty-state">
            <Clipboard size={34} />
            <h2>No Entries yet</h2>
            <p>Capture notes as they happen, then turn important behavior into structured Findings.</p>
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
        className={props.captureMode === 'finding' ? 'composer finding-composer' : 'composer'}
        onSubmit={(event) => {
          event.preventDefault()
          void (props.captureMode === 'note' ? props.onAddEntry() : props.onAddFinding())
        }}
      >
        <div className="composer-header">
          <div className="composer-mode-toggle" role="group" aria-label="Capture mode">
            <button
              className={props.captureMode === 'note' ? 'selected' : ''}
              type="button"
              onClick={() => props.setCaptureMode('note')}
            >
              <Clipboard size={15} />
              Note
            </button>
            <button
              className={props.captureMode === 'finding' ? 'selected' : ''}
              type="button"
              onClick={() => props.setCaptureMode('finding')}
            >
              <Bug size={15} />
              Finding
            </button>
          </div>
          {props.captureMode === 'note' ? (
            <input
              aria-label="Note title"
              placeholder="Note title (optional)"
              value={props.entryTitle}
              onChange={(event) => props.setEntryTitle(event.target.value)}
            />
          ) : (
            <input
              aria-label="Finding summary (required)"
              placeholder="Finding summary (required)"
              value={props.findingDraft.title}
              onChange={(event) => props.onUpdateFindingDraft({ title: event.target.value })}
            />
          )}
        </div>
        {props.captureMode === 'note' ? (
          <RichTextEditor
            ariaLabel="Note body"
            initialMetadataJson={props.entryMetadataJson}
            initialText={props.entryBody}
            placeholder="Capture what happened..."
            resetKey={props.richTextResetKey}
            onChange={handleRichTextChange}
          />
        ) : (
          <div className="finding-fields">
            <label className="field">
              <span>Actual result</span>
              <textarea
                aria-label="Actual result (required)"
                placeholder="What failed, changed, blocked you, or looked wrong?"
                value={props.findingDraft.actual}
                onChange={(event) => props.onUpdateFindingDraft({ actual: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Expected result</span>
              <textarea
                aria-label="Expected result"
                placeholder="What should have happened?"
                value={props.findingDraft.expected}
                onChange={(event) => props.onUpdateFindingDraft({ expected: event.target.value })}
              />
            </label>
            <label className="field field-wide">
              <span>Steps to reproduce</span>
              <textarea
                aria-label="Steps to reproduce"
                placeholder="One step per line"
                value={props.findingDraft.steps}
                onChange={(event) => props.onUpdateFindingDraft({ steps: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Severity</span>
              <select
                aria-label="Severity"
                value={props.findingDraft.severity}
                onChange={(event) => props.onUpdateFindingDraft({ severity: event.target.value })}
              >
                <option value="untriaged">Untriaged</option>
                <option value="critical">Critical</option>
                <option value="major">Major</option>
                <option value="minor">Minor</option>
                <option value="trivial">Trivial</option>
              </select>
            </label>
            <label className="field">
              <span>Priority</span>
              <select
                aria-label="Priority"
                value={props.findingDraft.priority}
                onChange={(event) => props.onUpdateFindingDraft({ priority: event.target.value })}
              >
                <option value="medium">Medium</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="field">
              <span>Component</span>
              <input
                aria-label="Component"
                placeholder="Area or feature"
                value={props.findingDraft.component}
                onChange={(event) => props.onUpdateFindingDraft({ component: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Environment</span>
              <input
                aria-label="Finding environment"
                placeholder="Uses Session environment if empty"
                value={props.findingDraft.environment}
                onChange={(event) => props.onUpdateFindingDraft({ environment: event.target.value })}
              />
            </label>
            <label className="field field-wide">
              <span>Notes</span>
              <textarea
                aria-label="Finding notes"
                placeholder="Extra context, logs, workaround, suspected cause"
                value={props.findingDraft.notes}
                onChange={(event) => props.onUpdateFindingDraft({ notes: event.target.value })}
              />
            </label>
            <label className="evidence-toggle">
              <input
                checked={Boolean(props.selectedEntry && props.findingDraft.linkSelectedEntry)}
                disabled={!props.selectedEntry}
                type="checkbox"
                onChange={(event) => props.onUpdateFindingDraft({ linkSelectedEntry: event.target.checked })}
              />
              <span>
                {selectedEvidenceLabel
                  ? `Link selected Entry: ${selectedEvidenceLabel}`
                  : 'Select a timeline Entry to link it as evidence'}
              </span>
            </label>
          </div>
        )}
        <div className="composer-actions">
          <span>
            {props.snapshot.entries.length} Entries / {props.snapshot.findings.length} Findings
          </span>
          <button className="primary-command fit" disabled={submitDisabled} type="submit">
            <Plus size={16} />
            {props.captureMode === 'note' ? 'Add Note' : 'Add Finding'}
          </button>
        </div>
      </form>
    </>
  )
}

function TimelineEntry(props: {
  entry: Entry
  attachments: Attachment[]
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onAttach: () => void
  onToggleExclude: () => void
  onCreateFinding: () => void
}): ReactElement {
  const entryLabel = props.entry.title || firstLine(props.entry.body) || formatEntryType(props.entry.type)

  return (
    <article
      aria-label={`Select Entry: ${entryLabel}`}
      aria-pressed={props.selected}
      className={props.selected ? 'timeline-entry selected' : 'timeline-entry'}
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={selectWithKeyboard(props.onSelect)}
    >
      <div className="entry-marker">
        <span>{formatEntryType(props.entry.type)}</span>
        <time>{formatTime(props.entry.createdAt)}</time>
      </div>
      <div className="entry-body">
        <div className="entry-heading">
          <h2>{props.entry.title || formatEntryType(props.entry.type)}</h2>
          <div className="entry-actions">
            <button aria-label="Create Finding from Entry" type="button" title="Create Finding" onClick={stopAnd(props.onCreateFinding)}>
              <Bug size={15} />
            </button>
            <button aria-label="Add Evidence to Entry" type="button" title="Add Evidence" onClick={stopAnd(props.onAttach)}>
              <ImagePlus size={15} />
            </button>
            <button
              aria-label={props.entry.excludedFromGeneration ? 'Include Entry in generation' : 'Exclude Entry from generation'}
              type="button"
              title={props.entry.excludedFromGeneration ? 'Include in generation' : 'Exclude from generation'}
              onClick={stopAnd(props.onToggleExclude)}
            >
              <Bot size={15} />
            </button>
            <button aria-label="Delete Entry" type="button" title="Delete Entry" onClick={stopAnd(props.onDelete)}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        <RichTextContent body={props.entry.body} metadataJson={props.entry.metadataJson} />
        <AttachmentPreviewGrid attachments={props.attachments} compact />
        <div className="entry-footer">
          {props.entry.excludedFromGeneration ? <span>Excluded from generation</span> : <span>Included for generation</span>}
          {props.attachments.length > 0 ? <span>{props.attachments.length} attachments</span> : null}
        </div>
      </div>
    </article>
  )
}

function stopAnd(callback: () => void): (event: MouseEvent<HTMLButtonElement>) => void {
  return (event) => {
    event.stopPropagation()
    callback()
  }
}

function selectWithKeyboard(callback: () => void): (event: KeyboardEvent<HTMLElement>) => void {
  return (event) => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    callback()
  }
}
