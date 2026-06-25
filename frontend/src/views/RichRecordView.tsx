import type { ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import { richEditorDocumentFromHtml, richEditorDocumentFromStoredBody, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import type { GenerationJobStatus } from '../tauri'

type StoredRichBody = {
  body: string
  bodyJson: string | null
  bodyFormat: string | null
}

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
