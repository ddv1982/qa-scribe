import { findingCopyBody } from '../findings/copyBody'
import { useEffect, useRef, useState, type ReactNode, type ClipboardEvent } from 'react'
import { Save, X } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { Dialog } from '../components/Dialog'
import { Field } from '../components/Field'
import { FormatToolbar, RichTextEditor } from '../editor/RichTextEditor'
import { managedAttachmentProtocol } from '../editor/editorHtml'
import { richEditorDocumentToHtml } from '../editor/editorDocument'
import { richEditorImageInserterForElement } from '../editor/richEditorRegistry'
import { imageFileFromClipboardData, shouldReadNativeClipboardImage } from '../app/attachmentActions'
import type { CreationActions } from '../app/creationActions'
import type { CreationIntent } from '../app/creationIntent'
import type { ClipboardSnapshot, CopyState } from '../app/copyActions'
import { CopyControls } from './RichRecordView'
import { creationFormatForId, creationFormatHint, creationFormatId, creationFormatOptions, type CreationFormat } from '../app/creationFormats'

/** Generate mode: the setup form in place of the draft fields, and its primary action after Cancel. */
export type CreationGenerateMode = { form: ReactNode; confirm: ReactNode }

export function CreationComposer({ intent, actions, copyState, onCopy, fields, modeSwitch, generate, headerAction }: {
  intent: CreationIntent
  actions: CreationActions
  copyState: CopyState
  onCopy: (snapshot: ClipboardSnapshot) => Promise<void>
  fields?: ReactNode
  /** Write | Generate, first in the row under the heading; absent when no AI provider is available. */
  modeSwitch?: ReactNode
  /** Present in Generate mode. The Write fields stay mounted but hidden, so switching back keeps them as they were. */
  generate?: CreationGenerateMode | null
  /** A quiet icon after Copy, such as Show Note. */
  headerAction?: ReactNode
}) {
  const titleRef = useRef<HTMLInputElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const generating = Boolean(generate)
  useEffect(() => {
    if (generating) firstGenerateControl(articleRef.current)?.focus()
    else titleRef.current?.focus()
  }, [intent.id, generating])
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
    // The Write fields are hidden in Generate mode, so a paste there never reaches them.
    if (!insertImage || locked || generating) return
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
  // A committed result that could not be opened yet: Open saved result retries, in either mode and with any title.
  const savedResult = intent.phase.state === 'saved'
  const status = intent.phase.state === 'saved' ? 'Saved result, opening for review' : intent.phase.state === 'committed-deleted' ? 'Saved result was deleted' : generate ? null : 'Draft, not saved yet'
  return <article ref={articleRef} className="editable-record creation-composer" aria-label={intent.kind === 'finding' ? 'New finding' : 'New test cases'} onPasteCapture={paste}>
    <header className="record-title-row">
      <div className="record-heading-row"><h2 className="record-title">New {intent.kind === 'finding' ? 'finding' : 'test cases'}</h2>{status ? <span>{status}</span> : null}</div>
      {generate ? null : <CopyControls snapshot={{ target: { kind: intent.kind === 'finding' ? 'finding' : 'draft', sessionId: intent.sessionId, id: intent.id, action: 'jira-text' }, title: intent.title, bodyHtml: html }} label={intent.title || 'draft'} copyState={copyState} onCopy={onCopy} screenshotCount={screenshotCount} />}
      {headerAction}
    </header>
    <div className="record-actions">
      {modeSwitch}
      <ActionButton variant="quiet" icon={X} disabled={intent.phase.state === 'saving' || intent.phase.state === 'discarding'} onClick={() => void actions.settle()}>Cancel</ActionButton>
      {generate && !savedResult ? generate.confirm : <ActionButton variant="primary" icon={Save} loading={intent.phase.state === 'saving'} disabled={!savedResult && (!intent.title.trim() || readingImages || failedImages.length > 0 || !['editing', 'uncertain'].includes(intent.phase.state))} onClick={() => void actions.save()}>{intent.phase.state === 'uncertain' ? 'Retry Save' : intent.phase.state === 'saved' ? 'Open saved result' : `Save ${intent.kind === 'finding' ? 'finding' : 'test cases'}`}</ActionButton>}
    </div>
    {generate ? <div className="creation-generate">{generate.form}</div> : null}
    <div className="creation-write" hidden={generating}>
      <Field label="Title"><input ref={titleRef} aria-label={intent.kind === 'finding' ? 'Finding title' : 'Test case title'} value={intent.title} readOnly={locked} onChange={(event) => actions.update({ title: event.target.value })} placeholder="Give this draft a title" /></Field>
      <CreationFormatSelector key={`format-${intent.id}`} intent={intent} actions={actions} />
      {fields ? <fieldset disabled={locked} className="creation-fields">{fields}</fieldset> : null}
      <div className="rich-record-editor-field">
        <FormatToolbar editorId={editorId} onUploadImage={actions.stageImage} />
        <RichTextEditor editorId={editorId} value={intent.document} onChange={(document) => actions.update({ document })} ariaLabel="Creation draft body" readOnly={locked} placeholder="Add what you observed. Empty sections are optional." />
      </div>
      {readingImages ? <p role="status">Adding image…</p> : null}
      {failedImages.length ? <div role="alert">{failedImages.map((operation, index) => <p key={index}>{operation.state === 'failed' ? operation.message : ''}</p>)}
        <ActionButton variant="quiet" disabled={locked} onClick={actions.dismissImageFailures}>Continue without failed images</ActionButton>
      </div> : null}
    </div>
  </article>
}

