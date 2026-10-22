import { ActionButton } from '../components/ActionButton'
import type { ReactNode, Ref } from 'react'
import { copyMatchesSnapshot, type ClipboardSnapshot, type CopyState } from '../app/copyActions'
import { CheckCircle2, Copy, Image as ImageIcon, Loader2, PencilLine, Save, Trash2, X } from 'lucide-react'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import { richEditorDocumentFromHtml, richEditorDocumentFromStoredBody, richEditorDocumentToStoredBody, type StoredRichBody } from '../editor/editorDocument'
import type { GenerationJobStatus } from '../tauri'
import { TestwareGenerationPreview } from '../content/TestwareGenerationPreview'

export function GenerationRecord({
  title,
  titleAriaLabel,
  job,
  placeholder,
  bodyAriaLabel,
  onCancelGenerationJob,
}: {
  title: string
  titleAriaLabel: string
  job: GenerationJobStatus
  placeholder: string
  bodyAriaLabel: string
  onCancelGenerationJob: (jobId: string) => Promise<void>
}) {
  return (
    <article className="editable-record generation-record">
      <input readOnly value={title} aria-label={titleAriaLabel} />
      <div className="rich-record-editor-field rich-record-preview-field">
        {job.action === 'testware' ? <TestwareGenerationPreview
          key={`${job.sessionId}:${job.jobId}`}
          text={job.partialText || ''}
          fallback={job.progressMessage || placeholder}
          ariaLabel={bodyAriaLabel}
          running={job.state === 'running'}
        /> : <RichTextEditor
          value={richEditorDocumentFromHtml(job.partialText || job.progressMessage || placeholder)}
          ariaLabel={bodyAriaLabel}
          placeholder={placeholder}
          readOnly
        />}
      </div>
      <div className="record-actions">
        <span className="generation-progress">
          <Loader2 className="spin" size={16} />
          {job.progressMessage}
        </span>
        <button className="secondary-button" type="button" disabled={job.state === 'cancelling'} onClick={() => void onCancelGenerationJob(job.jobId)}>
          {job.state === 'cancelling' ? <Loader2 className="spin" size={16} /> : <X size={16} />}
          Cancel
        </button>
      </div>
    </article>
  )
}

