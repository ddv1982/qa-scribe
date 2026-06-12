import { useEffect, useMemo, useState, type MouseEvent, type ReactElement } from 'react'
import {
  Archive,
  Bot,
  Bug,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  FileJson,
  FileText,
  Filter,
  ImagePlus,
  Loader2,
  PanelRightOpen,
  Plus,
  Search,
  Sparkles,
  Trash2
} from 'lucide-react'
import type {
  Attachment,
  Draft,
  Entry,
  EntryType,
  EvidenceLink,
  Finding as StoredFinding,
  GenerationContextReview,
  ProviderStatus,
  Session,
  SessionDraft,
  SessionSnapshot
} from '../../shared/contracts'

type WorkspaceMode = 'capture' | 'generation' | 'drafts'

type Finding = {
  id: string
  sessionId: string
  title: string
  summary: string
  severity?: string | null
  status?: string | null
  evidenceEntryIds: string[]
  evidenceAttachmentIds: string[]
  createdAt: string
}

type FindingDraft = {
  sessionId: string
  title: string
  summary: string
  severity?: string | null
  evidenceEntryIds: string[]
  evidenceAttachmentIds?: string[]
}

type JiraBugDraft = {
  id: string
  title: string
  description: string
  steps: string
  expected: string
  actual: string
  evidence: string
}

type ReviewDraft = {
  id: string
  sessionId: string
  title: string
  content: string
  jiraBugDrafts: JiraBugDraft[]
  updatedAt: string
}

type ContextRow = {
  entry: Entry
  included: boolean
  attachments: Attachment[]
}

const entryTypes: Array<{ value: EntryType; label: string }> = [
  { value: 'note', label: 'Note' },
  { value: 'observation', label: 'Observation' },
  { value: 'api_response', label: 'API Response' },
  { value: 'log', label: 'Log' },
  { value: 'finding_candidate', label: 'Finding' }
]

const emptyDraft: SessionDraft = {
  title: '',
  testTarget: '',
  charter: '',
  environment: '',
  buildVersion: '',
  relatedReference: ''
}

