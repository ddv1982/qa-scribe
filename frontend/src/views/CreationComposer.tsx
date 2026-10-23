import { useEffect, useRef, type ReactNode, type ClipboardEvent } from 'react'
import { Save, X } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { FormatToolbar, RichTextEditor } from '../editor/RichTextEditor'
import { richEditorDocumentToHtml } from '../editor/editorDocument'
import { richEditorImageInserterForElement } from '../editor/richEditorRegistry'
import { readClipboardImageDataUrl } from '../tauri'
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
  const html = richEditorDocumentToHtml(intent.document)
  const screenshotCount = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img').length
  function paste(event: ClipboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const editor = target.closest<HTMLElement>('.rich-editor')
    const insertImage = editor && richEditorImageInserterForElement(editor)
    if (!insertImage || locked) return
    const file = imageFileFromClipboardData(event.clipboardData)
    if (file) {
      event.preventDefault()
      event.stopPropagation()
      void actions.stageImage({ editorId, file, insertImage })
    } else if (shouldReadNativeClipboardImage(event.clipboardData)) {
      event.preventDefault()
      event.stopPropagation()
      const id = intent.id
      void readClipboardImageDataUrl().then((data) => {
        if (data && actions.current()?.id === id && actions.current()?.phase.state === 'editing'
          && richEditorImageInserterForElement(editor) === insertImage) insertImage('', 'pasted-image.png', data)
      })
    }
  }
  return <article className="editable-record creation-composer" aria-label={intent.kind === 'finding' ? 'New finding' : 'New test cases'} onPasteCapture={paste}>
    <header className="record-heading-row"><h2>New {intent.kind === 'finding' ? 'finding' : 'test cases'}</h2><span>Draft, not saved yet</span></header>
    <div className="record-actions">
      <CopyControls snapshot={{ target: { kind: intent.kind === 'finding' ? 'finding' : 'draft', sessionId: intent.sessionId, id: intent.id, action: 'jira-text' }, title: intent.title, bodyHtml: html }} label={intent.title || 'draft'} copyState={copyState} onCopy={onCopy} screenshotCount={screenshotCount} />
      <ActionButton variant="quiet" icon={X} disabled={intent.phase.state === 'saving'} onClick={() => void actions.settle()}>Cancel</ActionButton>
      <ActionButton variant="primary" icon={Save} loading={intent.phase.state === 'saving'} disabled={!intent.title.trim() || intent.phase.state === 'committed-deleted'} onClick={() => void actions.save()}>{intent.phase.state === 'uncertain' ? 'Retry Save' : intent.phase.state === 'saved' ? 'Open saved result' : `Save ${intent.kind === 'finding' ? 'finding' : 'test cases'}`}</ActionButton>
    </div>
    <label className="field-stack"><span>Title</span><input ref={titleRef} aria-label={intent.kind === 'finding' ? 'Finding title' : 'Test case title'} value={intent.title} readOnly={locked} onChange={(event) => actions.update({ title: event.target.value })} placeholder="Give this draft a title" /></label>
    <fieldset disabled={locked} className="creation-fields">{fields}</fieldset>
    <div className="rich-record-editor-field">
      <FormatToolbar editorId={editorId} onUploadImage={actions.stageImage} />
      <RichTextEditor editorId={editorId} value={intent.document} onChange={(document) => actions.update({ document })} ariaLabel="Creation draft body" readOnly={locked} placeholder="Add what you observed. Empty sections are optional." />
    </div>
    {source}
  </article>
}
