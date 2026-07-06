import type { ReactNode } from 'react'
import { CheckCircle2, Copy, Image as ImageIcon, Loader2, PencilLine, Save, Trash2, X } from 'lucide-react'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import { richEditorDocumentFromHtml, richEditorDocumentFromStoredBody, richEditorDocumentToStoredBody, type StoredRichBody } from '../editor/editorDocument'
import type { GenerationJobStatus } from '../tauri'

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
        <RichTextEditor
          value={richEditorDocumentFromHtml(job.partialText || job.progressMessage || placeholder)}
          ariaLabel={bodyAriaLabel}
          placeholder={placeholder}
          readOnly
        />
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
      {editing ? (
        <>
          <input value={record.title} aria-label={titleInputLabel} onChange={(event) => onTitleChange(event.target.value)} />
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
      <div className="record-actions">{actions}</div>
    </article>
  )
}

export function RichRecordActions({
  copied,
  copying,
  copyLabel,
  copyTitle,
  deleting,
  deleteLabel,
  deleteTitle,
  editing,
  isBusy,
  saving,
  screenshot,
  onCopy,
  onDelete,
  onToggleEdit,
}: {
  copied: boolean
  copying: boolean
  copyLabel: string
  copyTitle: string
  deleting: boolean
  deleteLabel: string
  deleteTitle: string
  editing: boolean
  isBusy: boolean
  saving: boolean
  screenshot?: {
    copied: boolean
    copying: boolean
    count: number
    label: string
    title: string
    onCopy: () => void
  }
  onCopy: () => void
  onDelete: () => void
  onToggleEdit: () => void
}) {
  return (
    <>
      <button
        className={copied ? 'icon-button success' : 'icon-button'}
        type="button"
        aria-label={copyLabel}
        title={copyTitle}
        disabled={isBusy}
        onClick={onCopy}
      >
        {copying ? <Loader2 className="spin" size={16} /> : copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
      </button>
      {screenshot && screenshot.count > 0 ? (
        <button
          className={screenshot.copied ? 'icon-button success' : 'icon-button'}
          type="button"
          aria-label={screenshot.label}
          title={screenshot.title}
          disabled={isBusy}
          onClick={screenshot.onCopy}
        >
          {screenshot.copying ? <Loader2 className="spin" size={16} /> : screenshot.copied ? <CheckCircle2 size={16} /> : <ImageIcon size={16} />}
        </button>
      ) : null}
      <button className="secondary-button" type="button" disabled={isBusy} onClick={onToggleEdit}>
        {saving ? <Loader2 className="spin" size={16} /> : editing ? <Save size={16} /> : <PencilLine size={16} />}
        {editing ? 'Save' : 'Edit'}
      </button>
      <button className="icon-button danger" type="button" aria-label={deleteLabel} title={deleteTitle} disabled={isBusy} onClick={onDelete}>
        {deleting ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
      </button>
    </>
  )
}