export function EditableRichRecord({
  record,
  editing,
  editorId,
  titleInputLabel,
  titleInputRef,
  bodyAriaLabel,
  placeholder,
  previewFallbackHtml,
  editFields,
  meta,
  previewHeader,
  actions,
  onTitleChange,
  onBodyChange,
  onUploadImage,
}: {
  record: StoredRichBody & { title: string }
  editing: boolean
  editorId: string
  titleInputLabel: string
  titleInputRef?: Ref<HTMLInputElement>
  bodyAriaLabel: string
  placeholder: string
  previewFallbackHtml: string
  editFields?: ReactNode
  meta?: ReactNode
  previewHeader: ReactNode
  actions: ReactNode
  onTitleChange: (title: string) => void
  onBodyChange: (patch: StoredRichBody) => void
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  const document = richEditorDocumentFromStoredBody(record)

  return (
    <article className="editable-record">
      {meta}
      <div className="record-actions">{actions}</div>
      {editing ? (
        <>
          <input ref={titleInputRef} value={record.title} aria-label={titleInputLabel} onChange={(event) => onTitleChange(event.target.value)} />
          {editFields}
          <div className="rich-record-editor-field">
            <FormatToolbar editorId={editorId} onUploadImage={onUploadImage} />
            <RichTextEditor editorId={editorId} value={document} onChange={(body) => onBodyChange(richEditorDocumentToStoredBody(body))} ariaLabel={bodyAriaLabel} placeholder={placeholder} />
          </div>
        </>
      ) : (
        <>
          {previewHeader}
          <div className="rich-record-editor-field rich-record-preview-field">
            <RichTextEditor value={record.body ? document : richEditorDocumentFromHtml(previewFallbackHtml)} ariaLabel={bodyAriaLabel} readOnly />
          </div>
        </>
      )}
    </article>
  )
}

export function CopyControls({ snapshot, copyState, onCopy, disabled = false, label, screenshotCount = 0 }: {
  snapshot: ClipboardSnapshot
  copyState: CopyState
  onCopy: (snapshot: ClipboardSnapshot) => Promise<void>
  disabled?: boolean
  label: string
  screenshotCount?: number
}) {
  const identity = snapshot.target.kind === 'note' ? `note ${snapshot.title}` : label
  const screenshot: ClipboardSnapshot = { ...snapshot, target: { ...snapshot.target, action: 'screenshot' } }
  const textMatches = copyMatchesSnapshot(copyState, snapshot)
  const screenshotMatches = copyMatchesSnapshot(copyState, screenshot)
  const copied = textMatches && copyState.status === 'succeeded'
  const screenshotCopied = screenshotMatches && copyState.status === 'succeeded'
  const copying = textMatches && copyState.status === 'pending'
  const copyingScreenshot = screenshotMatches && copyState.status === 'pending'
  const copyDisabled = disabled || copyState.status === 'pending'
  const failure = copyState.status === 'failed' && (textMatches || screenshotMatches) ? copyState : null
  return <>
    <button className={copied ? 'secondary-button compact-button success' : 'secondary-button compact-button'}
      type="button" aria-label={copied ? `${identity} copied` : `Copy ${identity}`}
      disabled={copyDisabled} onClick={() => void onCopy(snapshot)}>
      {copying ? <Loader2 className="spin" size={16} /> : copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
      {copied ? 'Copied' : copying ? 'Copying' : 'Copy'}
    </button>
    {screenshotCount > 0 ? <button className={screenshotCopied ? 'secondary-button compact-button success' : 'secondary-button compact-button'}
      type="button" aria-label={screenshotCopied ? `${identity} screenshot copied` : `Copy first ${identity} screenshot`}
      disabled={copyDisabled} onClick={() => void onCopy(screenshot)}>
      {copyingScreenshot ? <Loader2 className="spin" size={16} /> : screenshotCopied ? <CheckCircle2 size={16} /> : <ImageIcon size={16} />}
      {screenshotCopied ? 'Screenshot copied' : copyingScreenshot ? 'Copying first screenshot…' : 'Copy first screenshot'}
    </button> : null}
    {textMatches || screenshotMatches ? <span className="sr-only" role="status">
      {copyState.status === 'pending' ? 'Copy in progress' : copyState.status === 'succeeded' ? (textMatches ? 'Copied' : 'First screenshot copied') : ''}
    </span> : null}
    {failure ? <span className="copy-error" role="alert">{failure.snapshot.target.action === 'screenshot' ? 'Copy first screenshot failed' : 'Copy failed'}: {failure.error}</span> : null}
  </>
}

export function RichRecordActions({
  copyControls, deleting, deleteLabel, deleteTitle, editing, isBusy, saving,
  onDelete, onEdit, onSave, onCancelEdit,
}: {
  copyControls: ReactNode
  deleting: boolean
  deleteLabel: string
  deleteTitle: string
  editing: boolean
  isBusy: boolean
  saving: boolean
  onDelete: () => void
  onEdit: () => void
  onSave: () => void
  onCancelEdit: () => void
}) {
  return <>
    {copyControls}
    <ActionButton variant={editing ? 'primary' : 'secondary'} icon={editing ? Save : PencilLine} loading={saving} disabled={isBusy} onClick={editing ? onSave : onEdit}>
      {editing ? 'Save' : 'Edit'}
    </ActionButton>
    {editing ? <ActionButton variant="destructive-quiet" icon={X} disabled={isBusy} onClick={onCancelEdit}>Discard</ActionButton>
      : <ActionButton variant="destructive-quiet" iconOnly icon={Trash2} aria-label={deleteLabel} title={deleteTitle} loading={deleting} disabled={isBusy} onClick={onDelete} />}
  </>
}
