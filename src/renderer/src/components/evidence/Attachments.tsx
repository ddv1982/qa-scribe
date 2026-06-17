import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import type { Attachment } from '../../../../shared/contracts'
import type { ContextAttachment } from '../../domain/types'

export function AttachmentList({ attachments }: { attachments: Attachment[] }): ReactElement {
  if (attachments.length === 0) return <p className="muted">No evidence attached.</p>
  return <AttachmentSummaryList attachments={attachments} />
}

export function AttachmentSummaryList(props: { attachments: Attachment[]; compact?: boolean }): ReactElement | null {
  if (props.attachments.length === 0) return null
  return (
    <ul className="attachment-list" aria-label="Attached evidence">
      {props.attachments.map((attachment) => (
        <li key={attachment.id}>
          <AttachmentPreview attachment={attachment} compact={props.compact} />
          <span>{attachment.filename}</span>
          <small>{formatAttachmentMeta(attachment)}</small>
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
          <span>{formatAttachmentMeta(item.attachment)}</span>
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

export function AttachmentPreviewGrid(props: {
  attachments: Attachment[]
  compact?: boolean
  renderAction?: (attachment: Attachment) => ReactNode
}): ReactElement | null {
  if (props.attachments.length === 0) return null

  return (
    <div className={props.compact ? 'attachment-preview-grid compact' : 'attachment-preview-grid'}>
      {props.attachments.map((attachment) => (
        <div
          className={isImageAttachment(attachment) ? 'attachment-preview-item' : 'attachment-preview-item finding-row'}
          key={attachment.id}
        >
          {isImageAttachment(attachment) ? (
            <AttachmentPreview attachment={attachment} compact={props.compact} />
          ) : (
            <AttachmentFileRow attachment={attachment} />
          )}
          {props.renderAction ? <div className="attachment-preview-action">{props.renderAction(attachment)}</div> : null}
        </div>
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

function AttachmentFileRow({ attachment }: { attachment: Attachment }): ReactElement {
  return (
    <>
      <strong>{attachment.filename}</strong>
      <span>{formatAttachmentType(attachment)}</span>
      <small>{formatAttachmentSize(attachment.sizeBytes)}</small>
    </>
  )
}

function formatAttachmentMeta(attachment: Attachment): string {
  return `${formatAttachmentType(attachment)} / ${formatAttachmentSize(attachment.sizeBytes)}`
}

function formatAttachmentType(attachment: Attachment): string {
  if (attachment.mimeType) return attachment.mimeType
  const extension = attachment.filename.split('.').pop()
  return extension && extension !== attachment.filename ? `${extension.toUpperCase()} file` : 'File'
}

function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} KB`
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
}
