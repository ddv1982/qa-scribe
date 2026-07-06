import { useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { EmptyCollection, StatusPill } from '../components/Common'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import type { GenerationJobStatus } from '../tauri'
import type { BusyAction } from '../ui/types'
import { EditableRichRecord, GenerationRecord, RichRecordActions } from './RichRecordView'

type CollectionRecord = {
  id: string
  title: string
  body: string
  bodyJson: string | null
  bodyFormat: string | null
}

type CollectionRecordPatch = Partial<Pick<CollectionRecord, 'title' | 'body' | 'bodyJson' | 'bodyFormat'>>

/** Static per-consumer copy: identical for every record, set once by the caller. */
export type RecordCollectionLabels = {
  eyebrow: string
  heading: string
  emptyTitle: string
  prefillLabel: string
  generationTitle: string
  generationTitleAriaLabel: string
  generationPlaceholder: string
  generationBodyAriaLabel: string
  editorIdPrefix: string
  titleInputLabel: string
  recordNounLower: string
  bodyAriaLabelSuffix: string
  placeholder: string
  previewFallbackHtml: string
}

/** Which per-record action's busy state to look up. */
export type RecordBusyActionKind = 'delete' | 'copy' | 'copyScreenshot' | 'saving'

export function RecordCollectionView<T extends CollectionRecord>({
  labels,
  emptyIcon,
  prefillBusyAction,
  busyAction,
  busyActionFor,
  copiedRecordId,
  copiedRecordScreenshotId,
  recordScreenshotCounts,
  records,
  notice,
  error,
  isBusy,
  activeGenerationJob,
  renderMeta,
  renderEditFields,
  renderPreviewHeader,
  updateLocalRecord,
  onCancelGenerationJob,
  onCopyRecord,
  onCopyRecordScreenshot,
  onDeleteRecord,
  onPrefillFromNote,
  onSaveRecord,
  onUploadImage,
}: {
  labels: RecordCollectionLabels
  emptyIcon: LucideIcon
  prefillBusyAction: BusyAction
  busyAction: BusyAction | null
  busyActionFor: (record: T, kind: RecordBusyActionKind) => BusyAction
  copiedRecordId: string | null
  copiedRecordScreenshotId: string | null
  recordScreenshotCounts: Record<string, number>
  records: T[]
  notice: string | null
  error: string | null
  isBusy: boolean
  activeGenerationJob: GenerationJobStatus | null
  renderMeta?: (record: T) => ReactNode
  renderPreviewHeader: (record: T) => ReactNode
  renderEditFields?: (record: T) => ReactNode
  updateLocalRecord: (id: string, patch: CollectionRecordPatch) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopyRecord: (record: T) => Promise<void>
  onCopyRecordScreenshot: (record: T) => Promise<void>
  onDeleteRecord: (record: T) => void
  onPrefillFromNote: () => Promise<void>
  onSaveRecord: (record: T) => Promise<boolean>
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  const [editingRecordIds, setEditingRecordIds] = useState<Record<string, boolean>>({})
  const setRecordEditing = (id: string, editing: boolean) => setEditingRecordIds((previous) => ({ ...previous, [id]: editing }))

  return (
    <section className="collection-view">
      <header className="collection-header">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h1>{labels.heading}</h1>
        </div>
        <div className="collection-header-actions">
          <button className="secondary-button" type="button" disabled={isBusy} onClick={() => void onPrefillFromNote()}>
            {busyAction === prefillBusyAction ? <Loader2 className="spin" size={16} /> : <FileText size={16} />}
            {labels.prefillLabel}
          </button>
        </div>
      </header>
      {notice || error ? (
        <div className="collection-status">
          <StatusPill notice={notice} error={error} busyAction={busyAction} />
        </div>
      ) : null}

      <div className="collection-stack">
        {activeGenerationJob ? (
          <GenerationRecord
            title={labels.generationTitle}
            titleAriaLabel={labels.generationTitleAriaLabel}
            job={activeGenerationJob}
            placeholder={labels.generationPlaceholder}
            bodyAriaLabel={labels.generationBodyAriaLabel}
            onCancelGenerationJob={onCancelGenerationJob}
          />
        ) : null}
        {records.map((record) => {
          const deleting = busyAction === busyActionFor(record, 'delete')
          const copying = busyAction === busyActionFor(record, 'copy')
          const copyingScreenshot = busyAction === busyActionFor(record, 'copyScreenshot')
          const copied = copiedRecordId === record.id
          const screenshotCopied = copiedRecordScreenshotId === record.id
          const screenshotCount = recordScreenshotCounts[record.id] ?? 0
          const saving = busyAction === busyActionFor(record, 'saving')
          const editorId = `${labels.editorIdPrefix}-${record.id}`
          const recordTitle = record.title.trim()
          const copyLabel = recordCopyLabel(labels.recordNounLower, recordTitle, copied)
          const screenshotCopyLabel = recordScreenshotCopyLabel(labels.recordNounLower, recordTitle, screenshotCopied, screenshotCount)
          const editing = Boolean(editingRecordIds[record.id])
          return (
            <EditableRichRecord
              key={record.id}
              record={record}
              editing={editing}
              editorId={editorId}
              titleInputLabel={labels.titleInputLabel}
              bodyAriaLabel={`${record.title} ${labels.bodyAriaLabelSuffix} ${editing ? 'body' : 'preview'}`}
              placeholder={labels.placeholder}
              previewFallbackHtml={labels.previewFallbackHtml}
              editFields={renderEditFields?.(record)}
              meta={renderMeta?.(record)}
              previewHeader={renderPreviewHeader(record)}
              onTitleChange={(title) => updateLocalRecord(record.id, { title })}
              onBodyChange={(patch) => updateLocalRecord(record.id, patch)}
              onUploadImage={onUploadImage}
              actions={
                <RichRecordActions
                  copied={copied}
                  copying={copying}
                  copyLabel={copyLabel}
                  copyTitle={copied ? 'Copied' : 'Copy for Jira'}
                  deleting={deleting}
                  deleteLabel={`Delete ${record.title}`}
                  deleteTitle={`Delete ${labels.recordNounLower}`}
                  editing={editing}
                  isBusy={isBusy}
                  saving={saving}
                  screenshot={{
                    copied: screenshotCopied,
                    copying: copyingScreenshot,
                    count: screenshotCount,
                    label: screenshotCopyLabel,
                    title: screenshotCopied ? 'Screenshot copied' : screenshotCount > 1 ? 'Copy first screenshot' : 'Copy screenshot',
                    onCopy: () => void onCopyRecordScreenshot(record),
                  }}
                  onCopy={() => void onCopyRecord(record)}
                  onDelete={() => void onDeleteRecord(record)}
                  onToggleEdit={() => {
                    if (editing) {
                      void onSaveRecord(record).then((saved) => {
                        if (saved) setRecordEditing(record.id, false)
                      })
                    } else {
                      setRecordEditing(record.id, true)
                    }
                  }}
                />
              }
            />
          )
        })}
        {records.length === 0 && !activeGenerationJob ? <EmptyCollection icon={emptyIcon} title={labels.emptyTitle} /> : null}
      </div>
    </section>
  )
}

function recordCopyLabel(nounLower: string, title: string, copied: boolean): string {
  if (copied) return title ? `${title} copied for Jira` : `${capitalize(nounLower)} copied for Jira`
  return title ? `Copy ${title} for Jira` : `Copy ${nounLower} for Jira`
}

function recordScreenshotCopyLabel(nounLower: string, title: string, copied: boolean, count: number): string {
  if (copied) return title ? `${title} screenshot copied for Jira` : `${capitalize(nounLower)} screenshot copied for Jira`
  if (count > 1) return title ? `Copy first ${title} screenshot for Jira` : `Copy first ${nounLower} screenshot for Jira`
  return title ? `Copy ${title} screenshot for Jira` : `Copy ${nounLower} screenshot for Jira`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
