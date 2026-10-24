import { useEffect, useId, useState } from 'react'
import { X } from 'lucide-react'
import { getAttachmentPreviewDataUrl } from '../tauri'
import { ActionButton } from '../components/ActionButton'
import { useModalDialog } from '../hooks/useModalDialog'
import type { ChatImageFailure } from '../app/sessionChat.types'
import '../styles/chat-images.css'

type ImageReference = { attachmentId: string; filename: string }

export function ChatImageFailures({ failures, images, disabled, onRetry, onRemove, onRemoveImage }: {
  failures: readonly ChatImageFailure[]
  images: readonly ImageReference[]
  disabled: boolean
  onRetry?: (id: string) => Promise<void>
  onRemove?: (id: string) => Promise<void>
  onRemoveImage?: (id: string) => void
}) {
  if (!failures.length) return null
  return <ul className="chat-image-failures" aria-label="Failed images">
    {failures.map(failure => <li key={failure.id}>
      <p>{failure.filename}: {failure.message}</p>
      {failure.recovery?.kind === 'refresh_pending' ? <p>Reloading the conversation is required to check whether this image was saved. Retry or Remove failed will check again.</p> : null}
      {failure.recovery?.kind === 'verification_pending' ? <>
        <p>These attachments could belong to this failed import or another client. Retry verification, or remove each unverified attachment below and then choose Remove failed. Sending stays blocked until this is resolved.</p>
        <ul aria-label={`Unverified attachments for ${failure.filename}`}>
          {failure.recovery.images.map(image => <li key={image.attachmentId}>
            <ActionButton variant="secondary" size="compact" disabled={disabled || !images.some(value => value.attachmentId === image.attachmentId)}
              onClick={() => onRemoveImage?.(image.attachmentId)}>Remove unverified {image.filename}</ActionButton>
            {!images.some(value => value.attachmentId === image.attachmentId) ? <span> Removed from message</span> : null}
          </li>)}
        </ul>
      </> : null}
      <ActionButton variant="secondary" size="compact" disabled={disabled} onClick={() => void onRetry?.(failure.id)}>Retry {failure.filename}</ActionButton>
      <ActionButton variant="quiet" size="compact" disabled={disabled} onClick={() => void onRemove?.(failure.id)}>Remove failed {failure.filename}</ActionButton>
    </li>)}
  </ul>
}

export function ChatImages({ images, disabled, onRemove, unverifiedIds = [] }: {
  images: readonly ImageReference[]
  disabled?: boolean
  onRemove?: (attachmentId: string) => void
  unverifiedIds?: readonly string[]
}) {
  if (!images.length) return null
  return <ul className="chat-images" aria-label={onRemove ? 'Attached images' : 'Message images'}>
    {images.map(image => <ChatImage key={image.attachmentId} image={image} disabled={disabled} onRemove={onRemove}
      unverified={unverifiedIds.includes(image.attachmentId)} />)}
  </ul>
}

function ChatImage({ image, disabled, onRemove, unverified }: {
  image: ImageReference
  disabled?: boolean
  onRemove?: (attachmentId: string) => void
  unverified?: boolean
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let current = true
    void getAttachmentPreviewDataUrl(image.attachmentId).then(url => {
      if (current) { setPreview(url); setLoaded(true) }
    }).catch(() => { if (current) setLoaded(true) })
    return () => { current = false }
  }, [image.attachmentId, attempt])
  return <li className="chat-image" data-attachment-id={image.attachmentId}>
    {preview ? <button className="chat-image-preview" type="button" aria-label={`Preview ${image.filename}`} onClick={() => setExpanded(true)}>
      <img src={preview} alt={image.filename} />
    </button> : <div className="chat-image-placeholder">
      <span>{loaded ? 'Preview unavailable' : 'Loading image…'}</span>
      {loaded ? <ActionButton variant="quiet" size="compact" onClick={() => setAttempt(value => value + 1)}>Retry preview</ActionButton> : null}
    </div>}
    <span className="chat-image-name" title={image.filename}>{image.filename}</span>
    {onRemove ? <span className="chat-image-status">{unverified ? 'Verification pending' : 'Ready to send'}</span> : null}
    {onRemove ? <ActionButton className="chat-image-remove" variant="secondary" size="compact" iconOnly icon={X}
      aria-label={`Remove ${image.filename}`} disabled={disabled} onClick={() => onRemove(image.attachmentId)} /> : null}
    {expanded && preview ? <ImageDialog filename={image.filename} preview={preview} onClose={() => setExpanded(false)} /> : null}
  </li>
}

function ImageDialog({ filename, preview, onClose }: { filename: string; preview: string; onClose: () => void }) {
  const ref = useModalDialog(onClose)
  const id = useId()
  return <dialog ref={ref} className="chat-image-dialog" aria-labelledby={id}>
    <header><h2 id={id}>{filename}</h2><ActionButton iconOnly icon={X} aria-label="Close image preview" onClick={onClose} /></header>
    <img src={preview} alt={filename} />
  </dialog>
}
