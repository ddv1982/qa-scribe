import { ActionButton } from '../components/ActionButton'
import { findingCopyBody } from '../findings/copyBody'
import { findingSeverityValue } from '../findings/severity'
import { useMemo, useState } from 'react'
import { ArrowUpRight, BookOpen, Flag, Loader2, Search, SearchX } from 'lucide-react'
import { EmptyCollection, StatePanel } from '../components/Common'
import { richEditorDocumentFromStoredBody, withoutRepeatedTitleHeading } from '../editor/editorDocument'
import { RichTextEditor } from '../editor/RichTextEditor'
import { parseFindingMetadata, findingSeverityLabel, findingStatusLabel } from '../findings/metadata'
import { testwareGenerationSummary } from '../testware/generationPreferences'
import type { DraftLibraryItem, FindingLibraryItem, FindingKind } from '../tauri'
import { formatFindingKind } from '../ui/format'
import type { ClipboardSnapshot, CopyState } from '../app/copyActions'
import { CopyControls } from './RichRecordView'
import type { LibraryLoadState } from '../app/useOutputLibraries'

export type LibraryKind = 'testware' | 'findings'
type NormalizedLibraryRecord = {
  id: string
  sourceKind: 'draft' | 'finding'
  sessionId: string
  sessionTitle: string
  title: string
  body: string
  bodyJson: string | null
  bodyFormat: string | null
  metadataJson: string | null
  updatedAt: string
  kindValue: string
  /** What a reader needs at a glance: format for test cases; type, set severity and status for findings. */
  metadata: string[]
  metadataDetail?: string
}

const libraryKinds: Array<{ id: LibraryKind; label: string }> = [
  { id: 'testware', label: 'Test cases' },
  { id: 'findings', label: 'Findings' },
]

