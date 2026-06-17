import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { Bot, Bug, ChevronDown, Clipboard, Filter, ImagePlus, Plus, Search, Trash2 } from 'lucide-react'
import { defaultAppSettings } from '../../../../shared/contracts'
import type { AppSettings, Attachment, Entry, EntryType, FormTemplateField, SessionSnapshot } from '../../../../shared/contracts'
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
  findingDraftAttachmentCount: number
  templates?: AppSettings['templates']
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
  onAttachToDraft: () => Promise<void>
  onAttachToFindingDraft: (field: 'actual' | 'expected') => Promise<void>
  onSelect: (entryId: string) => void
  onDelete: (entry: Entry) => Promise<void>
  onToggleExclude: (entry: Entry) => Promise<void>
  onCreateFinding: (entry: Entry) => Promise<void>
}): ReactElement {
  const templates = props.templates ?? defaultAppSettings.templates
  const noteFields = enabledFields(templates.note.fields)
  const findingFields = enabledFields(templates.finding.fields)
  const noteSubmitDisabled = !requiredFieldsSatisfied(noteFields, noteValue)
  const findingSubmitDisabled = !requiredFieldsSatisfied(findingFields, findingValue)
  const submitDisabled = props.captureMode === 'note' ? noteSubmitDisabled : findingSubmitDisabled
  const selectedEvidenceLabel = props.selectedEntry
    ? props.selectedEntry.title || firstLine(props.selectedEntry.body) || formatEntryType(props.selectedEntry.type)
    : null
  const hasTimelineFilters = props.query.trim().length > 0 || props.filter !== 'all'
  const emptyTitle = props.snapshot.entries.length === 0 ? 'No Entries yet' : 'No matching Entries'
  const emptyDescription =
    props.snapshot.entries.length === 0
      ? 'Use the composer below to capture notes as testing happens. Turn important behavior into Findings when it matters.'
      : 'The current search or type filter is hiding the captured Entries.'

  function handleRichTextChange(value: RichTextValue): void {
    props.setEntryBody(value.text)
    props.setEntryMetadataJson(value.metadataJson)
  }

  function handleActualResultChange(value: RichTextValue): void {
    props.onUpdateFindingDraft({ actual: value.text, actualMetadataJson: value.metadataJson })
  }

  function handleExpectedResultChange(value: RichTextValue): void {
    props.onUpdateFindingDraft({ expected: value.text, expectedMetadataJson: value.metadataJson })
  }

  function noteValue(field: FormTemplateField): string {
    if (field.id === 'title') return props.entryTitle
    if (field.id === 'body') return props.entryBody
    return 'configured'
  }

  function findingValue(field: FormTemplateField): string {
    if (field.id === 'title') return props.findingDraft.title
    if (field.id === 'actual') return props.findingDraft.actual
    if (field.id === 'expected') return props.findingDraft.expected
    if (field.id === 'steps') return props.findingDraft.steps
    if (field.id === 'severity') return props.findingDraft.severity
    if (field.id === 'priority') return props.findingDraft.priority
    if (field.id === 'component') return props.findingDraft.component
    if (field.id === 'environment') return props.findingDraft.environment
    if (field.id === 'notes') return props.findingDraft.notes
    return 'configured'
  }

  return (
    <>
      <div className="timeline-tools">
        <div className="timeline-tools-summary">
          <span className="eyebrow">Session Timeline</span>
          <strong>
            {props.filteredEntries.length} of {props.snapshot.entries.length} Entries
          </strong>
        </div>
        <div className="timeline-tools-controls">
          <label className="search-box">
            <Search size={15} />
            <input
              aria-label="Search Entries"
              placeholder="Search"
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
            Evidence
          </button>
        </div>
      </div>

      <div className="timeline" aria-label="Session Timeline">
        {props.filteredEntries.length === 0 ? (
          <div className="empty-state capture-empty">
            <Clipboard size={34} />
            <h2>{emptyTitle}</h2>
            <p>{emptyDescription}</p>
            {hasTimelineFilters ? (
              <button
                className="secondary-command fit"
                type="button"
                onClick={() => {
                  props.setQuery('')
                  props.setFilter('all')
                }}
              >
                Clear filters
              </button>
            ) : null}
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
        </div>
        {props.captureMode === 'note' ? (
          <div className="finding-fields note-template-fields">
            {noteFields.map((field) => renderNoteField(field))}
          </div>
        ) : (
          <div className="finding-fields">
            {findingFields.map((field) => renderFindingField(field))}
          </div>
        )}
        <div className="composer-actions">
          <span>
            {props.snapshot.entries.length} Entries / {props.snapshot.findings.length} Findings
            {props.captureMode === 'finding' && props.findingDraftAttachmentCount > 0
              ? ` / ${props.findingDraftAttachmentCount} draft Evidence`
              : ''}
          </span>
          <button className="primary-command fit" disabled={submitDisabled} type="submit">
            <Plus size={16} />
            {props.captureMode === 'note' ? 'Add Note' : 'Add Finding'}
          </button>
        </div>
      </form>
    </>
  )

  function renderNoteField(field: FormTemplateField): ReactElement | null {
    if (field.id === 'title') {
      return renderTextInput({
        field,
        ariaLabel: 'Note title',
        placeholder: 'Note title (optional)',
        value: props.entryTitle,
        onChange: props.setEntryTitle
      })
    }

    if (field.id === 'body') {
      if (field.type !== 'rich_text') {
        return renderTextInput({
          field,
          ariaLabel: 'Note body',
          className: 'field-wide',
          placeholder: 'Capture what happened...',
          value: props.entryBody,
          onChange: (value) => {
            props.setEntryBody(value)
            props.setEntryMetadataJson(null)
          }
        })
      }

      return (
        <div className="field field-wide" key={field.id}>
          <span>{field.label}</span>
          <RichTextEditor
            ariaLabel="Note body"
            initialMetadataJson={props.entryMetadataJson}
            initialText={props.entryBody}
            placeholder="Capture what happened..."
            resetKey={props.richTextResetKey}
            onChange={handleRichTextChange}
            onAttach={hasField(noteFields, 'evidence') ? props.onAttachToDraft : undefined}
          />
        </div>
      )
    }

    if (field.id === 'evidence') {
      if (noteFields.some((item) => item.id === 'body' && item.type === 'rich_text')) return null

      return (
        <button className="secondary-command fit" key={field.id} type="button" onClick={() => void props.onAttachToDraft()}>
          <ImagePlus size={16} />
          {field.label}
        </button>
      )
    }

    return null
  }

  function renderFindingField(field: FormTemplateField): ReactElement | null {
    if (field.id === 'title') {
      return renderTextInput({
        field,
        ariaLabel: 'Finding title (required)',
        placeholder: 'Finding title (required)',
        value: props.findingDraft.title,
        onChange: (value) => props.onUpdateFindingDraft({ title: value })
      })
    }

    if (field.id === 'actual') {
      if (field.type !== 'rich_text') {
        return renderTextInput({
          field,
          ariaLabel: 'Actual result',
          placeholder: 'What failed, changed, blocked you, or looked wrong?',
          value: props.findingDraft.actual,
          onChange: (value) => props.onUpdateFindingDraft({ actual: value, actualMetadataJson: null })
        })
      }

      return (
        <div className="field" key={field.id}>
          <span>{field.label}</span>
          <RichTextEditor
            ariaLabel="Actual result"
            initialMetadataJson={props.findingDraft.actualMetadataJson ?? null}
            initialText={props.findingDraft.actual}
            placeholder="What failed, changed, blocked you, or looked wrong?"
            resetKey={props.richTextResetKey}
            onChange={handleActualResultChange}
            onAttach={() => void props.onAttachToFindingDraft('actual')}
          />
        </div>
      )
    }

    if (field.id === 'expected') {
      if (field.type !== 'rich_text') {
        return renderTextInput({
          field,
          ariaLabel: 'Expected result',
          placeholder: 'What should have happened?',
          value: props.findingDraft.expected,
          onChange: (value) => props.onUpdateFindingDraft({ expected: value, expectedMetadataJson: null })
        })
      }

      return (
        <div className="field" key={field.id}>
          <span>{field.label}</span>
          <RichTextEditor
            ariaLabel="Expected result"
            initialMetadataJson={props.findingDraft.expectedMetadataJson ?? null}
            initialText={props.findingDraft.expected}
            placeholder="What should have happened?"
            resetKey={props.richTextResetKey}
            onChange={handleExpectedResultChange}
            onAttach={() => void props.onAttachToFindingDraft('expected')}
          />
        </div>
      )
    }

    if (field.id === 'steps') {
      return renderTextInput({
        field,
        ariaLabel: 'Steps to reproduce',
        className: 'field-wide',
        placeholder: 'One step per line',
        value: props.findingDraft.steps,
        onChange: (value) => props.onUpdateFindingDraft({ steps: value })
      })
    }

    if (field.id === 'severity') {
      return (
        <label className="field" key={field.id}>
          <span>{field.label}</span>
          <select
            aria-label="Severity"
            value={props.findingDraft.severity}
            onChange={(event) => props.onUpdateFindingDraft({ severity: event.target.value })}
          >
            {selectOptions(field, ['untriaged', 'critical', 'major', 'minor', 'trivial']).map((option) => (
              <option value={option} key={option}>{formatOption(option)}</option>
            ))}
          </select>
        </label>
      )
    }

    if (field.id === 'priority') {
      return (
        <label className="field" key={field.id}>
          <span>{field.label}</span>
          <select
            aria-label="Priority"
            value={props.findingDraft.priority}
            onChange={(event) => props.onUpdateFindingDraft({ priority: event.target.value })}
          >
            {selectOptions(field, ['medium', 'urgent', 'high', 'low']).map((option) => (
              <option value={option} key={option}>{formatOption(option)}</option>
            ))}
          </select>
        </label>
      )
    }

    if (field.id === 'component') {
      return renderTextInput({
        field,
        ariaLabel: 'Component',
        placeholder: 'Area or feature',
        value: props.findingDraft.component,
        onChange: (value) => props.onUpdateFindingDraft({ component: value })
      })
    }

    if (field.id === 'environment') {
      return renderTextInput({
        field,
        ariaLabel: 'Finding environment',
        placeholder: 'Uses Session environment if empty',
        value: props.findingDraft.environment,
        onChange: (value) => props.onUpdateFindingDraft({ environment: value })
      })
    }

    if (field.id === 'notes') {
      return renderTextInput({
        field,
        ariaLabel: 'Finding notes',
        className: 'field-wide',
        placeholder: 'Extra context, logs, workaround, suspected cause',
        value: props.findingDraft.notes,
        onChange: (value) => props.onUpdateFindingDraft({ notes: value })
      })
    }

    if (field.id === 'linked-entry') {
      return (
        <label className="evidence-toggle" key={field.id}>
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
      )
    }

    return null
  }
}

function enabledFields(fields: FormTemplateField[]): FormTemplateField[] {
  return fields.filter((field) => field.enabled)
}

function hasField(fields: FormTemplateField[], id: string): boolean {
  return fields.some((field) => field.id === id)
}

function requiredFieldsSatisfied(fields: FormTemplateField[], valueFor: (field: FormTemplateField) => string): boolean {
  return fields.every((field) => !field.required || valueFor(field).trim().length > 0)
}

function renderTextInput(props: {
  field: FormTemplateField
  ariaLabel: string
  className?: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}): ReactElement {
  const className = ['field', props.className].filter(Boolean).join(' ')
  const options = selectOptions(props.field, props.value ? [props.value] : [''])
  const controlProps = {
    'aria-label': props.ariaLabel,
    placeholder: props.placeholder,
    value: props.value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => props.onChange(event.target.value)
  }

  if (props.field.type === 'checkbox') {
    return (
      <div className={className} key={props.field.id}>
        <span>{props.field.label}</span>
        <label className="settings-toggle compact-toggle">
          <input
            aria-label={props.ariaLabel}
            checked={props.value.trim().length > 0}
            type="checkbox"
            onChange={(event) => props.onChange(event.target.checked ? props.field.label : '')}
          />
          <span>{props.placeholder}</span>
        </label>
      </div>
    )
  }

  return (
    <label className={className} key={props.field.id}>
      <span>{props.field.label}</span>
      {props.field.type === 'select' ? (
        <select aria-label={props.ariaLabel} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
          {options.map((option) => (
            <option value={option} key={option}>{option ? formatOption(option) : 'Not set'}</option>
          ))}
        </select>
      ) : props.field.type === 'multiselect' ? (
        <select
          aria-label={props.ariaLabel}
          multiple
          value={props.value ? props.value.split('\n') : []}
          onChange={(event) =>
            props.onChange(Array.from(event.target.selectedOptions).map((option) => option.value).filter(Boolean).join('\n'))
          }
        >
          {options.filter(Boolean).map((option) => (
            <option value={option} key={option}>{formatOption(option)}</option>
          ))}
        </select>
      ) : props.field.type === 'textarea' || props.field.type === 'rich_text' ? (
        <textarea {...controlProps} />
      ) : (
        <input {...controlProps} />
      )}
    </label>
  )
}

function selectOptions(field: FormTemplateField, fallback: string[]): string[] {
  return field.options && field.options.length > 0 ? field.options : fallback
}

function formatOption(value: string): string {
  return value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase())
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