export function App(): ReactElement {
  const [sessions, setSessions] = useState<Session[]>([])
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>(emptyDraft)
  const [entryType, setEntryType] = useState<EntryType>('note')
  const [entryTitle, setEntryTitle] = useState('')
  const [entryBody, setEntryBody] = useState('')
  const [filter, setFilter] = useState<EntryType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('capture')
  const [generationContext, setGenerationContext] = useState<GenerationContextReview | null>(null)
  const [generationContextId, setGenerationContextId] = useState<string | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [draft, setDraft] = useState<ReviewDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void bootstrap()
  }, [])

  const selectedEntry = snapshot?.entries.find((entry) => entry.id === selectedEntryId) ?? null

  const contextRows = useMemo(() => {
    if (!snapshot) return []
    return normalizeContextRows(generationContext, snapshot)
  }, [generationContext, snapshot])

  const sessionLevelAttachments = useMemo(() => {
    if (!snapshot) return []
    return generationContext?.attachments ?? snapshot.attachments.filter((attachment) => attachment.entryId === null)
  }, [generationContext, snapshot])

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return (snapshot?.entries ?? []).filter((entry) => {
      const matchesType = filter === 'all' || entry.type === filter
      const matchesQuery =
        normalizedQuery.length === 0 ||
        entry.title?.toLowerCase().includes(normalizedQuery) ||
        entry.body.toLowerCase().includes(normalizedQuery)
      return matchesType && matchesQuery
    })
  }, [filter, query, snapshot])

  async function bootstrap(): Promise<void> {
    setBusy(true)
    try {
      const [sessionList, aiStatus] = await Promise.all([window.qaScribe.listSessions(), window.qaScribe.getProviderStatus()])
      setSessions(sessionList)
      setProviderStatus(aiStatus)

      const lastActive = window.localStorage.getItem('qa-scribe:last-session')
      const preferred = sessionList.find((session) => session.id === lastActive) ?? sessionList[0]
      if (preferred) await openSession(preferred.id)
    } finally {
      setBusy(false)
    }
  }

  async function refreshSessions(): Promise<void> {
    setSessions(await window.qaScribe.listSessions())
  }

  async function openSession(id: string): Promise<void> {
    const next = await window.qaScribe.getSession(id)
    if (!next) return
    setSnapshot(next)
    setSessionDraft({
      title: next.session.title,
      testTarget: next.session.testTarget ?? '',
      charter: next.session.charter ?? '',
      environment: next.session.environment ?? '',
      buildVersion: next.session.buildVersion ?? '',
      relatedReference: next.session.relatedReference ?? ''
    })
    setSelectedEntryId(null)
    setGenerationContext(null)
    setGenerationContextId(null)
    await loadReviewState(next)
    window.localStorage.setItem('qa-scribe:last-session', id)
    await refreshSessions()
  }

  async function loadReviewState(next: SessionSnapshot): Promise<void> {
    setFindings(next.findings.map((finding) => normalizeFinding(finding, next.evidenceLinks)))
    setDraft(normalizeDraft(next.drafts[0]))
  }

  async function createSession(): Promise<void> {
    setBusy(true)
    try {
      const created = await window.qaScribe.createSession({ title: 'New Session' })
      await refreshSessions()
      await openSession(created.id)
    } finally {
      setBusy(false)
    }
  }

  async function saveSession(): Promise<void> {
    if (!snapshot) return
    try {
      const updated = await window.qaScribe.updateSession(snapshot.session.id, sessionDraft)
      setSnapshot({ ...snapshot, session: updated })
      await refreshSessions()
      flash('Session saved')
    } catch (error) {
      flashError(error, 'Session could not be saved')
    }
  }

  async function deleteCurrentSession(): Promise<void> {
    if (!snapshot) return
    await window.qaScribe.deleteSession(snapshot.session.id)
    window.localStorage.removeItem('qa-scribe:last-session')
    setSnapshot(null)
    setSessionDraft(emptyDraft)
    setFindings([])
    setDraft(null)
    await bootstrap()
  }

  async function addEntry(): Promise<void> {
    if (!snapshot || entryBody.trim().length === 0) return
    try {
      await window.qaScribe.createEntry({
        sessionId: snapshot.session.id,
        type: entryType,
        title: entryTitle,
        body: entryBody
      })
      setEntryTitle('')
      setEntryBody('')
      await openSession(snapshot.session.id)
    } catch (error) {
      flashError(error, 'Entry could not be saved')
    }
  }

  async function toggleGenerationExclusion(entry: Entry): Promise<void> {
    if (!snapshot) return
    await window.qaScribe.updateEntry(entry.id, { excludedFromGeneration: !entry.excludedFromGeneration })
    await openSession(snapshot.session.id)
    setSelectedEntryId(entry.id)
    flash(entry.excludedFromGeneration ? 'Entry included for generation' : 'Entry excluded from generation')
  }

  async function toggleReviewedEntry(row: ContextRow): Promise<void> {
    if (!snapshot) return
    if (generationContextId) {
      const nextContext = await window.qaScribe.updateGenerationContextEntry(generationContextId, row.entry.id, !row.included)
      setGenerationContext(nextContext)
      setGenerationContextId(nextContext.context.id)
      flash(row.included ? 'Entry excluded from context' : 'Entry included in context')
      return
    }
    await toggleGenerationExclusion(row.entry)
  }

  async function deleteEntry(entry: Entry): Promise<void> {
    if (!snapshot) return
    await window.qaScribe.deleteEntry(entry.id)
    await openSession(snapshot.session.id)
  }

  async function importAttachment(entryId?: string): Promise<void> {
    if (!snapshot) return
    try {
      const attachment = await window.qaScribe.importAttachment(snapshot.session.id, entryId)
      if (attachment) {
        await openSession(snapshot.session.id)
        flash('Evidence imported')
      }
    } catch (error) {
      flashError(error, 'Evidence could not be imported')
    }
  }

  async function exportSession(format: 'markdown' | 'json'): Promise<void> {
    if (!snapshot) return
    try {
      const exported = await window.qaScribe.exportSession(snapshot.session.id, format)
      await navigator.clipboard.writeText(exported.content)
      flash(`${format === 'markdown' ? 'Markdown' : 'JSON'} copied`)
    } catch (error) {
      flashError(error, 'Export could not be copied')
    }
  }

  async function openGenerationReview(): Promise<void> {
    if (!snapshot) return
    setWorkspaceMode('generation')
    setGenerationContext(null)
    setGenerationContextId(null)
    setBusy(true)
    try {
      const nextContext = await window.qaScribe.createGenerationContext(snapshot.session.id)
      setGenerationContext(nextContext)
      setGenerationContextId(nextContext.context.id)
    } finally {
      setBusy(false)
    }
  }

  async function createFindingFromEntry(entry: Entry): Promise<void> {
    if (!snapshot) return
    const entryAttachments = snapshot.attachments.filter((attachment) => attachment.entryId === entry.id)
    const input: FindingDraft = {
      sessionId: snapshot.session.id,
      title: entry.title || formatEntryType(entry.type),
      summary: entry.body,
      severity: 'untriaged',
      evidenceEntryIds: [entry.id],
      evidenceAttachmentIds: entryAttachments.map((attachment) => attachment.id)
    }
    try {
      const storedFinding = await window.qaScribe.createFinding({
        sessionId: input.sessionId,
        title: input.title,
        body: input.summary,
        kind: 'bug',
        entryId: entry.id
      })
      for (const attachment of entryAttachments) {
        await window.qaScribe.createEvidenceLink({ findingId: storedFinding.id, attachmentId: attachment.id })
      }
      const created = normalizeFinding(
        storedFinding,
        [
          {
            id: `entry-${entry.id}`,
            findingId: storedFinding.id,
            entryId: entry.id,
            attachmentId: null,
            createdAt: storedFinding.createdAt
          },
          ...entryAttachments.map((attachment) => ({
            id: `attachment-${attachment.id}`,
            findingId: storedFinding.id,
            entryId: null,
            attachmentId: attachment.id,
            createdAt: storedFinding.createdAt
          }))
        ]
      )
      const nextFindings = [...findings, created]
      setFindings(nextFindings)
      await openSession(snapshot.session.id)
      setSelectedEntryId(entry.id)
      flash('Finding created')
    } catch (error) {
      flashError(error, 'Finding could not be created')
    }
  }

  async function generateTestware(): Promise<void> {
    if (!snapshot) return
    setGenerating(true)
    try {
      let activeContextId = generationContextId
      if (!activeContextId) {
        const nextContext = await window.qaScribe.createGenerationContext(snapshot.session.id)
        setGenerationContext(nextContext)
        activeContextId = nextContext.context.id
        setGenerationContextId(activeContextId)
      }
      const result = await window.qaScribe.generateTestware(activeContextId)
      setDraft(draftFromGenerationResult(result, snapshot, findings))
      await openSession(snapshot.session.id)
      setWorkspaceMode('drafts')
      flash('Generated draft ready')
    } catch (error) {
      await openSession(snapshot.session.id)
      flash(error instanceof Error ? error.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function persistDraft(nextDraft: ReviewDraft): Promise<void> {
    if (!snapshot) return
    let saved = nextDraft
    if (draft?.id && !draft.id.startsWith('local-draft-')) {
      saved = normalizeDraft(
        await window.qaScribe.updateDraft(draft.id, {
          title: nextDraft.title,
          body: nextDraft.content
        })
      ) ?? nextDraft
    } else {
      saved =
        normalizeDraft(
          await window.qaScribe.createDraft({
            sessionId: snapshot.session.id,
            kind: 'session_report',
            title: nextDraft.title,
            body: nextDraft.content
          })
        ) ?? nextDraft
    }
    setDraft(saved)
  }

  async function updateDraftContent(content: string): Promise<void> {
    if (!snapshot) return
    const nextDraft =
      draft ??
      createLocalReviewDraft(
        snapshot,
        findings,
        contextRows.filter((row) => row.included)
      )
    setDraft({ ...nextDraft, content, updatedAt: new Date().toISOString() })
  }

  async function saveDraft(): Promise<void> {
    if (!snapshot) return
    const nextDraft =
      draft ??
      createLocalReviewDraft(
        snapshot,
        findings,
        contextRows.filter((row) => row.included)
      )
    try {
      await persistDraft({ ...nextDraft, updatedAt: new Date().toISOString() })
      flash('Draft saved')
    } catch (error) {
      flashError(error, 'Draft could not be saved')
    }
  }

  async function copyText(text: string, message = 'Copied'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      flash(message)
    } catch (error) {
      flashError(error, 'Copy failed')
    }
  }

  function flash(message: string): void {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 1800)
  }

  function flashError(error: unknown, fallback: string): void {
    flash(error instanceof Error ? error.message : fallback)
  }

  return (
    <main className="app-shell">
      <aside className="session-sidebar" aria-label="Session Library">
        <div className="sidebar-title">
          <Archive size={18} />
          <span>qa-scribe</span>
        </div>

        <button className="primary-command" onClick={createSession} type="button">
          <Plus size={17} />
          New Session
        </button>

        <div className="session-list">
          {sessions.map((session) => (
            <button
              className={session.id === snapshot?.session.id ? 'session-row selected' : 'session-row'}
              key={session.id}
              onClick={() => openSession(session.id)}
              type="button"
            >
              <span>{session.title}</span>
              <small>{session.testTarget || 'No target'}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        {snapshot ? (
          <>
            <header className="topbar">
              <div>
                <h1>{snapshot.session.title}</h1>
                <p>{snapshot.session.testTarget || 'Set a Test Target before capture'}</p>
              </div>
              <div className="topbar-actions">
                <StatusPill providerStatus={providerStatus} />
                <button className="primary-command" type="button" onClick={openGenerationReview}>
                  <Sparkles size={16} />
                  Generate Testware
                </button>
                <button className="secondary-command" type="button" onClick={() => exportSession('markdown')}>
                  <FileText size={16} />
                  Export MD
                </button>
                <button className="secondary-command" type="button" onClick={() => exportSession('json')}>
                  <FileJson size={16} />
                  Export JSON
                </button>
              </div>
            </header>

            <section className="metadata-strip">
              <TextField
                label="Title"
                value={sessionDraft.title ?? ''}
                onChange={(value) => setSessionDraft({ ...sessionDraft, title: value })}
              />
              <TextField
                label="Test Target"
                value={sessionDraft.testTarget ?? ''}
                onChange={(value) => setSessionDraft({ ...sessionDraft, testTarget: value })}
              />
              <TextField
                label="Environment"
                value={sessionDraft.environment ?? ''}
                onChange={(value) => setSessionDraft({ ...sessionDraft, environment: value })}
              />
              <TextField
                label="Build"
                value={sessionDraft.buildVersion ?? ''}
                onChange={(value) => setSessionDraft({ ...sessionDraft, buildVersion: value })}
              />
              <button className="icon-command confirmed" title="Save session" type="button" onClick={saveSession}>
                <Check size={17} />
              </button>
            </section>

            <section className="detail-grid">
              <div className="timeline-pane">
                <ModeTabs mode={workspaceMode} setMode={setWorkspaceMode} />

                {workspaceMode === 'capture' ? (
                  <CapturePane
                    entryBody={entryBody}
                    entryTitle={entryTitle}
                    entryType={entryType}
                    filter={filter}
                    filteredEntries={filteredEntries}
                    query={query}
                    selectedEntryId={selectedEntryId}
                    snapshot={snapshot}
                    setEntryBody={setEntryBody}
                    setEntryTitle={setEntryTitle}
                    setEntryType={setEntryType}
                    setFilter={setFilter}
                    setQuery={setQuery}
                    onAddEntry={addEntry}
                    onAttach={importAttachment}
                    onCreateFinding={createFindingFromEntry}
                    onDelete={deleteEntry}
                    onSelect={setSelectedEntryId}
                    onToggleExclude={toggleGenerationExclusion}
                  />
                ) : null}

                {workspaceMode === 'generation' ? (
                  <GenerationReviewPane
                    busy={busy}
	                    findings={findings}
	                    generating={generating}
	                    providerStatus={providerStatus}
	                    rows={contextRows}
	                    sessionAttachments={sessionLevelAttachments}
	                    session={snapshot.session}
	                    onGenerate={generateTestware}
	                    onToggleEntry={toggleReviewedEntry}
                  />
                ) : null}

                {workspaceMode === 'drafts' ? (
                  <DraftsPane
                    draft={
                      draft ??
                      createLocalReviewDraft(
                        snapshot,
                        findings,
                        contextRows.filter((row) => row.included)
                      )
                    }
                    findings={findings}
                    onCopy={copyText}
                    onSave={saveDraft}
                    onUpdateContent={(content) => void updateDraftContent(content)}
                  />
                ) : null}
              </div>

              <aside className="inspector" aria-label="Inspector">
                <div className="inspector-title">
                  <PanelRightOpen size={17} />
                  <span>Inspector</span>
                </div>
                {selectedEntry ? (
                  <EntryInspector
                    attachments={snapshot.attachments.filter((attachment) => attachment.entryId === selectedEntry.id)}
                    entry={selectedEntry}
                    findings={findings.filter((finding) => finding.evidenceEntryIds.includes(selectedEntry.id))}
                    onAttach={() => importAttachment(selectedEntry.id)}
                    onCreateFinding={() => createFindingFromEntry(selectedEntry)}
                  />
                ) : (
                  <SessionInspector
                    draft={sessionDraft}
                    setDraft={setSessionDraft}
                    attachmentCount={snapshot.attachments.length}
                    findingCount={findings.length}
                    onDelete={deleteCurrentSession}
                  />
                )}
              </aside>
            </section>
          </>
        ) : (
          <section className="launch-state">
            <div>
              <h1>qa-scribe</h1>
              <p>Start a local testing Session and capture the raw material while it is still fresh.</p>
              <button className="primary-command fit" onClick={createSession} type="button">
                {busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
                New Session
              </button>
            </div>
          </section>
        )}
      </section>

      {notice ? <div className="toast">{notice}</div> : null}
    </main>
  )
}

function CapturePane(props: {
  snapshot: SessionSnapshot
  filteredEntries: Entry[]
  selectedEntryId: string | null
  query: string
  filter: EntryType | 'all'
  entryType: EntryType
  entryTitle: string
  entryBody: string
  setQuery: (value: string) => void
  setFilter: (value: EntryType | 'all') => void
  setEntryType: (value: EntryType) => void
  setEntryTitle: (value: string) => void
  setEntryBody: (value: string) => void
  onAddEntry: () => Promise<void>
  onAttach: (entryId?: string) => Promise<void>
  onSelect: (entryId: string) => void
  onDelete: (entry: Entry) => Promise<void>
  onToggleExclude: (entry: Entry) => Promise<void>
  onCreateFinding: (entry: Entry) => Promise<void>
}): ReactElement {
  return (
    <>
      <div className="timeline-tools">
        <label className="search-box">
          <Search size={15} />
          <input
            aria-label="Search Entries"
            placeholder="Search Entries"
            value={props.query}
            onChange={(event) => props.setQuery(event.target.value)}
          />
        </label>
        <label className="select-box">
          <Filter size={15} />
          <select
            aria-label="Filter by Entry type"
            value={props.filter}
            onChange={(event) => props.setFilter(event.target.value as EntryType | 'all')}
          >
            <option value="all">All types</option>
            {entryTypes.map((type) => (
              <option value={type.value} key={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
        <button className="secondary-command compact" type="button" onClick={() => props.onAttach()}>
          <ImagePlus size={16} />
          Attach
        </button>
      </div>

      <div className="timeline" aria-label="Session Timeline">
        {props.filteredEntries.length === 0 ? (
          <div className="empty-state">
            <Clipboard size={34} />
            <h2>No Entries yet</h2>
            <p>Capture notes, observations, API responses, logs, and possible Findings as they happen.</p>
          </div>
        ) : (
          props.filteredEntries.map((entry) => (
            <TimelineEntry
              attachments={props.snapshot.attachments.filter((attachment) => attachment.entryId === entry.id)}
              entry={entry}
              key={entry.id}
              onAttach={() => props.onAttach(entry.id)}
              onCreateFinding={() => props.onCreateFinding(entry)}
              onDelete={() => props.onDelete(entry)}
              onSelect={() => props.onSelect(entry.id)}
              onToggleExclude={() => props.onToggleExclude(entry)}
              selected={props.selectedEntryId === entry.id}
            />
          ))
        )}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          void props.onAddEntry()
        }}
      >
        <div className="composer-header">
          <select value={props.entryType} onChange={(event) => props.setEntryType(event.target.value as EntryType)}>
            {entryTypes.map((type) => (
              <option value={type.value} key={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <input
            placeholder="Optional title"
            value={props.entryTitle}
            onChange={(event) => props.setEntryTitle(event.target.value)}
          />
        </div>
        <textarea
          placeholder="Capture what happened..."
          value={props.entryBody}
          onChange={(event) => props.setEntryBody(event.target.value)}
        />
        <div className="composer-actions">
          <span>{props.snapshot.entries.length} Entries</span>
          <button className="primary-command fit" disabled={props.entryBody.trim().length === 0} type="submit">
            <Plus size={16} />
            Add Entry
          </button>
        </div>
      </form>
    </>
  )
}

function ModeTabs(props: { mode: WorkspaceMode; setMode: (mode: WorkspaceMode) => void }): ReactElement {
  return (
    <nav className="mode-tabs" aria-label="Workspace mode">
      <button className={props.mode === 'capture' ? 'selected' : ''} type="button" onClick={() => props.setMode('capture')}>
        Capture
      </button>
      <button
        className={props.mode === 'generation' ? 'selected' : ''}
        type="button"
        onClick={() => props.setMode('generation')}
      >
        Generation Context
      </button>
      <button className={props.mode === 'drafts' ? 'selected' : ''} type="button" onClick={() => props.setMode('drafts')}>
        Drafts
      </button>
    </nav>
  )
}

function GenerationReviewPane(props: {
  session: Session
  rows: ContextRow[]
  sessionAttachments: Attachment[]
  findings: Finding[]
  providerStatus: ProviderStatus | null
  busy: boolean
  generating: boolean
  onToggleEntry: (row: ContextRow) => Promise<void>
  onGenerate: () => Promise<void>
}): ReactElement {
  const includedRows = props.rows.filter((row) => row.included)
  const excludedRows = props.rows.filter((row) => !row.included)
  const includedAttachments = [...includedRows.flatMap((row) => row.attachments), ...props.sessionAttachments]

  return (
    <section className="review-pane">
      <div className="review-header">
        <div>
          <span className="eyebrow">Review before provider call</span>
          <h2>Generation Context</h2>
          <p>
            {includedRows.length} included Entries, {excludedRows.length} excluded, {includedAttachments.length} included
            attachments, {props.findings.length} Findings.
          </p>
        </div>
        <button
          className="primary-command"
          disabled={props.generating || props.busy || includedRows.length === 0}
          type="button"
          onClick={() => void props.onGenerate()}
        >
          {props.generating ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
          Generate
        </button>
      </div>

      <div className="context-summary">
        <SummaryItem label="Session" value={props.session.title} />
        <SummaryItem label="Target" value={props.session.testTarget || 'Not set'} />
        <SummaryItem label="Provider" value={props.providerStatus?.configured ? props.providerStatus.model || 'Configured' : 'Offline'} />
      </div>

      <div className="review-columns">
        <ReviewList title="Included" rows={includedRows} empty="No Entries included." onToggleEntry={props.onToggleEntry} />
        <ReviewList title="Excluded" rows={excludedRows} empty="No Entries excluded." onToggleEntry={props.onToggleEntry} />
      </div>

      <section className="finding-strip">
        <div className="section-heading">
          <ImagePlus size={16} />
          <h3>Session attachments in context</h3>
        </div>
        <AttachmentList attachments={props.sessionAttachments} />
      </section>

      <section className="finding-strip">
        <div className="section-heading">
          <Bug size={16} />
          <h3>Findings in context</h3>
        </div>
        {props.findings.length === 0 ? (
          <p className="muted">No Findings created yet.</p>
        ) : (
          props.findings.map((finding) => (
            <article className="finding-row" key={finding.id}>
              <strong>{finding.title}</strong>
              <span>{finding.summary}</span>
              <small>{finding.evidenceEntryIds.length} linked Entries</small>
            </article>
          ))
        )}
      </section>
    </section>
  )
}

function DraftsPane(props: {
  draft: ReviewDraft
  findings: Finding[]
  onUpdateContent: (content: string) => void
  onSave: () => Promise<void>
  onCopy: (text: string, message?: string) => Promise<void>
}): ReactElement {
  return (
    <section className="drafts-pane">
      <div className="draft-editor">
        <div className="review-header">
          <div>
            <span className="eyebrow">Editable Draft</span>
            <h2>{props.draft.title}</h2>
          </div>
          <div className="topbar-actions">
            <button className="secondary-command" type="button" onClick={() => props.onCopy(props.draft.content, 'Report copied')}>
              <Copy size={16} />
              Copy Report
            </button>
            <button className="primary-command" type="button" onClick={() => void props.onSave()}>
              <Check size={16} />
              Save Draft
            </button>
          </div>
        </div>
        <textarea
          aria-label="Session Report Draft"
          value={props.draft.content}
          onChange={(event) => props.onUpdateContent(event.target.value)}
        />
      </div>

      <div className="jira-drafts">
        <div className="section-heading">
          <Bug size={16} />
          <h3>Jira Bug Drafts</h3>
        </div>
        {props.draft.jiraBugDrafts.length === 0 && props.findings.length === 0 ? (
          <p className="muted">Create Findings to prepare copy-friendly bug sections.</p>
        ) : null}
        {(props.draft.jiraBugDrafts.length > 0 ? props.draft.jiraBugDrafts : props.findings.map(jiraDraftFromFinding)).map(
          (jiraDraft) => (
            <article className="jira-draft" key={jiraDraft.id}>
              <div className="jira-draft-title">
                <strong>{jiraDraft.title}</strong>
                <button
                  className="icon-command"
                  title="Copy Jira bug draft"
                  type="button"
                  onClick={() => props.onCopy(formatJiraDraft(jiraDraft), 'Jira draft copied')}
                >
                  <Copy size={15} />
                </button>
              </div>
              <dl>
                <dt>Description</dt>
                <dd>{jiraDraft.description}</dd>
                <dt>Steps</dt>
                <dd>{jiraDraft.steps}</dd>
                <dt>Expected</dt>
                <dd>{jiraDraft.expected}</dd>
                <dt>Actual</dt>
                <dd>{jiraDraft.actual}</dd>
                <dt>Evidence</dt>
                <dd>{jiraDraft.evidence}</dd>
              </dl>
            </article>
          )
        )}
      </div>
    </section>
  )
}

function ReviewList(props: {
  title: string
  rows: ContextRow[]
  empty: string
  onToggleEntry: (row: ContextRow) => Promise<void>
}): ReactElement {
  return (
    <section className="review-list">
      <h3>{props.title}</h3>
      {props.rows.length === 0 ? <p className="muted">{props.empty}</p> : null}
      {props.rows.map((row) => (
        <article className="context-entry" key={row.entry.id}>
          <div>
            <span className="eyebrow">{formatEntryType(row.entry.type)}</span>
            <strong>{row.entry.title || firstLine(row.entry.body) || 'Untitled Entry'}</strong>
            <p>{row.entry.body}</p>
          </div>
          <div className="context-entry-footer">
            <span>{row.attachments.length} attachments</span>
            <button className="secondary-command compact" type="button" onClick={() => void props.onToggleEntry(row)}>
              {row.included ? 'Exclude' : 'Include'}
            </button>
          </div>
        </article>
      ))}
    </section>
  )
}

function TextField(props: { label: string; value: string; onChange: (value: string) => void }): ReactElement {
  return (
    <label className="field">
      <span>{props.label}</span>
      <input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
    </label>
  )
}

function SummaryItem(props: { label: string; value: string }): ReactElement {
  return (
    <div>
      <span className="eyebrow">{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

function StatusPill({ providerStatus }: { providerStatus: ProviderStatus | null }): ReactElement {
  return (
    <div className={providerStatus?.configured ? 'status-pill ready' : 'status-pill'}>
      <Bot size={15} />
      <span>{providerStatus?.configured ? providerStatus.model : 'AI offline'}</span>
    </div>
  )
}

function TimelineEntry(props: {
  entry: Entry
  attachments: Attachment[]
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onAttach: () => void
  onToggleExclude: () => void
  onCreateFinding: () => void
}): ReactElement {
  return (
    <article className={props.selected ? 'timeline-entry selected' : 'timeline-entry'} onClick={props.onSelect}>
      <div className="entry-marker">
        <span>{formatEntryType(props.entry.type)}</span>
        <time>{formatTime(props.entry.createdAt)}</time>
      </div>
      <div className="entry-body">
        <div className="entry-heading">
          <h2>{props.entry.title || formatEntryType(props.entry.type)}</h2>
          <div className="entry-actions">
            <button type="button" title="Create Finding" onClick={stopAnd(props.onCreateFinding)}>
              <Bug size={15} />
            </button>
            <button type="button" title="Attach evidence" onClick={stopAnd(props.onAttach)}>
              <ImagePlus size={15} />
            </button>
            <button type="button" title="Toggle generation inclusion" onClick={stopAnd(props.onToggleExclude)}>
              <Bot size={15} />
            </button>
            <button type="button" title="Delete Entry" onClick={stopAnd(props.onDelete)}>
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        <p>{props.entry.body}</p>
        <div className="entry-footer">
          {props.entry.excludedFromGeneration ? <span>Excluded from generation</span> : <span>Included for generation</span>}
          {props.attachments.length > 0 ? <span>{props.attachments.length} attachments</span> : null}
        </div>
      </div>
    </article>
  )
}

function EntryInspector(props: {
  entry: Entry
  attachments: Attachment[]
  findings: Finding[]
  onAttach: () => void
  onCreateFinding: () => void
}): ReactElement {
  return (
    <div className="inspector-stack">
      <div>
        <span className="eyebrow">{formatEntryType(props.entry.type)}</span>
        <h2>{props.entry.title || 'Untitled Entry'}</h2>
      </div>
      <dl>
        <dt>Created</dt>
        <dd>{new Date(props.entry.createdAt).toLocaleString()}</dd>
        <dt>Generation</dt>
        <dd>{props.entry.excludedFromGeneration ? 'Excluded' : 'Included'}</dd>
        <dt>Findings</dt>
        <dd>{props.findings.length}</dd>
      </dl>
      <div className="button-row">
        <button className="secondary-command fit" type="button" onClick={props.onCreateFinding}>
          <Bug size={16} />
          Create Finding
        </button>
        <button className="secondary-command fit" type="button" onClick={props.onAttach}>
          <ImagePlus size={16} />
          Attach Evidence
        </button>
      </div>
      <AttachmentList attachments={props.attachments} />
      <FindingList findings={props.findings} />
    </div>
  )
}

function SessionInspector(props: {
  draft: SessionDraft
  setDraft: (draft: SessionDraft) => void
  attachmentCount: number
  findingCount: number
  onDelete: () => void
}): ReactElement {
  return (
    <div className="inspector-stack">
      <label className="field tall">
        <span>Charter</span>
        <textarea
          value={props.draft.charter ?? ''}
          onChange={(event) => props.setDraft({ ...props.draft, charter: event.target.value })}
        />
      </label>
      <label className="field">
        <span>Related Reference</span>
        <input
          value={props.draft.relatedReference ?? ''}
          onChange={(event) => props.setDraft({ ...props.draft, relatedReference: event.target.value })}
        />
      </label>
      <dl>
        <dt>Attachments</dt>
        <dd>{props.attachmentCount}</dd>
        <dt>Findings</dt>
        <dd>{props.findingCount}</dd>
      </dl>
      <button className="danger-command fit" type="button" onClick={props.onDelete}>
        <Trash2 size={16} />
        Delete Session
      </button>
    </div>
  )
}

function AttachmentList({ attachments }: { attachments: Attachment[] }): ReactElement {
  if (attachments.length === 0) return <p className="muted">No evidence attached.</p>
  return (
    <ul className="attachment-list">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <span>{attachment.filename}</span>
          <small>{Math.ceil(attachment.sizeBytes / 1024)} KB</small>
        </li>
      ))}
    </ul>
  )
}

function FindingList({ findings }: { findings: Finding[] }): ReactElement {
  if (findings.length === 0) return <p className="muted">No Findings linked.</p>
  return (
    <div className="finding-list">
      {findings.map((finding) => (
        <article className="finding-row" key={finding.id}>
          <strong>{finding.title}</strong>
          <span>{finding.summary}</span>
          <small>{finding.evidenceEntryIds.length} linked Entries</small>
        </article>
      ))}
    </div>
  )
}

function normalizeContextRows(context: GenerationContextReview | null, snapshot: SessionSnapshot): ContextRow[] {
  const rows = context?.entries.map((item) => ({
    entry: item.entry,
    included: item.included,
    attachments: item.attachments
  }))

  if (rows && rows.length > 0) return rows

  return snapshot.entries.map((entry) => ({
    entry,
    included: !entry.excludedFromGeneration,
    attachments: snapshot.attachments.filter((attachment) => attachment.entryId === entry.id)
  }))
}

function normalizeFinding(
  value: StoredFinding,
  evidenceLinks: EvidenceLink[]
): Finding {
  const linkedEvidence = evidenceLinks.filter((link) => link.findingId === value.id)

  return {
    id: value.id,
    sessionId: value.sessionId,
    title: value.title,
    summary: value.body,
    severity: value.kind,
    status: 'draft',
    evidenceEntryIds: linkedEvidence.map((link) => link.entryId).filter((entryId): entryId is string => entryId !== null),
    evidenceAttachmentIds: linkedEvidence
      .map((link) => link.attachmentId)
      .filter((attachmentId): attachmentId is string => attachmentId !== null),
    createdAt: value.createdAt
  }
}

function normalizeDraft(value: Draft | undefined): ReviewDraft | null {
  if (!value) return null
  return {
    id: value.id,
    sessionId: value.sessionId,
    title: value.title,
    content: value.body,
    jiraBugDrafts: jiraDraftsFromMarkdown(value.body),
    updatedAt: value.updatedAt
  }
}

function createLocalReviewDraft(snapshot: SessionSnapshot, findings: Finding[], rows: ContextRow[]): ReviewDraft {
  const includedRows = rows.length > 0 ? rows : normalizeContextRows(null, snapshot).filter((row) => row.included)
  return {
    id: `local-draft-${snapshot.session.id}`,
    sessionId: snapshot.session.id,
    title: 'Session Report Draft',
    content: [
      `# ${snapshot.session.title}`,
      '',
      `Test Target: ${snapshot.session.testTarget || 'Not set'}`,
      `Environment: ${snapshot.session.environment || 'Not set'}`,
      `Build: ${snapshot.session.buildVersion || 'Not set'}`,
      '',
      '## Charter',
      snapshot.session.charter || 'Not set',
      '',
      '## What Was Tested',
      includedRows.map((row) => `- ${row.entry.title || firstLine(row.entry.body) || formatEntryType(row.entry.type)}`).join('\n') ||
        '- Not drafted yet',
      '',
      '## Findings',
      findings.map((finding) => `- ${finding.title}: ${finding.summary}`).join('\n') || '- No Findings recorded.',
      '',
      '## Open Questions',
      '- Review and edit before sharing.',
      '',
      '## Follow-up Actions',
      '- Review evidence links and Jira bug drafts.'
    ].join('\n'),
    jiraBugDrafts: findings.map(jiraDraftFromFinding),
    updatedAt: new Date().toISOString()
  }
}

function draftFromGenerationResult(result: unknown, snapshot: SessionSnapshot, findings: Finding[]): ReviewDraft {
  if (typeof result === 'string') {
    return {
      ...createLocalReviewDraft(snapshot, findings, []),
      content: result,
      updatedAt: new Date().toISOString()
    }
  }

  if (!isRecord(result)) return createLocalReviewDraft(snapshot, findings, [])

  const draftRecord = isRecord(result.draft) ? result.draft : result
  const content =
    stringFromUnknown(draftRecord.content) ??
    stringFromUnknown(draftRecord.body) ??
    stringFromUnknown(draftRecord.markdown) ??
    stringFromUnknown(draftRecord.sessionReportDraft) ??
    createLocalReviewDraft(snapshot, findings, []).content

  return {
    id: stringFromUnknown(draftRecord.id) ?? `local-draft-${snapshot.session.id}`,
    sessionId: snapshot.session.id,
    title: stringFromUnknown(draftRecord.title) ?? 'Session Report Draft',
    content,
    jiraBugDrafts: jiraDraftsFromUnknown(draftRecord.jiraBugDrafts ?? result.jiraBugDrafts, findings),
    updatedAt: stringFromUnknown(draftRecord.updatedAt) ?? new Date().toISOString()
  }
}

function jiraDraftsFromUnknown(value: unknown, findings: Finding[]): JiraBugDraft[] {
  if (!Array.isArray(value)) return findings.map(jiraDraftFromFinding)
  const drafts = value.map(jiraDraftFromUnknown).filter((draft): draft is JiraBugDraft => draft !== null)
  return drafts.length > 0 ? drafts : findings.map(jiraDraftFromFinding)
}

function jiraDraftsFromMarkdown(markdown: string): JiraBugDraft[] {
  const section = markdown.split('## Jira Bug Drafts')[1]
  if (!section) return []

  return section
    .split('\n### ')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [rawTitle, ...bodyLines] = chunk.split('\n')
      const title = rawTitle.replace(/^###\s*/, '').trim()
      if (!title || title === 'None recorded.') return null
      const body = bodyLines.join('\n').trim()
      return {
        id: `jira-${title}`,
        title,
        description: body || title,
        steps: sectionValue(body, 'Steps to Reproduce'),
        expected: sectionValue(body, 'Expected Result') || sectionValue(body, 'Expected'),
        actual: sectionValue(body, 'Actual Result') || sectionValue(body, 'Actual'),
        evidence: sectionValue(body, 'Evidence')
      }
    })
    .filter((draft): draft is JiraBugDraft => draft !== null)
}

function sectionValue(markdown: string, label: string): string {
  const marker = `**${label}`
  const start = markdown.indexOf(marker)
  if (start < 0) return ''
  const after = markdown.slice(start).split('\n').slice(1).join('\n').trim()
  return after.split('\n**')[0]?.trim() ?? ''
}

function jiraDraftFromUnknown(value: unknown): JiraBugDraft | null {
  if (!isRecord(value)) return null
  const title = stringFromUnknown(value.title) ?? stringFromUnknown(value.summary)
  if (!title) return null
  return {
    id: stringFromUnknown(value.id) ?? `jira-${title}`,
    title,
    description: stringFromUnknown(value.description) ?? stringFromUnknown(value.body) ?? '',
    steps: stringFromUnknown(value.steps) ?? stringFromUnknown(value.reproductionSteps) ?? '',
    expected: stringFromUnknown(value.expected) ?? stringFromUnknown(value.expectedResult) ?? '',
    actual: stringFromUnknown(value.actual) ?? stringFromUnknown(value.actualResult) ?? '',
    evidence: stringFromUnknown(value.evidence) ?? ''
  }
}

function jiraDraftFromFinding(finding: Finding): JiraBugDraft {
  return {
    id: `jira-${finding.id}`,
    title: finding.title,
    description: finding.summary,
    steps: '1. Review linked evidence and fill exact reproduction steps.',
    expected: 'Expected result not drafted yet.',
    actual: finding.summary,
    evidence: [
      finding.evidenceEntryIds.length > 0 ? `Entries: ${finding.evidenceEntryIds.join(', ')}` : '',
      finding.evidenceAttachmentIds.length > 0 ? `Attachments: ${finding.evidenceAttachmentIds.join(', ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  }
}

function formatJiraDraft(draft: JiraBugDraft): string {
  return [
    `Title: ${draft.title}`,
    '',
    `Description:\n${draft.description}`,
    '',
    `Steps to Reproduce:\n${draft.steps}`,
    '',
    `Expected:\n${draft.expected}`,
    '',
    `Actual:\n${draft.actual}`,
    '',
    `Evidence:\n${draft.evidence}`
  ].join('\n')
}

function stopAnd(callback: () => void): (event: MouseEvent<HTMLButtonElement>) => void {
  return (event) => {
    event.stopPropagation()
    callback()
  }
}

function firstLine(value: string): string {
  return value.split('\n')[0]?.slice(0, 96) ?? ''
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatEntryType(type: EntryType): string {
  return entryTypes.find((entryType) => entryType.value === type)?.label ?? type
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