/** Generate's first choice (the Output select for test cases); with no choices to make, its primary action; while that is
    still disabled (the Note not shown yet), the pressed Generate option of the switch, so focus never falls to the page. */
function firstGenerateControl(composer: HTMLElement | null): HTMLElement | null {
  const choice = Array.from(composer?.querySelectorAll<HTMLElement>('.creation-generate :is(select, input, textarea, button):not(:disabled)') ?? [])
    .find((control) => !control.closest('details:not([open])'))
  return choice ?? composer?.querySelector<HTMLElement>('.record-actions > .action-button--primary:not(:disabled)')
    ?? composer?.querySelector<HTMLElement>('.record-actions [aria-pressed="true"]') ?? null
}

export function CreationFormatSelector({ intent, actions }: { intent: CreationIntent; actions: CreationActions }) {
  const [pending, setPending] = useState<CreationFormat | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const locked = intent.phase.state !== 'editing' || Object.keys(intent.imageOperations).length > 0
  function close() {
    setPending(null)
    requestAnimationFrame(() => selectRef.current?.focus())
  }
  return <>
    <Field label={intent.kind === 'testware' ? 'Output format' : 'Template'} hint={creationFormatHint(intent.format)} className="creation-format">
      <select ref={selectRef} aria-label={intent.kind === 'testware' ? 'Test case output format' : 'Finding template'} disabled={locked}
        value={creationFormatId(intent.format)} onChange={event => {
          const format = creationFormatForId(intent.kind, event.target.value)
          if (format && !actions.applyFormat(format)) setPending(format)
        }}>
        {creationFormatOptions(intent.kind).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </Field>
    {pending ? <ReplaceFormatDialog onCancel={close} onApply={() => { actions.applyFormat(pending, true); close() }} /> : null}
  </>
}

function ReplaceFormatDialog({ onCancel, onApply }: { onCancel: () => void; onApply: () => void }) {
  return <Dialog portal titleId="replace-format-title" title="Replace the draft structure?" onCancel={onCancel}
    description={<p>Your current body contains changes. Applying another format replaces the body and its images. Your title and finding details stay as they are.</p>}
    actions={<><ActionButton onClick={onCancel}>Keep editing</ActionButton><ActionButton variant="primary" onClick={onApply}>Apply format</ActionButton></>} />
}
