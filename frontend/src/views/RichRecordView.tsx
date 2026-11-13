import { ActionButton } from '../components/ActionButton'
import { CopyButton } from '../components/CopyButton'
import { useMemo, type ReactNode, type Ref } from 'react'
import { copyMatchesSnapshot, type ClipboardSnapshot, type CopyState } from '../app/copyActions'
import { Copy, Image as ImageIcon, Loader2, PencilLine, Save, Trash2, X } from 'lucide-react'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import { richEditorDocumentFromHtml, richEditorDocumentFromStoredBody, richEditorDocumentToStoredBody, withoutRepeatedTitleHeading, type StoredRichBody } from '../editor/editorDocument'
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
        <ActionButton variant="secondary" type="button" disabled={job.state === 'cancelling'} onClick={() => void onCancelGenerationJob(job.jobId)}>
          {job.state === 'cancelling' ? <Loader2 className="spin" size={16} /> : <X size={16} />}
          Cancel
        </ActionButton>
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
  copyControls,
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
  /** The Copy icons, in the top-right corner beside the title. */
  copyControls?: ReactNode
  actions: ReactNode
  onTitleChange: (title: string) => void
  onBodyChange: (patch: StoredRichBody) => void
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  const { body, bodyJson } = record
  const document = useMemo(() => richEditorDocumentFromStoredBody({ body, bodyJson }), [body, bodyJson])
  const previewDocument = useMemo(() => withoutRepeatedTitleHeading(document, record.title), [document, record.title])

  return (
    <article className="editable-record">
      <header className="record-header">
        <div className="record-title-row">
          {editing ? <input ref={titleInputRef} value={record.title} aria-label={titleInputLabel} onChange={(event) => onTitleChange(event.target.value)} /> : previewHeader}
          {copyControls}
        </div>
        {meta}
        <div className="record-actions">{actions}</div>
      </header>
      {editing ? editFields : null}
      <div className={`rich-record-editor-field${editing ? '' : ' rich-record-preview-field'}`}>
        {editing ? <FormatToolbar editorId={editorId} onUploadImage={onUploadImage} /> : null}
        <RichTextEditor
          editorId={editing ? editorId : undefined}
          historyScope={`${editorId}:${editing ? 'editing' : 'preview'}`}
          value={editing ? document : record.body ? previewDocument : richEditorDocumentFromHtml(previewFallbackHtml)}
          onChange={editing ? (body) => onBodyChange(richEditorDocumentToStoredBody(body)) : undefined}
          ariaLabel={bodyAriaLabel}
          placeholder={editing ? placeholder : undefined}
          readOnly={!editing}
        />
      </div>
    </article>
  )
}

export function CopyControls({ snapshot, copyState, onCopy, disabled = false, label, screenshotCount = 0, size = 'regular' }: {
  snapshot: ClipboardSnapshot
  copyState: CopyState
  onCopy: (snapshot: ClipboardSnapshot) => Promise<void>
  disabled?: boolean
  label: string
  screenshotCount?: number
  /** `compact` belongs to the Session header row only (R1). */
  size?: 'regular' | 'compact'
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
    <span className="copy-controls">
      {screenshotCount > 0 ? <CopyButton icon={ImageIcon} size={size} disabled={copyDisabled} onCopy={() => void onCopy(screenshot)}
        label={`Copy first ${identity} screenshot`} copiedLabel={`${identity} screenshot copied`}
        tooltip="Copy first screenshot" pendingTooltip="Copying first screenshot" copiedTooltip="Screenshot copied"
        pending={copyingScreenshot} copied={screenshotCopied} /> : null}
      <CopyButton icon={Copy} size={size} disabled={copyDisabled} onCopy={() => void onCopy(snapshot)}
        label={`Copy ${identity}`} copiedLabel={`${identity} copied`}
        tooltip="Copy" pendingTooltip="Copying" pending={copying} copied={copied} />
    </span>
    {textMatches || screenshotMatches ? <span className="sr-only" role="status">
      {copyState.status === 'pending' ? 'Copy in progress' : copyState.status === 'succeeded' ? (textMatches ? 'Copied' : 'First screenshot copied') : ''}
    </span> : null}
    {failure ? <span className="copy-error" role="alert">{failure.snapshot.target.action === 'screenshot' ? 'Copy first screenshot failed' : 'Copy failed'}: {failure.error}</span> : null}
  </>
}

export function RichRecordActions({
  leadingActions, deleting, deleteLabel, deleteTitle, editing, isBusy, saving,
  onDelete, onEdit, onSave, onCancelEdit,
}: {
  /** Actions before Edit, such as Ask AI. */
  leadingActions?: ReactNode
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
    {leadingActions}
    <ActionButton variant={editing ? 'primary' : 'secondary'} icon={editing ? Save : PencilLine} loading={saving} disabled={isBusy} onClick={editing ? onSave : onEdit}>
      {editing ? 'Save' : 'Edit'}
    </ActionButton>
    {editing ? <ActionButton variant="destructive-quiet" icon={X} disabled={isBusy} onClick={onCancelEdit}>Discard</ActionButton>
      : <ActionButton variant="destructive-quiet" iconOnly icon={Trash2} aria-label={deleteLabel} tooltip={deleteTitle} loading={deleting} disabled={isBusy} onClick={onDelete} />}
  </>
}
