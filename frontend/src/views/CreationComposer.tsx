import { findingCopyBody } from '../findings/copyBody'
import { useEffect, useRef, type ReactNode, type ClipboardEvent } from 'react'
import { Save, X } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { FormatToolbar, RichTextEditor } from '../editor/RichTextEditor'
import { managedAttachmentProtocol } from '../editor/editorHtml'
import { richEditorDocumentToHtml } from '../editor/editorDocument'
import { richEditorImageInserterForElement } from '../editor/richEditorRegistry'
import { imageFileFromClipboardData, shouldReadNativeClipboardImage } from '../app/attachmentActions'
import type { CreationActions } from '../app/creationActions'
import type { CreationIntent } from '../app/creationIntent'
import type { ClipboardSnapshot, CopyState } from '../app/copyActions'
import { CopyControls } from './RichRecordView'

export function CreationComposer({ intent, actions, copyState, onCopy, fields, source }: {
  intent: CreationIntent
  actions: CreationActions
  copyState: CopyState
  onCopy: (snapshot: ClipboardSnapshot) => Promise<void>
  fields?: ReactNode
  source?: ReactNode
}) {
  const titleRef = useRef<HTMLInputElement>(null)
  useEffect(() => { titleRef.current?.focus() }, [intent.id])
  const editorId = `creation-${intent.id}`
  const locked = intent.phase.state !== 'editing'
  const imageOperations = Object.values(intent.imageOperations)
  const readingImages = imageOperations.some(operation => operation.state === 'reading')
  const failedImages = imageOperations.filter(operation => operation.state === 'failed')
  const body = richEditorDocumentToHtml(intent.document)
  const html = intent.kind === 'finding' ? findingCopyBody(body, intent.metadataJson) : body
  const screenshotCount = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img').length
  function paste(event: ClipboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const editor = target.closest<HTMLElement>('.rich-editor')
    const insertImage = editor && richEditorImageInserterForElement(editor)
    if (!insertImage || locked) return
    const html = event.clipboardData.getData('text/html')
    const htmlImages = html ? Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img')) : []
    if (htmlImages.some(image => image.getAttribute('data-attachment-id') || image.getAttribute('src')?.startsWith(managedAttachmentProtocol))) return
    const file = imageFileFromClipboardData(event.clipboardData)
    if (file) {
      event.preventDefault()
      event.stopPropagation()
      void actions.stageImage({ editorId, file, insertImage })
    } else if (htmlImages.some(image => /^(data:image\/|https?:\/\/)/i.test(image.getAttribute('src') ?? ''))) {
      return
    } else if (shouldReadNativeClipboardImage(event.clipboardData)) {
      event.preventDefault()
      event.stopPropagation()
      void actions.pasteImage({ editorId, insertImage })
    }
  }
  return <article className="editable-record creation-composer" aria-label={intent.kind === 'finding' ? 'New finding' : 'New test cases'} onPasteCapture={paste}>
    <header className="record-heading-row"><h2>New {intent.kind === 'finding' ? 'finding' : 'test cases'}</h2><span>{intent.phase.state === 'saved' ? 'Saved result, opening for review' : intent.phase.state === 'committed-deleted' ? 'Saved result was deleted' : 'Draft, not saved yet'}</span></header>
    <div className="record-actions">
      <CopyControls snapshot={{ target: { kind: intent.kind === 'finding' ? 'finding' : 'draft', sessionId: intent.sessionId, id: intent.id, action: 'jira-text' }, title: intent.title, bodyHtml: html }} label={intent.title || 'draft'} copyState={copyState} onCopy={onCopy} screenshotCount={screenshotCount} />
      <ActionButton variant="quiet" icon={X} disabled={intent.phase.state === 'saving' || intent.phase.state === 'discarding'} onClick={() => void actions.settle()}>Cancel</ActionButton>
      <ActionButton variant="primary" icon={Save} loading={intent.phase.state === 'saving'} disabled={!intent.title.trim() || readingImages || failedImages.length > 0 || !['editing', 'uncertain', 'saved'].includes(intent.phase.state)} onClick={() => void actions.save()}>{intent.phase.state === 'uncertain' ? 'Retry Save' : intent.phase.state === 'saved' ? 'Open saved result' : `Save ${intent.kind === 'finding' ? 'finding' : 'test cases'}`}</ActionButton>
    </div>
    <label className="field-stack"><span>Title</span><input ref={titleRef} aria-label={intent.kind === 'finding' ? 'Finding title' : 'Test case title'} value={intent.title} readOnly={locked} onChange={(event) => actions.update({ title: event.target.value })} placeholder="Give this draft a title" /></label>
    <fieldset disabled={locked} className="creation-fields">{fields}</fieldset>
    <div className="rich-record-editor-field">
      <FormatToolbar editorId={editorId} onUploadImage={actions.stageImage} />
      <RichTextEditor editorId={editorId} value={intent.document} onChange={(document) => actions.update({ document })} ariaLabel="Creation draft body" readOnly={locked} placeholder="Add what you observed. Empty sections are optional." />
    </div>
    {readingImages ? <p role="status">Adding image…</p> : null}
    {failedImages.length ? <div role="alert">{failedImages.map((operation, index) => <p key={index}>{operation.state === 'failed' ? operation.message : ''}</p>)}
      <ActionButton variant="quiet" disabled={locked} onClick={actions.dismissImageFailures}>Continue without failed images</ActionButton>
    </div> : null}
    {source}
  </article>
}
