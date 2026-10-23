import { findingCopyBody } from '../findings/copyBody'
import { findingSeverityValue } from '../findings/severity'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Flag, Loader2, Search, SearchX } from 'lucide-react'
import { EmptyCollection, StatePanel } from '../components/Common'
import { richEditorDocumentFromStoredBody } from '../editor/editorDocument'
import { RichTextEditor } from '../editor/RichTextEditor'
import { parseFindingMetadata, findingSeverityLabel, findingStatusLabel } from '../findings/metadata'
import {
  parseTestwareGenerationMetadata,
  testwareDepthLabel,
  testwareOutputFormatLabel,
  testwareTechniqueLabel,
} from '../testware/generationPreferences'
import type { DraftLibraryItem, FindingLibraryItem, FindingKind } from '../tauri'
import { formatFindingKind } from '../ui/format'
import type { ClipboardSnapshot, CopyState } from '../app/copyActions'
import { CopyControls } from './RichRecordView'
import type { LibraryLoadState } from '../app/useOutputLibraries'

type LibraryKind = 'testware' | 'findings'
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
  kindLabel: string
  kindValue: string
  metadata: string[]
}

export function OutputLibraryView({
  kind,
  draftItems = [],
  findingItems = [],
  loadState,
  loadError,
  onRetry,
  onOpenRecord,
  onCopy,
  copyState,
  isBusy,
  sidebarTarget = null,
}: {
  kind: LibraryKind
  draftItems?: DraftLibraryItem[]
  findingItems?: FindingLibraryItem[]
  loadState: LibraryLoadState
  loadError: string | null
  onRetry: () => void
  onOpenRecord: (sessionId: string, recordId: string) => void
  onCopy: (snapshot: ClipboardSnapshot) => Promise<void>
  copyState: CopyState
  isBusy: boolean
  sidebarTarget?: HTMLElement | null
}) {
  const [query, setQuery] = useState('')
  const [sessionFilter, setSessionFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [sort, setSort] = useState<'updated' | 'title' | 'session'>('updated')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const isTestware = kind === 'testware'
  const heading = isTestware ? 'Test cases library' : 'Findings library'
  const records = useMemo<NormalizedLibraryRecord[]>(() => isTestware
    ? draftItems.filter((item) => item.draft.kind === 'testware').map((item) => {
      const metadata = parseTestwareGenerationMetadata(item.draft)
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
        kindLabel: 'Test case',
        kindValue: item.draft.kind,
        metadata: metadata
          ? [testwareTechniqueLabel(metadata.technique), testwareDepthLabel(metadata.depth), testwareOutputFormatLabel(metadata.outputFormat)]
          : [],
      }
    })
    : findingItems.map((item) => {
      const metadata = parseFindingMetadata(item.finding.metadataJson)
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
        kindLabel: formatFindingKind(item.finding.kind),
        kindValue: item.finding.kind,
        metadata: [findingSeverityLabel(findingSeverityValue(item.finding)), findingStatusLabel(metadata.status)],
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
  const recordList = visibleRecords.length > 0 ? (
    <aside className="record-master-list" aria-label={`${heading} records`}>
      {visibleRecords.map((record) => (
        <button key={libraryRecordKey(record)} type="button" className={(selected && libraryRecordKey(selected) === libraryRecordKey(record)) ? 'active' : ''} aria-current={(selected && libraryRecordKey(selected) === libraryRecordKey(record)) ? 'true' : undefined} onClick={() => setSelectedId(libraryRecordKey(record))}>
          <strong>{record.title}</strong>
          <span>{record.sessionTitle}</span>
          <span>{[record.kindLabel, ...record.metadata, `Updated ${formatLibraryDate(record.updatedAt)}`].join(' · ')}</span>
        </button>
      ))}
    </aside>
  ) : null

  if (loadState === 'idle' || loadState === 'loading') {
    return <StatePanel icon={Loader2} title={`Loading ${heading.toLocaleLowerCase()}`} description="Collecting Session-owned output and its provenance." />
  }
  if (loadState === 'error') {
    return <StatePanel icon={SearchX} title={`Could not load ${heading.toLocaleLowerCase()}`} description={loadError ?? 'The local output library could not be read.'} action={{ label: 'Try again', onClick: onRetry }} />
  }

  return (
    <section className={sidebarTarget ? 'collection-view output-library output-library--single-sidebar' : 'collection-view output-library'}>
      {sidebarTarget && recordList ? createPortal(recordList, sidebarTarget) : null}
      <header className="collection-header">
        <div>
          <p className="eyebrow">Cross-session library</p>
          <h1>{heading}</h1>
          <p className="collection-context">Browse output across Sessions. Editing stays in the owning Session workspace.</p>
        </div>
      </header>
      {records.length > 0 ? (
        <div className="collection-toolbar">
          <label className="collection-search">
            <Search size={16} />
            <span className="sr-only">Search {heading}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${heading.toLocaleLowerCase()}…`} />
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
          <p role="status" aria-live="polite">{visibleRecords.length} of {records.length} records</p>
        </div>
      ) : null}
      <div className={sidebarTarget ? 'collection-workspace collection-workspace--single-sidebar' : 'collection-workspace'}>
        {!sidebarTarget ? recordList : null}
        {selected ? (
          <article className="editable-record record-detail-pane library-record-detail">
            <p className="record-provenance">Session: <strong>{selected.sessionTitle}</strong></p>
            <div className="record-heading-row">
              <h2 className="record-title">{selected.title}</h2>
              <div className="finding-meta-row"><span>{selected.kindLabel}</span>{selected.metadata.map((value) => <span key={value}>{value}</span>)}</div>
            </div>
            <div className="rich-record-editor-field rich-record-preview-field">
              <RichTextEditor value={richEditorDocumentFromStoredBody(selected)} ariaLabel={`${selected.title} preview`} readOnly />
            </div>
            <div className="record-actions">
              <CopyControls snapshot={{ target: { kind: selected.sourceKind, sessionId: selected.sessionId, id: selected.id, action: 'jira-text' }, title: selected.title, bodyHtml: selected.sourceKind === 'finding' ? findingCopyBody(selected.body, selected.metadataJson) : selected.body }}
                copyState={copyState} onCopy={onCopy} disabled={isBusy} label={selected.title} />
              <button className="primary-button" type="button" onClick={() => onOpenRecord(selected.sessionId, selected.id)}>Open in Session</button>
            </div>
          </article>
        ) : null}
        {records.length === 0 ? <EmptyCollection icon={isTestware ? BookOpen : Flag} title={`No ${isTestware ? 'test cases' : 'findings'} yet`} description={`Create ${isTestware ? 'Test cases' : 'Findings'} in a Session to see it in this library.`} /> : null}
        {records.length > 0 && visibleRecords.length === 0 ? <EmptyCollection icon={SearchX} title="No matching records" description="Change or clear the current search and filters." action={{ label: 'Clear filters', onClick: () => { setQuery(''); setSessionFilter('all'); setKindFilter('all') } }} /> : null}
      </div>
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
