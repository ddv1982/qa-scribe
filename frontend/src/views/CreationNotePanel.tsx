import { useMemo } from 'react'
import { FileText, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { StatePanel } from '../components/Common'
import { RichTextEditor } from '../editor/RichTextEditor'
import { richEditorDocumentFromHtml } from '../editor/editorDocument'
import { stripHtml } from '../editor/editorHtml'
import { creationNotePanelId, showNoteLabel } from '../hooks/useCreationNoteVisible'
import type { CreationIntent } from '../app/creationIntent'

export function ShowNoteButton({ onShow }: { onShow: () => void }) {
  return <ActionButton variant="quiet" iconOnly icon={PanelRightOpen} className="creation-note-toggle" aria-label={showNoteLabel}
    tooltip={showNoteLabel} tooltipAlign="end" aria-expanded={false} aria-controls={creationNotePanelId} onClick={onShow} />
}

/** The Session's Note, read-only on the right of a new draft: the source "Generate with AI" uses. */
export function CreationNotePanel({ intent, noteReadOnly, onReadNote, onClose }: {
  intent: CreationIntent
  noteReadOnly: boolean
  onReadNote: () => void
  onClose: () => void
}) {
  const body = intent.source?.entry.body
  const written = body !== undefined && (Boolean(stripHtml(body).trim()) || body.includes('<img'))
  const note = useMemo(() => body === undefined ? null : richEditorDocumentFromHtml(body), [body])
  return <aside id={creationNotePanelId} className="side-panel" aria-label="Note">
    <header className="side-panel-header">
      <h2>Note</h2>
      <ActionButton variant="quiet" iconOnly icon={PanelRightClose} aria-label="Close Note" tooltip="Close Note" tooltipAlign="end" onClick={onClose} />
    </header>
    <div className="creation-note-body">
      {noteReadOnly ? <p className="inline-message advisory" role="status">Recover the Session Note before generating from it. Ordinary writing remains available.</p> : null}
      {note && written ? <RichTextEditor value={note} readOnly ariaLabel="Note content" />
        : intent.sourceNoteId && !note ? <StatePanel icon={FileText} title="The Note is not shown yet" description="Read the latest saved Note to see it here."
          action={{ label: 'Read Note', onClick: onReadNote }} />
        : <StatePanel icon={FileText} title="This Session has no Note yet" description="You can still write and save this draft." />}
    </div>
  </aside>
}
