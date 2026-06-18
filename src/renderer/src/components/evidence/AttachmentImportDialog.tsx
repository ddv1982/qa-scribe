import type { ReactElement } from 'react'
import { ClipboardPaste, FolderOpen, X } from 'lucide-react'

export type AttachmentImportSource = 'browse' | 'paste'

export function AttachmentImportDialog(props: {
  busy: boolean
  targetLabel: string
  onClose: () => void
  onImport: (source: AttachmentImportSource) => void
}): ReactElement {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!props.busy) props.onClose()
      }}
    >
      <section
        aria-labelledby="attachment-import-title"
        aria-modal="true"
        className="attachment-import-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">Evidence</span>
            <h2 id="attachment-import-title">Attach Evidence</h2>
            <p className="modal-context">{props.targetLabel}</p>
          </div>
          <button
            aria-label="Close evidence import"
            className="icon-command"
            disabled={props.busy}
            type="button"
            onClick={props.onClose}
          >
            <X size={16} />
          </button>
        </div>
        <div className="attachment-import-actions">
          <button
            className="secondary-command attachment-import-action"
            disabled={props.busy}
            type="button"
            onClick={() => props.onImport('browse')}
          >
            <FolderOpen size={18} />
            <span>
              <strong>Browse</strong>
              <small>Select a file from disk</small>
            </span>
          </button>
          <button
            className="secondary-command attachment-import-action"
            disabled={props.busy}
            type="button"
            onClick={() => props.onImport('paste')}
          >
            <ClipboardPaste size={18} />
            <span>
              <strong>Paste Screenshot/Image</strong>
              <small>Import the current clipboard image</small>
            </span>
          </button>
        </div>
        <div className="modal-footer">
          <button className="secondary-command fit" disabled={props.busy} type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  )
}
