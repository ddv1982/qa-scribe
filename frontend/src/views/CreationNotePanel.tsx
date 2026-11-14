import { useMemo } from 'react'
import { createLucideIcon, FileText, PanelRight, X } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { StatePanel } from '../components/Common'
import { RichTextEditor } from '../editor/RichTextEditor'
import { richEditorDocumentFromHtml, richEditorDocumentFromStoredBody, withoutRepeatedTitleHeading } from '../editor/editorDocument'
import { htmlHasContent } from '../editor/editorHtml'
import { creationNotePanelId } from '../hooks/useCreationNoteVisible'
import type { CreationIntent } from '../app/creationIntent'
import type { CreationKind } from '../tauri'
import { kindLabels, noteReference, referencedRecord, referenceLabel, referenceValue, type CreationReference, type ReferenceRecord, type ReferenceRecords } from '../app/creationReference'

/** The side-panel icon with its right pane filled: the panel beside the draft is open. */
const PanelRightShown = createLucideIcon('panel-right-shown', [
  ['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2', key: 'frame' }],
  ['path', { d: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4z', fill: 'currentColor', key: 'pane' }],
])

/** One toggle in the draft header for the panel beside the draft, named for what the panel shows. Its right pane fills while open. */
export function CreationPanelToggle({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return <ActionButton variant="quiet" icon={open ? PanelRightShown : PanelRight} className="creation-note-toggle" aria-expanded={open}
    aria-controls={creationNotePanelId} tooltip={`${open ? 'Hide' : 'Show'} ${label}`} tooltipAlign="end" onClick={onToggle}>{label.charAt(0).toUpperCase() + label.slice(1)}</ActionButton>
}

/**
 * Read-only on the right of a new draft. Under Write: the Session's Note or a saved test case or Finding of this
 * Session to write from, records of the draft's own kind listed first. Under Generate: only the Note, which Generate uses.
 */
export function CreationNotePanel({ intent, records, reference, onReferenceChange, generating, noteReadOnly, onReadNote, onClose }: {
  intent: CreationIntent
  records: ReferenceRecords
  reference: CreationReference
  onReferenceChange: (reference: CreationReference) => void
  /** Generate mode: the Note shows, without the choice. The choice comes back under Write. */
  generating: boolean
  noteReadOnly: boolean
  onReadNote: () => void
  onClose: () => void
}) {
  // A record deleted while it is shown leaves the Note in its place.
  const record = generating ? null : referencedRecord(reference, records)
  const shown = record ? reference : noteReference
  const label = referenceLabel(shown, records)
  const kinds: CreationKind[] = intent.kind === 'finding' ? ['finding', 'testware'] : ['testware', 'finding']
  return <aside id={creationNotePanelId} className="side-panel" aria-label={record?.title ?? 'Note'}>
    <header className="side-panel-header">
      {generating ? <h2>Note</h2> : <label className="field creation-reference-field">
        <span className="field-label">Showing</span>
        <select value={referenceValue(shown)} onChange={event => {
          const [kind, id] = event.target.value.split(/:(.*)/s)
          onReferenceChange(kind === 'testware' || kind === 'finding' ? { kind, id } : noteReference)
        }}>
          <option value="note">Note</option>
          {kinds.filter(kind => records[kind].length > 0).map(kind => <optgroup key={kind} label={`${kindLabels[kind].group} (${records[kind].length})`}>
            {records[kind].map(item => <option key={item.id} value={referenceValue({ kind, id: item.id })}>{item.title.trim() || 'Untitled'}</option>)}
          </optgroup>)}
        </select>
      </label>}
      <ActionButton variant="quiet" iconOnly icon={X} aria-label={`Close ${label}`} tooltip={`Close ${label}`} tooltipAlign="end" onClick={onClose} />
    </header>
    <div className="creation-note-body">
      {generating ? <p className="creation-note-source">Generate uses this Note.</p> : null}
      {record ? <ReferenceRecordBody record={record} /> : <NoteBody intent={intent} noteReadOnly={noteReadOnly} onReadNote={onReadNote} />}
    </div>
  </aside>
}

function ReferenceRecordBody({ record }: { record: ReferenceRecord }) {
  const { body, bodyJson, title } = record
  const document = useMemo(() => withoutRepeatedTitleHeading(richEditorDocumentFromStoredBody({ body, bodyJson }), title), [body, bodyJson, title])
  // The choice above names the record, so its body shows without the title.
  return <RichTextEditor key={record.id} value={document} readOnly ariaLabel={`${title.trim() || 'Untitled'} content`} />
}

function NoteBody({ intent, noteReadOnly, onReadNote }: { intent: CreationIntent; noteReadOnly: boolean; onReadNote: () => void }) {
  const body = intent.source?.entry.body
  const written = body !== undefined && htmlHasContent(body)
  const note = useMemo(() => body === undefined ? null : richEditorDocumentFromHtml(body), [body])
  return <>
    {noteReadOnly ? <p className="inline-message advisory" role="status">Recover the Session Note before generating from it. Ordinary writing remains available.</p> : null}
    {note && written ? <RichTextEditor value={note} readOnly ariaLabel="Note content" />
      : intent.sourceNoteId && !note ? <StatePanel icon={FileText} title="The Note is not shown yet" description="Read the latest saved Note to see it here."
        action={{ label: 'Read Note', onClick: onReadNote }} />
      : <StatePanel icon={FileText} title="This Session has no Note yet" description="You can still write and save this draft." />}
  </>
}
