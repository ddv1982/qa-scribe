import { useMemo, useState } from 'react'
import { AlertTriangle, FileText, Loader2, Search, SearchX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { EmptyCollection, StatePanel, StatusPill } from '../components/Common'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import type { GenerationJobStatus } from '../tauri'
import type { BusyAction } from '../ui/types'
import type { RecordLoadState } from '../app/useRecordHydration'
import { EditableRichRecord, GenerationRecord, RichRecordActions } from './RichRecordView'

type CollectionRecord = {
  id: string
  title: string
  body: string
  bodyJson: string | null
  bodyFormat: string | null
  updatedAt: string
}

type CollectionRecordPatch = Partial<Pick<CollectionRecord, 'title' | 'body' | 'bodyJson' | 'bodyFormat'>>

/** Static per-consumer copy: identical for every record, set once by the caller. */
export type RecordCollectionLabels = {
  eyebrow: string
  heading: string
  emptyTitle: string
  emptyDescription: string
  emptyActionLabel: string
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
  sessionTitle,
  notice,
  error,
  isBusy,
  activeGenerationJob,
  initialSelectedRecordId = null,
  loadState = 'ready',
  loadError = null,
  onRetryLoad,
  renderMeta,
  renderListMeta,
  filter,
  renderEditFields,
  renderPreviewHeader,
  updateLocalRecord,
  onCancelGenerationJob,
  onCopyRecord,
  onCopyRecordScreenshot,
  onDeleteRecord,
  onPrefillFromNote,
  onDiscardRecord,
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
  sessionTitle: string | null
  notice: string | null
  error: string | null
  isBusy: boolean
  activeGenerationJob: GenerationJobStatus | null
  initialSelectedRecordId?: string | null
  loadState?: RecordLoadState
  loadError?: string | null
  onRetryLoad?: () => void
  renderMeta?: (record: T) => ReactNode
  renderListMeta?: (record: T) => ReactNode
  filter?: {
    label: string
    options: Array<{ id: string; label: string }>
    valueFor: (record: T) => string
  }
  renderPreviewHeader: (record: T) => ReactNode
  renderEditFields?: (record: T) => ReactNode
  updateLocalRecord: (id: string, patch: CollectionRecordPatch) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopyRecord: (record: T) => Promise<void>
  onCopyRecordScreenshot: (record: T) => Promise<void>
  onDeleteRecord: (record: T) => void
  onPrefillFromNote: () => Promise<void>
  onDiscardRecord: (record: T) => void
  onSaveRecord: (record: T) => Promise<boolean>
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  const [editingRecordIds, setEditingRecordIds] = useState<Record<string, boolean>>({})
  const [editingOriginals, setEditingOriginals] = useState<Record<string, T>>({})
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'updated' | 'title'>('updated')
  const [filterValue, setFilterValue] = useState('all')
  const setRecordEditing = (id: string, editing: boolean) => setEditingRecordIds((previous) => ({ ...previous, [id]: editing }))
  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    const scoped = filterValue === 'all' || !filter
      ? records
      : records.filter((record) => filter.valueFor(record) === filterValue)
    const filtered = normalizedQuery
      ? scoped.filter((record) => `${record.title} ${record.body}`.toLocaleLowerCase().includes(normalizedQuery))
      : scoped
    return [...filtered].sort((left, right) => sort === 'title'
      ? left.title.localeCompare(right.title)
      : right.updatedAt.localeCompare(left.updatedAt))
  }, [filter, filterValue, query, records, sort])
  const selectedRecord = visibleRecords.find((record) => record.id === (selectedRecordId ?? initialSelectedRecordId))
    ?? visibleRecords[0]
    ?? null
  const selectedEditing = selectedRecord ? Boolean(editingRecordIds[selectedRecord.id]) : false

  function startEditing(record: T) {
    setEditingOriginals((previous) => ({ ...previous, [record.id]: record }))
    setRecordEditing(record.id, true)
  }

  function finishEditing(id: string) {
    setRecordEditing(id, false)
    setEditingOriginals((previous) => {
      const next = { ...previous }
      delete next[id]
      return next
    })
  }

  function discardEditing(record: T) {
    const original = editingOriginals[record.id]
    if (original) onDiscardRecord(original)
    finishEditing(record.id)
  }

  return (
    <section className="collection-view">
      <header className="collection-header">
        <div>
          <p className="eyebrow">{labels.eyebrow}</p>
          <h1>{labels.heading}</h1>
          {sessionTitle ? <p className="collection-context">Session: {sessionTitle}</p> : null}
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
      {loadState === 'error' && records.length > 0 ? (
        <div className="collection-load-advisory" role="alert">
          <span>{loadError ?? `The ${labels.recordNounLower} collection could not be refreshed.`}</span>
          {onRetryLoad ? <button className="secondary-button" type="button" onClick={onRetryLoad}>Try again</button> : null}
        </div>
      ) : null}

      {records.length > 0 ? (
        <div className="collection-toolbar">
          <label className="collection-search">
            <Search size={16} />
            <span className="sr-only">Search {labels.heading}</span>
            <input
              value={query}
              disabled={selectedEditing}
              placeholder={`Search ${labels.heading.toLocaleLowerCase()}…`}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="collection-sort">
            <span>Sort</span>
            <select value={sort} disabled={selectedEditing} onChange={(event) => setSort(event.target.value as 'updated' | 'title')}>
              <option value="updated">Recently updated</option>
              <option value="title">Title</option>
            </select>
          </label>
          {filter ? (
            <label className="collection-sort">
              <span>{filter.label}</span>
              <select value={filterValue} disabled={selectedEditing} onChange={(event) => setFilterValue(event.target.value)}>
                <option value="all">All</option>
                {filter.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          ) : null}
          <p role="status" aria-live="polite">{visibleRecords.length} of {records.length} {labels.recordNounLower} record{records.length === 1 ? '' : 's'}</p>
        </div>
      ) : null}

      <div className="collection-workspace">
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
        {visibleRecords.length > 0 ? (
          <aside className="record-master-list" aria-label={`${labels.heading} records`}>
            {visibleRecords.map((record) => (
              <button
                key={record.id}
                type="button"
                className={selectedRecord?.id === record.id ? 'active' : ''}
                aria-current={selectedRecord?.id === record.id ? 'true' : undefined}
                disabled={selectedEditing && selectedRecord?.id !== record.id}
                onClick={() => setSelectedRecordId(record.id)}
              >
                <strong>{record.title.trim() || `Untitled ${labels.recordNounLower}`}</strong>
                <span>Updated {formatRecordDate(record.updatedAt)}</span>
                {renderListMeta?.(record) ?? renderMeta?.(record)}
              </button>
            ))}
          </aside>
        ) : null}
        {selectedRecord ? (() => {
          const record = selectedRecord
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
            <div className="record-detail-pane">
            <EditableRichRecord
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
                  onEdit={() => startEditing(record)}
                  onSave={() => {
                    void onSaveRecord(record).then((saved) => {
                      if (saved) finishEditing(record.id)
                    })
                  }}
                  onCancelEdit={() => discardEditing(record)}
                />
              }
            />
            </div>
          )
        })() : null}
        {(loadState === 'idle' || loadState === 'loading') && records.length === 0 && !activeGenerationJob ? (
          <StatePanel
            icon={Loader2}
            title={`Loading ${labels.recordNounLower} records`}
            description={`Reading ${labels.recordNounLower} owned by this Session.`}
          />
        ) : null}
        {loadState === 'error' && records.length === 0 && !activeGenerationJob ? (
          <StatePanel
            icon={AlertTriangle}
            title={`Could not load ${labels.recordNounLower} records`}
            description={loadError ?? 'The local collection could not be read.'}
            action={onRetryLoad ? { label: 'Try again', onClick: onRetryLoad } : undefined}
          />
        ) : null}
        {loadState === 'ready' && records.length === 0 && !activeGenerationJob ? (
          <EmptyCollection
            icon={emptyIcon}
            title={labels.emptyTitle}
            description={labels.emptyDescription}
            action={{ label: labels.emptyActionLabel, onClick: () => void onPrefillFromNote() }}
          />
        ) : null}
        {records.length > 0 && visibleRecords.length === 0 ? (
          <EmptyCollection
            icon={SearchX}
            title="No matching records"
            description={`No ${labels.recordNounLower} records match “${query}”. Clear the search to see the full collection.`}
            action={{ label: 'Clear search', onClick: () => setQuery('') }}
          />
        ) : null}
      </div>
    </section>
  )
}

function formatRecordDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
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
