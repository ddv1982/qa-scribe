import { useMemo } from 'react'
import { FileText, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { StatePanel } from '../components/Common'
import { RichTextEditor } from '../editor/RichTextEditor'
import { richEditorDocumentFromHtml, richEditorDocumentFromStoredBody, withoutRepeatedTitleHeading } from '../editor/editorDocument'
import { htmlHasContent } from '../editor/editorHtml'
import { creationNotePanelId } from '../hooks/useCreationNoteVisible'
import type { CreationIntent } from '../app/creationIntent'
import type { CreationKind } from '../tauri'
import { kindLabels, noteReference, referencedRecord, referenceLabel, referenceValue, type CreationReference, type ReferenceRecord, type ReferenceRecords } from '../app/creationReference'

export function ShowNoteButton({ label, onShow }: { label: string; onShow: () => void }) {
  const tooltip = `Show ${label}`
  return <ActionButton variant="quiet" iconOnly icon={PanelRightOpen} className="creation-note-toggle" aria-label={tooltip}
    tooltip={tooltip} tooltipAlign="end" aria-expanded={false} aria-controls={creationNotePanelId} onClick={onShow} />
}

/**
 * Read-only on the right of a new draft: the Session's Note, the source Generate uses, or a saved test case or
 * Finding of this Session to write from. Records of the draft's own kind are listed first.
 */
export function CreationNotePanel({ intent, records, reference, onReferenceChange, noteReadOnly, onReadNote, onClose }: {
  intent: CreationIntent
  records: ReferenceRecords
  reference: CreationReference
  onReferenceChange: (reference: CreationReference) => void
  noteReadOnly: boolean
  onReadNote: () => void
  onClose: () => void
}) {
  // A record deleted while it is shown leaves the Note in its place.
  const record = referencedRecord(reference, records)
  const shown = record ? reference : noteReference
  const label = referenceLabel(shown, records)
  const kinds: CreationKind[] = intent.kind === 'finding' ? ['finding', 'testware'] : ['testware', 'finding']
  return <aside id={creationNotePanelId} className="side-panel" aria-label={record?.title ?? 'Note'}>
    <header className="side-panel-header">
      <select className="creation-reference-select" aria-label="Show beside the draft" value={referenceValue(shown)} onChange={event => {
        const [kind, id] = event.target.value.split(/:(.*)/s)
        onReferenceChange(kind === 'testware' || kind === 'finding' ? { kind, id } : noteReference)
      }}>
        <option value="note">Note</option>
        {kinds.filter(kind => records[kind].length > 0).map(kind => <optgroup key={kind} label={kindLabels[kind].group}>
          {records[kind].map(item => <option key={item.id} value={referenceValue({ kind, id: item.id })}>{item.title.trim() || 'Untitled'}</option>)}
        </optgroup>)}
      </select>
      <ActionButton variant="quiet" iconOnly icon={PanelRightClose} aria-label={`Close ${label}`} tooltip={`Close ${label}`} tooltipAlign="end" onClick={onClose} />
    </header>
    <div className="creation-note-body">
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
