import { useEffect, useState, type ReactElement } from 'react'
import type { Attachment } from '../../../../shared/contracts'
import type { ContextAttachment } from '../../domain/types'

export function AttachmentList({ attachments }: { attachments: Attachment[] }): ReactElement {
  if (attachments.length === 0) return <p className="muted">No evidence attached.</p>
  return (
    <ul className="attachment-list">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <AttachmentPreview attachment={attachment} />
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
          <AttachmentPreview attachment={item.attachment} compact />
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

export function AttachmentPreviewGrid(props: { attachments: Attachment[]; compact?: boolean }): ReactElement | null {
  const imageAttachments = props.attachments.filter(isImageAttachment)
  if (imageAttachments.length === 0) return null

  return (
    <div className={props.compact ? 'attachment-preview-grid compact' : 'attachment-preview-grid'}>
      {imageAttachments.map((attachment) => (
        <AttachmentPreview attachment={attachment} compact={props.compact} key={attachment.id} />
      ))}
    </div>
  )
}

export function AttachmentPreview(props: { attachment: Attachment; compact?: boolean }): ReactElement | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDataUrl(null)

    if (!isImageAttachment(props.attachment)) return

    void window.qaScribe
      .getAttachmentPreviewDataUrl(props.attachment.id)
      .then((nextDataUrl) => {
        if (!cancelled) setDataUrl(nextDataUrl)
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [props.attachment])

  if (!isImageAttachment(props.attachment) || !dataUrl) return null

  return (
    <img
      alt={`Screenshot preview: ${props.attachment.filename}`}
      className={props.compact ? 'attachment-preview compact' : 'attachment-preview'}
      src={dataUrl}
    />
  )
}

function isImageAttachment(attachment: Attachment): boolean {
  return attachment.mimeType?.startsWith('image/') ?? false
}
