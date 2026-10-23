import { ActionButton } from '../components/ActionButton'
import { RecordCreationActions, type RecordCreationCommands } from './RecordCreationActions'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Search, SearchX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { EmptyCollection, StatePanel, StatusPill } from '../components/Common'
import type { RichEditorImageUpload } from '../editor/RichTextEditor'
import type { GenerationJobStatus } from '../tauri'
import type { BusyAction } from '../ui/types'
import type { RecordLoadState } from '../app/useRecordHydration'
import type { ClipboardSnapshot, CopyState } from '../app/copyActions'
import type { CreatedRecordEditTarget } from '../app/types'
import { CopyControls, EditableRichRecord, GenerationRecord, RichRecordActions } from './RichRecordView'

type CollectionRecord = {
  id: string
  sessionId: string
  title: string
  body: string
  bodyJson: string | null
  bodyFormat: string | null
  updatedAt: string
}

type CollectionRecordPatch = Partial<Pick<CollectionRecord, 'title' | 'body' | 'bodyJson' | 'bodyFormat'>>

export type RecordCollectionLabels = {
  eyebrow: string
  heading: string
  emptyTitle: string
  emptyDescription: string
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

export type RecordBusyActionKind = 'delete' | 'saving'

export function RecordCollectionView<T extends CollectionRecord>({
  composer, settleCreation,
  creationCommands,
  labels,
  emptyIcon,
  busyAction,
  busyActionFor,
  sourceKind,
  copyBody,
  copyState,  recordScreenshotCounts,
  records,
  sessionTitle,
  notice,
  error,
  isBusy,
  activeGenerationJob,
  initialSelectedRecordId = null,
  createdRecordEditTarget = null,
  onCreatedRecordEditTargetConsumed,
  loadState = 'ready',
  loadError = null,
  onRetryLoad,
  renderMeta,
  renderListMeta,
  filter,
  renderEditFields, onPrepareEdit,
  renderPreviewHeader,
  updateLocalRecord,
  onCancelGenerationJob,
  onCopy,
  onDeleteRecord,
  onDiscardRecord,
  onSaveRecord,
  onUploadImage,
}: {
  settleCreation?: () => Promise<boolean>
  composer?: ReactNode
  creationCommands: RecordCreationCommands
  labels: RecordCollectionLabels
  emptyIcon: LucideIcon
  busyAction: BusyAction | null
  busyActionFor: (record: T, kind: RecordBusyActionKind) => BusyAction
  sourceKind: 'draft' | 'finding'
  copyBody?: (record: T) => string
  copyState: CopyState
  recordScreenshotCounts: Record<string, number>
  records: T[]
  sessionTitle: string | null
  notice: string | null
  error: string | null
  isBusy: boolean
  activeGenerationJob: GenerationJobStatus | null
  initialSelectedRecordId?: string | null
  createdRecordEditTarget?: CreatedRecordEditTarget | null
  onCreatedRecordEditTargetConsumed?: (target: CreatedRecordEditTarget) => void
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
  onPrepareEdit?: (record: T) => void
  renderEditFields?: (record: T) => ReactNode
  updateLocalRecord: (id: string, patch: CollectionRecordPatch) => void
  onCancelGenerationJob: (jobId: string) => Promise<void>
  onCopy: (snapshot: ClipboardSnapshot) => Promise<void>
  onDeleteRecord: (record: T) => void
  onDiscardRecord: (record: T) => void
  onSaveRecord: (record: T) => Promise<boolean>
  onUploadImage: (input: RichEditorImageUpload, recordId: string) => void | Promise<void>
}) {
  const [editingRecordIds, setEditingRecordIds] = useState<Record<string, boolean>>({})
  const [editingOriginals, setEditingOriginals] = useState<Record<string, T>>({})
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'updated' | 'title'>('updated')
  const [filterValue, setFilterValue] = useState('all')
  const selectionEpochRef = useRef(0)
  const previewRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [appliedTarget, setAppliedTarget] = useState<CreatedRecordEditTarget | null>(null)
  const focusedTargetRef = useRef<CreatedRecordEditTarget | null>(null)
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

  const createdRecord = createdRecordEditTarget && records.find((record) => record.id === createdRecordEditTarget.recordId)
  if (createdRecord && appliedTarget?.recordId !== createdRecord.id) {
    setAppliedTarget(createdRecordEditTarget)
    setQuery('')
    setFilterValue('all')
    setSelectedRecordId(createdRecord.id)
    setEditingOriginals({ [createdRecord.id]: createdRecord })
    setEditingRecordIds({ [createdRecord.id]: createdRecordEditTarget?.editing !== false })
  }

  useEffect(() => {
    const input = titleInputRef.current
    if (appliedTarget && appliedTarget.editing === false && selectedRecord?.id === appliedTarget.recordId && focusedTargetRef.current?.recordId !== appliedTarget.recordId) {
      const heading = previewRef.current?.querySelector<HTMLElement>('.record-title')
      if (!heading) return
      heading.tabIndex = -1
      heading.focus({ preventScroll: true })
      focusedTargetRef.current = appliedTarget
      onCreatedRecordEditTargetConsumed?.(appliedTarget)
      return
    }
    if (!appliedTarget || focusedTargetRef.current?.recordId === appliedTarget.recordId || appliedTarget.recordId !== createdRecordEditTarget?.recordId
      || selectedRecord?.id !== appliedTarget.recordId || !selectedEditing || !input) return
    input.scrollIntoView({ block: 'center', inline: 'nearest' })
    input.focus({ preventScroll: true })
    if (document.activeElement !== input) return
    focusedTargetRef.current = appliedTarget
    onCreatedRecordEditTargetConsumed?.(appliedTarget)
  }, [appliedTarget, createdRecordEditTarget, onCreatedRecordEditTargetConsumed, selectedRecord?.id, selectedEditing])

  function startEditing(record: T) {
    setEditingOriginals((previous) => ({ ...previous, [record.id]: record }))
    onPrepareEdit?.(record)
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
          {!composer ? <RecordCreationActions commands={creationCommands} /> : null}
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
          {onRetryLoad ? <ActionButton variant="secondary" type="button" onClick={onRetryLoad}>Try again</ActionButton> : null}
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

      <div className={visibleRecords.length ? "collection-workspace" : "collection-workspace collection-workspace--single-sidebar"}>
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
                className={!composer && selectedRecord?.id === record.id ? 'active' : ''}
                aria-current={!composer && selectedRecord?.id === record.id ? 'true' : undefined}
                disabled={selectedEditing && selectedRecord?.id !== record.id}
                onClick={() => {
                  const epoch = ++selectionEpochRef.current
                  if (composer && settleCreation) void settleCreation().then((settled) => { if (settled && selectionEpochRef.current === epoch) setSelectedRecordId(record.id) })
                  else setSelectedRecordId(record.id)
                }}
              >
                <strong>{record.title.trim() || `Untitled ${labels.recordNounLower}`}</strong>
                <span>Updated {formatRecordDate(record.updatedAt)}</span>
                {renderListMeta?.(record) ?? renderMeta?.(record)}
              </button>
            ))}
          </aside>
        ) : null}
        {composer ? <div className="record-detail-pane">{composer}</div> : selectedRecord ? (() => {
          const record = selectedRecord
          const deleting = busyAction === busyActionFor(record, 'delete')
          const screenshotCount = recordScreenshotCounts[record.id] ?? 0
          const saving = busyAction === busyActionFor(record, 'saving')
          const editorId = `${labels.editorIdPrefix}-${record.id}`
          const editing = Boolean(editingRecordIds[record.id])
          return (
            <div className="record-detail-pane" ref={previewRef}>
            <EditableRichRecord
              record={record}
              editing={editing}
              editorId={editorId}
              titleInputLabel={labels.titleInputLabel}
              titleInputRef={titleInputRef}
              bodyAriaLabel={`${record.title} ${labels.bodyAriaLabelSuffix} ${editing ? 'body' : 'preview'}`}
              placeholder={labels.placeholder}
              previewFallbackHtml={labels.previewFallbackHtml}
              editFields={renderEditFields?.(record)}
              meta={renderMeta?.(record)}
              previewHeader={renderPreviewHeader(record)}
              onTitleChange={(title) => updateLocalRecord(record.id, { title })}
              onBodyChange={(patch) => updateLocalRecord(record.id, patch)}
              onUploadImage={(input) => onUploadImage(input, record.id)}
              actions={
                <RichRecordActions
                  copyControls={<CopyControls
                    snapshot={{ target: { kind: sourceKind, sessionId: record.sessionId, id: record.id, action: 'jira-text' }, title: record.title, bodyHtml: copyBody?.(record) ?? record.body }}
                    copyState={copyState} onCopy={onCopy} disabled={isBusy}
                    label={record.title.trim() || labels.recordNounLower} screenshotCount={screenshotCount} />}
                  deleting={deleting}
                  deleteLabel={`Delete ${record.title}`}
                  deleteTitle={`Delete ${labels.recordNounLower}`}
                  editing={editing}
                  isBusy={isBusy}
                  saving={saving}
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
        {(loadState === 'idle' || loadState === 'loading') && records.length === 0 && !activeGenerationJob && !composer ? (
          <StatePanel
            icon={Loader2}
            title={`Loading ${labels.recordNounLower} records`}
            description={`Reading ${labels.recordNounLower} owned by this Session.`}
          />
        ) : null}
        {loadState === 'error' && records.length === 0 && !activeGenerationJob && !composer ? (
          <StatePanel
            icon={AlertTriangle}
            title={`Could not load ${labels.recordNounLower} records`}
            description={loadError ?? 'The local collection could not be read.'}
            action={onRetryLoad ? { label: 'Try again', onClick: onRetryLoad } : undefined}
          />
        ) : null}
        {loadState === 'ready' && records.length === 0 && !activeGenerationJob && !composer ? (
          <EmptyCollection
            icon={emptyIcon}
            title={labels.emptyTitle}
            description={labels.emptyDescription}
          />
        ) : null}
        {records.length > 0 && visibleRecords.length === 0 ? (
          <EmptyCollection
            icon={SearchX}
            title="No matching records"
            description={filterValue !== 'all'
              ? `No ${labels.recordNounLower} records match the current filters. Clear filters to see the full collection.`
              : `No ${labels.recordNounLower} records match “${query}”. Clear the search to see the full collection.`}
            action={filterValue !== 'all'
              ? { label: 'Clear filters', onClick: () => { setQuery(''); setFilterValue('all') } }
              : { label: 'Clear search', onClick: () => setQuery('') }}
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
