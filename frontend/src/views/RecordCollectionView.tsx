import { useState } from 'react'
import { FileText, Loader2, Plus } from 'lucide-react'
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

export function RecordCollectionView<T extends CollectionRecord>({
  eyebrow,
  heading,
  emptyIcon,
  emptyTitle,
  prefillBusyAction,
  prefillLabel,
  manualBusyAction,
  manualLabel,
  busyAction,
  copiedRecordId,
  copiedRecordScreenshotId,
  recordScreenshotCounts,
  records,
  notice,
  error,
  isBusy,
  activeGenerationJob,
  generationTitle,
  generationTitleAriaLabel,
  generationPlaceholder,
  generationBodyAriaLabel,
  editorIdPrefix,
  titleInputLabel,
  recordNounLower,
  bodyAriaLabelSuffix,
  placeholder,
  previewFallbackHtml,
  renderMeta,
  renderPreviewHeader,
  deleteBusyAction,
  copyBusyAction,
  copyScreenshotBusyAction,
  savingBusyAction,
  updateLocalRecord,
  onCancelGenerationJob,
  onCopyRecord,
  onCopyRecordScreenshot,
  onDeleteRecord,
  onManualCreate,
  onPrefillFromNote,
  onSaveRecord,
  onUploadImage,
}: {
  eyebrow: string
  heading: string
  emptyIcon: LucideIcon
  emptyTitle: string
  prefillBusyAction: BusyAction
  prefillLabel: string
  manualBusyAction: BusyAction
  manualLabel: string
  busyAction: BusyAction | null
  copiedRecordId: string | null
  copiedRecordScreenshotId: string | null
  recordScreenshotCounts: Record<string, number>
  records: T[]
  notice: string | null
  error: string | null
  isBusy: boolean
  activeGenerationJob: GenerationJobStatus | null
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
  renderMeta?: (record: T) => ReactNode
  renderPreviewHeader: (record: T) => ReactNode
  deleteBusyAction: (record: T) => BusyAction
  copyBusyAction: (record: T) => BusyAction
  copyScreenshotBusyAction: (record: T) => BusyAction
  savingBusyAction: (record: T) => BusyAction
  updateLocalRecord: (id: string, patch: Partial<Pick<T, 'title' | 'body' | 'bodyJson' | 'bodyFormat'>>) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopyRecord: (record: T) => Promise<void>
  onCopyRecordScreenshot: (record: T) => Promise<void>
  onDeleteRecord: (record: T) => void
  onManualCreate: () => Promise<void>
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
          <p className="eyebrow">{eyebrow}</p>
          <h1>{heading}</h1>
        </div>
        <div className="collection-header-actions">
          <button className="secondary-button" type="button" disabled={isBusy} onClick={() => void onPrefillFromNote()}>
            {busyAction === prefillBusyAction ? <Loader2 className="spin" size={16} /> : <FileText size={16} />}
            {prefillLabel}
          </button>
          <button className="primary-button" type="button" disabled={isBusy} onClick={() => void onManualCreate()}>
            {busyAction === manualBusyAction ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            {manualLabel}
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
            title={generationTitle}
            titleAriaLabel={generationTitleAriaLabel}
            job={activeGenerationJob}
            placeholder={generationPlaceholder}
            bodyAriaLabel={generationBodyAriaLabel}
            onCancelGenerationJob={onCancelGenerationJob}
          />
        ) : null}
        {records.map((record) => {
          const deleting = busyAction === deleteBusyAction(record)
          const copying = busyAction === copyBusyAction(record)
          const copyingScreenshot = busyAction === copyScreenshotBusyAction(record)
          const copied = copiedRecordId === record.id
          const screenshotCopied = copiedRecordScreenshotId === record.id
          const screenshotCount = recordScreenshotCounts[record.id] ?? 0
          const saving = busyAction === savingBusyAction(record)
          const editorId = `${editorIdPrefix}-${record.id}`
          const recordTitle = record.title.trim()
          const copyLabel = recordCopyLabel(recordNounLower, recordTitle, copied)
          const screenshotCopyLabel = recordScreenshotCopyLabel(recordNounLower, recordTitle, screenshotCopied, screenshotCount)
          const editing = Boolean(editingRecordIds[record.id])
          return (
            <EditableRichRecord
              key={record.id}
              record={record}
              editing={editing}
              editorId={editorId}
              titleInputLabel={titleInputLabel}
              bodyAriaLabel={`${record.title} ${bodyAriaLabelSuffix} ${editing ? 'body' : 'preview'}`}
              placeholder={placeholder}
              previewFallbackHtml={previewFallbackHtml}
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
                  deleteTitle={`Delete ${recordNounLower}`}
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
        {records.length === 0 && !activeGenerationJob ? <EmptyCollection icon={emptyIcon} title={emptyTitle} /> : null}
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