export function OutputLibraryView({
  kind,
  onSelectKind = () => {},
  draftItems = [],
  findingItems = [],
  loadState,
  loadError,
  onRetry,
  onOpenRecord,
  onCopy,
  copyState,
  isBusy,
}: {
  kind: LibraryKind
  onSelectKind?: (kind: LibraryKind) => void
  draftItems?: DraftLibraryItem[]
  findingItems?: FindingLibraryItem[]
  loadState: LibraryLoadState
  loadError: string | null
  onRetry: () => void
  onOpenRecord: (sessionId: string, recordId: string) => void
  onCopy: (snapshot: ClipboardSnapshot) => Promise<void>
  copyState: CopyState
  isBusy: boolean
}) {
  const [query, setQuery] = useState('')
  const [sessionFilter, setSessionFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [sort, setSort] = useState<'updated' | 'title' | 'session'>('updated')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const isTestware = kind === 'testware'
  const kindLabel = isTestware ? 'Test cases' : 'Findings'
  const scopeLabel = `${kindLabel} library`
  const records = useMemo<NormalizedLibraryRecord[]>(() => isTestware
    ? draftItems.filter((item) => item.draft.kind === 'testware').map((item) => {
      const summary = testwareGenerationSummary(item.draft)
      return {
        sourceKind: 'draft',
        id: item.draft.id,
        sessionId: item.draft.sessionId,
        sessionTitle: item.sessionTitle,
        title: item.draft.title,
        body: item.draft.body,
        bodyJson: item.draft.bodyJson,
        bodyFormat: item.draft.bodyFormat,
        metadataJson: item.draft.metadataJson,
        updatedAt: item.draft.updatedAt,
        kindValue: item.draft.kind,
        metadata: summary ? [summary.format] : [],
        metadataDetail: summary?.detail,
      }
    })
    : findingItems.map((item) => {
      const metadata = parseFindingMetadata(item.finding.metadataJson)
      const severity = findingSeverityValue(item.finding)
      return {
        sourceKind: 'finding',
        id: item.finding.id,
        sessionId: item.finding.sessionId,
        sessionTitle: item.sessionTitle,
        title: item.finding.title,
        body: item.finding.body,
        bodyJson: item.finding.bodyJson,
        bodyFormat: item.finding.bodyFormat,
        metadataJson: item.finding.metadataJson,
        updatedAt: item.finding.updatedAt,
        kindValue: item.finding.kind,
        metadata: [formatFindingKind(item.finding.kind), ...(severity === 'unspecified' ? [] : [findingSeverityLabel(severity)]), findingStatusLabel(metadata.status)],
      }
    }), [draftItems, findingItems, isTestware])
  const sessions = useMemo(() => Array.from(new Map(records.map((record) => [record.sessionId, record.sessionTitle])).entries())
    .sort((left, right) => left[1].localeCompare(right[1])), [records])
  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return records
      .filter((record) => sessionFilter === 'all' || record.sessionId === sessionFilter)
      .filter((record) => kindFilter === 'all' || record.kindValue === kindFilter)
      .filter((record) => !normalizedQuery || `${record.title} ${record.body} ${record.sessionTitle}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => sort === 'title'
        ? left.title.localeCompare(right.title)
        : sort === 'session'
          ? left.sessionTitle.localeCompare(right.sessionTitle) || left.title.localeCompare(right.title)
          : right.updatedAt.localeCompare(left.updatedAt))
  }, [kindFilter, query, records, sessionFilter, sort])
  const selected = visibleRecords.find((record) => libraryRecordKey(record) === selectedId) ?? visibleRecords[0] ?? null
  const selectedDocument = useMemo(() => selected ? withoutRepeatedTitleHeading(richEditorDocumentFromStoredBody(selected), selected.title) : null, [selected])
  const filtered = visibleRecords.length !== records.length
  // A refresh keeps the records already shown; the loading panel is only for a first, empty load.
  const firstLoad = (loadState === 'idle' || loadState === 'loading') && records.length === 0

  return (
    <section className="collection-view output-library">
      <header className="collection-header">
        <h1>Library</h1>
        <div className="segmented-tabs" role="tablist" aria-label="Library output type">
          {libraryKinds.map((option) => (
            <button key={option.id} type="button" role="tab" aria-selected={option.id === kind}
              className={option.id === kind ? 'active' : ''} onClick={() => { if (option.id !== kind) onSelectKind(option.id) }}>
              {option.label}
            </button>
          ))}
        </div>
      </header>
      {firstLoad ? (
        <StatePanel icon={Loader2} title={`Loading ${scopeLabel.toLocaleLowerCase()}`} description="Collecting Session-owned output and its provenance." />
      ) : loadState === 'error' && records.length === 0 ? (
        <StatePanel icon={SearchX} title={`Could not load ${scopeLabel.toLocaleLowerCase()}`} description={loadError ?? 'The local output library could not be read.'} action={{ label: 'Try again', onClick: onRetry }} />
      ) : <>
        {loadState === 'error' ? (
          <div className="collection-load-advisory" role="alert">
            <span>{loadError ?? `The ${scopeLabel.toLocaleLowerCase()} could not be refreshed.`}</span>
            <ActionButton variant="secondary" type="button" onClick={onRetry}>Try again</ActionButton>
          </div>
        ) : null}
        {records.length > 0 ? (
          <div className="collection-toolbar">
            <label className="collection-search">
              <Search size={16} />
              <span className="sr-only">Search {scopeLabel}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${kindLabel.toLocaleLowerCase()}…`} />
            </label>
            <label className="collection-sort">
              <span>Session</span>
              <select value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}>
                <option value="all">All Sessions</option>
                {sessions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
              </select>
            </label>
            {!isTestware ? (
              <label className="collection-sort">
                <span>Type</span>
                <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
                  <option value="all">All types</option>
                  {(['bug', 'question', 'risk', 'follow_up', 'note'] satisfies FindingKind[]).map((value) => <option key={value} value={value}>{formatFindingKind(value)}</option>)}
                </select>
              </label>
            ) : null}
            <label className="collection-sort">
              <span>Sort</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                <option value="updated">Recently updated</option>
                <option value="title">Title</option>
                <option value="session">Session</option>
              </select>
            </label>
            <p role="status" aria-live="polite">{filtered ? `${visibleRecords.length} of ${records.length} records` : `${records.length} record${records.length === 1 ? '' : 's'}`}</p>
          </div>
        ) : null}
        <div className="collection-workspace">
          {visibleRecords.length > 0 ? (
            <aside className="record-master-list" aria-label={`${scopeLabel} records`}>
              {visibleRecords.map((record) => {
                const current = Boolean(selected && libraryRecordKey(selected) === libraryRecordKey(record))
                return (
                  <button key={libraryRecordKey(record)} type="button" className={current ? 'active' : ''} aria-current={current ? 'true' : undefined}
                    title={record.metadataDetail} onClick={() => setSelectedId(libraryRecordKey(record))}>
                    <strong>{record.title}</strong>
                    <span>{[record.sessionTitle, ...record.metadata, formatLibraryDate(record.updatedAt)].join(' · ')}</span>
                  </button>
                )
              })}
            </aside>
          ) : null}
          {selected && selectedDocument ? (
            <article className="editable-record record-detail-pane library-record-detail">
              <header className="record-header">
                <div className="record-title-row">
                  <div className="record-heading-row">
                    <h2 className="record-title">{selected.title}</h2>
                  </div>
                  <CopyControls snapshot={{ target: { kind: selected.sourceKind, sessionId: selected.sessionId, id: selected.id, action: 'jira-text' }, title: selected.title, bodyHtml: selected.sourceKind === 'finding' ? findingCopyBody(selected.body, selected.metadataJson) : selected.body }}
                    copyState={copyState} onCopy={onCopy} disabled={isBusy} label={selected.title} />
                </div>
                <p className="record-meta-line" title={selected.metadataDetail}>{[selected.sessionTitle, ...selected.metadata].join(' · ')}</p>
                <div className="record-actions">
                  <ActionButton variant="secondary" icon={ArrowUpRight} type="button" onClick={() => onOpenRecord(selected.sessionId, selected.id)}>Open in Session</ActionButton>
                </div>
              </header>
              <div className="rich-record-editor-field rich-record-preview-field">
                <RichTextEditor value={selectedDocument} ariaLabel={`${selected.title} preview`} readOnly />
              </div>
            </article>
          ) : null}
          {records.length === 0 ? <EmptyCollection icon={isTestware ? BookOpen : Flag} title={`No ${kindLabel.toLocaleLowerCase()} yet`} description={`Create ${kindLabel} in a Session to see them here.`} /> : null}
          {records.length > 0 && visibleRecords.length === 0 ? <EmptyCollection icon={SearchX} title="No matching records" description="Change or clear the current search and filters." action={{ label: 'Clear filters', onClick: () => { setQuery(''); setSessionFilter('all'); setKindFilter('all') } }} /> : null}
        </div>
      </>}
    </section>
  )
}

function formatLibraryDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function libraryRecordKey(record: NormalizedLibraryRecord): string {
  return JSON.stringify([record.sourceKind, record.sessionId, record.id])
}
