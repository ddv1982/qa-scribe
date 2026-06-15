import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Archive, Check, FileJson, FileText, Loader2, PanelRightOpen, Plus, Sparkles } from 'lucide-react'
import { validateSessionRequirements } from '../../shared/contracts'
import type {
  Entry,
  EntryType,
  AiProviderId,
  GenerationContextReview,
  ProviderStatus,
  ReasoningEffort,
  Session,
  SessionDraft,
  SessionRequirementKey,
  SessionSnapshot
} from '../../shared/contracts'
import {
  CapturePane,
  DraftsPane,
  EntryInspector,
  GenerationReviewPane,
  ModeTabs,
  SessionInspector,
  StatusPill,
  TextField
} from './components/AppSections'
import { buildGenerationOptions, normalizeContextRows } from './domain/generation'
import {
  createLocalReviewDraft,
  draftFromGenerationResult,
  normalizeDraft,
  normalizeFinding
} from './domain/reviewDrafts'
import {
  createEmptyStructuredFindingDraft,
  createStructuredFindingDetails,
  renderStructuredFindingBody,
  serializeStructuredFindingDetails
} from './domain/findingDetails'
import { formatEntryType } from './domain/formatters'
import { emptyDraft, hasSessionOptionalDetails } from './domain/session'
import type {
  CaptureMode,
  ContextAttachment,
  ContextRow,
  Finding,
  ReviewDraft,
  StructuredFindingDraft,
  WorkspaceMode
} from './domain/types'

export function App(): ReactElement {
  const [sessions, setSessions] = useState<Session[]>([])
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>(emptyDraft)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('note')
  const [entryTitle, setEntryTitle] = useState('')
  const [entryBody, setEntryBody] = useState('')
  const [entryMetadataJson, setEntryMetadataJson] = useState<string | null>(null)
  const [richTextResetKey, setRichTextResetKey] = useState(0)
  const [findingDraft, setFindingDraft] = useState<StructuredFindingDraft>(createEmptyStructuredFindingDraft)
  const [filter, setFilter] = useState<EntryType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('capture')
  const [sessionRequirementErrors, setSessionRequirementErrors] = useState<SessionRequirementKey[]>([])
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false)
  const [generationContext, setGenerationContext] = useState<GenerationContextReview | null>(null)
  const [generationContextId, setGenerationContextId] = useState<string | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [draft, setDraft] = useState<ReviewDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    void bootstrap()
    return () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    }
  }, [])

  const selectedEntry = snapshot?.entries.find((entry) => entry.id === selectedEntryId) ?? null
  const hasOptionalDetails = hasSessionOptionalDetails(sessionDraft)
  const availableProviders = useMemo(() => providerStatus?.providers.filter((provider) => provider.available) ?? [], [providerStatus])
  const selectedProviderStatus = useMemo(
    () => availableProviders.find((provider) => provider.provider === selectedProvider) ?? null,
    [availableProviders, selectedProvider]
  )

  useEffect(() => {
    if (!providerStatus) return
    const lastProvider = window.localStorage.getItem('qa-scribe:last-provider')
    const nextProvider =
      availableProviders.find((provider) => provider.provider === lastProvider)?.provider ??
      availableProviders.find((provider) => provider.provider === providerStatus.selectedProvider)?.provider ??
      availableProviders[0]?.provider ??
      null
    setSelectedProvider((current) =>
      current && availableProviders.some((provider) => provider.provider === current) ? current : nextProvider
    )
  }, [availableProviders, providerStatus])

  useEffect(() => {
    if (!selectedProviderStatus) {
      setSelectedModel('')
      setSelectedReasoningEffort(null)
      return
    }

    const lastProvider = window.localStorage.getItem('qa-scribe:last-provider')
    const lastModel = window.localStorage.getItem('qa-scribe:last-model')
    const preferredModel =
      lastProvider === selectedProviderStatus.provider && lastModel
        ? lastModel
        : providerStatus?.selectedProvider === selectedProviderStatus.provider
          ? providerStatus.selectedModel
          : null
    const nextModel = preferredModel ?? selectedProviderStatus.defaultModel ?? selectedProviderStatus.models[0] ?? ''
    setSelectedModel(nextModel)

    if (selectedProviderStatus.reasoningEfforts.length === 0) {
      setSelectedReasoningEffort(null)
      return
    }
    const lastReasoningEffort = window.localStorage.getItem('qa-scribe:last-reasoning-effort') as ReasoningEffort | null
    const preferredReasoningEffort =
      lastProvider === selectedProviderStatus.provider && lastReasoningEffort
        ? lastReasoningEffort
        : providerStatus?.selectedProvider === selectedProviderStatus.provider
          ? providerStatus.selectedReasoningEffort
          : null
    const nextReasoningEffort =
      preferredReasoningEffort && selectedProviderStatus.reasoningEfforts.includes(preferredReasoningEffort)
        ? preferredReasoningEffort
        : selectedProviderStatus.defaultReasoningEffort ?? selectedProviderStatus.reasoningEfforts[0] ?? null
    setSelectedReasoningEffort(nextReasoningEffort)
  }, [providerStatus, selectedProviderStatus])

  useEffect(() => {
    if (!selectedProvider) return
    window.localStorage.setItem('qa-scribe:last-provider', selectedProvider)
  }, [selectedProvider])

  useEffect(() => {
    if (selectedModel.trim().length === 0) return
    window.localStorage.setItem('qa-scribe:last-model', selectedModel.trim())
  }, [selectedModel])

  useEffect(() => {
    if (selectedReasoningEffort) {
      window.localStorage.setItem('qa-scribe:last-reasoning-effort', selectedReasoningEffort)
    } else {
      window.localStorage.removeItem('qa-scribe:last-reasoning-effort')
    }
  }, [selectedReasoningEffort])

  useEffect(() => {
    if (hasOptionalDetails) setMoreDetailsOpen(true)
  }, [hasOptionalDetails])

  const contextRows = useMemo(() => {
    if (!snapshot) return []
    return normalizeContextRows(generationContext, snapshot)
  }, [generationContext, snapshot])

  const sessionLevelAttachments = useMemo(() => {
    if (!snapshot) return []
    return (
      generationContext?.attachments ??
      snapshot.attachments
        .filter((attachment) => attachment.entryId === null)
        .map((attachment) => ({ attachment, included: true }))
    )
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
    const nextDraft = {
      title: next.session.title,
      testTarget: next.session.testTarget ?? '',
      charter: next.session.charter ?? '',
      environment: next.session.environment ?? '',
      buildVersion: next.session.buildVersion ?? '',
      relatedReference: next.session.relatedReference ?? ''
    }
    setSnapshot(next)
    setSessionDraft(nextDraft)
    setSessionRequirementErrors([])
    setMoreDetailsOpen(hasSessionOptionalDetails(nextDraft))
    setSelectedEntryId(null)
    setGenerationContext(null)
    setGenerationContextId(null)
    resetCaptureDrafts()
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
    if (!validateSessionDraftForAction()) return
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
    resetCaptureDrafts()
    await bootstrap()
  }

  function resetCaptureDrafts(): void {
    setEntryTitle('')
    setEntryBody('')
    setEntryMetadataJson(null)
    setFindingDraft(createEmptyStructuredFindingDraft())
    setRichTextResetKey((current) => current + 1)
  }

  async function addEntry(): Promise<void> {
    if (!snapshot || entryBody.trim().length === 0) return
    try {
      await window.qaScribe.createEntry({
        sessionId: snapshot.session.id,
        type: 'note',
        title: entryTitle,
        body: entryBody,
        metadataJson: entryMetadataJson
      })
      resetCaptureDrafts()
      await openSession(snapshot.session.id)
    } catch (error) {
      flashError(error, 'Entry could not be saved')
    }
  }

  function updateFindingDraft(patch: Partial<StructuredFindingDraft>): void {
    setFindingDraft((current) => ({ ...current, ...patch }))
  }

  async function addFinding(): Promise<void> {
    if (!snapshot) return
    const details = createStructuredFindingDetails(findingDraft, snapshot.session)
    const selectedEvidenceEntry = findingDraft.linkSelectedEntry ? selectedEntry : null
    const linkedAttachments = selectedEvidenceEntry
      ? snapshot.attachments.filter((attachment) => attachment.entryId === selectedEvidenceEntry.id)
      : []
    if (findingDraft.title.trim().length === 0 || details.actual.length === 0) return

    try {
      const storedFinding = await window.qaScribe.createFinding({
        sessionId: snapshot.session.id,
        title: findingDraft.title.trim(),
        body: renderStructuredFindingBody(details),
        kind: 'bug',
        metadataJson: serializeStructuredFindingDetails(details),
        entryId: selectedEvidenceEntry?.id
      })

      for (const attachment of linkedAttachments) {
        await window.qaScribe.createEvidenceLink({ findingId: storedFinding.id, attachmentId: attachment.id })
      }

      setFindingDraft(createEmptyStructuredFindingDraft())
      await openSession(snapshot.session.id)
      if (selectedEvidenceEntry) setSelectedEntryId(selectedEvidenceEntry.id)
      flash('Finding created')
    } catch (error) {
      flashError(error, 'Finding could not be saved')
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
    flash('Generation Context is still loading')
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
    if (!validateSessionDraftForAction()) return
    setWorkspaceMode('generation')
    if (generationContextId) return
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
    try {
      const storedFinding = await window.qaScribe.createFinding({
        sessionId: snapshot.session.id,
        title: entry.title || formatEntryType(entry.type),
        body: entry.body,
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

  async function toggleReviewedAttachment(item: ContextAttachment): Promise<void> {
    if (!generationContextId) return
    const nextContext = await window.qaScribe.updateGenerationContextAttachment(
      generationContextId,
      item.attachment.id,
      !item.included
    )
    setGenerationContext(nextContext)
    setGenerationContextId(nextContext.context.id)
    flash(item.included ? 'Attachment excluded from context' : 'Attachment included in context')
  }

  async function generateTestware(): Promise<void> {
    if (!snapshot) return
    if (!validateSessionDraftForAction()) return
    const generationOptions = buildGenerationOptions(selectedProviderStatus, selectedModel, selectedReasoningEffort)
    if (!generationOptions) {
      flash('Select an available provider')
      return
    }
    setGenerating(true)
    try {
      let activeContextId = generationContextId
      if (!activeContextId) {
        const nextContext = await window.qaScribe.createGenerationContext(snapshot.session.id)
        setGenerationContext(nextContext)
        activeContextId = nextContext.context.id
        setGenerationContextId(activeContextId)
      }
      const result = await window.qaScribe.generateTestware(activeContextId, generationOptions)
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
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    setNotice(message)
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null)
      noticeTimerRef.current = null
    }, 1800)
  }

  function flashError(error: unknown, fallback: string): void {
    flash(error instanceof Error ? error.message : fallback)
  }

  function updateSessionDraft(patch: Partial<SessionDraft>): void {
    const nextDraft = { ...sessionDraft, ...patch }
    setSessionDraft(nextDraft)
    if (sessionRequirementErrors.length > 0) {
      setSessionRequirementErrors(validateSessionRequirements(nextDraft).missing)
    }
  }

  function validateSessionDraftForAction(): boolean {
    const result = validateSessionRequirements(sessionDraft)
    setSessionRequirementErrors(result.missing)
    if (!result.valid) flash('Complete required Session fields')
    return result.valid
  }

  function sessionFieldError(key: SessionRequirementKey): string | null {
    if (!sessionRequirementErrors.includes(key)) return null
    if (key === 'testObjective') return 'Test Objective is required.'
    if (key === 'testTarget') return 'Test Target is required.'
    return 'Title is required.'
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

            <section className="session-setup" aria-label="Session setup">
              <div className="session-required-fields">
                <TextField
                  error={sessionFieldError('title')}
                  label="Title"
                  required
                  value={sessionDraft.title ?? ''}
                  onChange={(value) => updateSessionDraft({ title: value })}
                />
                <TextField
                  error={sessionFieldError('testTarget')}
                  label="Test Target"
                  required
                  value={sessionDraft.testTarget ?? ''}
                  onChange={(value) => updateSessionDraft({ testTarget: value })}
                />
                <TextField
                  error={sessionFieldError('testObjective')}
                  label="Test Objective"
                  multiline
                  required
                  value={sessionDraft.charter ?? ''}
                  onChange={(value) => updateSessionDraft({ charter: value })}
                />
              </div>

              <details
                className="session-more-details"
                open={moreDetailsOpen}
                onToggle={(event) => setMoreDetailsOpen(event.currentTarget.open)}
              >
                <summary>Optional details</summary>
                <div className="session-optional-fields">
                  <TextField
                    label="Environment"
                    optional
                    value={sessionDraft.environment ?? ''}
                    onChange={(value) => updateSessionDraft({ environment: value })}
                  />
                  <TextField
                    label="Build"
                    optional
                    value={sessionDraft.buildVersion ?? ''}
                    onChange={(value) => updateSessionDraft({ buildVersion: value })}
                  />
                  <TextField
                    label="Related Reference"
                    optional
                    value={sessionDraft.relatedReference ?? ''}
                    onChange={(value) => updateSessionDraft({ relatedReference: value })}
                  />
                </div>
              </details>

              <div className="session-setup-actions">
                <button className="icon-command confirmed" title="Save session" type="button" onClick={saveSession}>
                  <Check size={17} />
                </button>
              </div>
            </section>

            <section className="detail-grid">
              <div className="timeline-pane">
                <ModeTabs mode={workspaceMode} setMode={setWorkspaceMode} onOpenGeneration={openGenerationReview} />

                {workspaceMode === 'capture' ? (
                  <CapturePane
                    captureMode={captureMode}
                    entryBody={entryBody}
                    entryMetadataJson={entryMetadataJson}
                    entryTitle={entryTitle}
                    findingDraft={findingDraft}
                    filter={filter}
                    filteredEntries={filteredEntries}
                    query={query}
                    richTextResetKey={richTextResetKey}
                    selectedEntry={selectedEntry}
                    selectedEntryId={selectedEntryId}
                    snapshot={snapshot}
                    setCaptureMode={setCaptureMode}
                    setEntryBody={setEntryBody}
                    setEntryMetadataJson={setEntryMetadataJson}
                    setEntryTitle={setEntryTitle}
                    setFilter={setFilter}
                    setQuery={setQuery}
                    onAddEntry={addEntry}
                    onAddFinding={addFinding}
                    onAttach={importAttachment}
                    onCreateFinding={createFindingFromEntry}
                    onDelete={deleteEntry}
                    onSelect={setSelectedEntryId}
                    onToggleExclude={toggleGenerationExclusion}
                    onUpdateFindingDraft={updateFindingDraft}
                  />
                ) : null}

                {workspaceMode === 'generation' ? (
                  <GenerationReviewPane
                    busy={busy}
                    findings={findings}
                    generating={generating}
                    contextReady={Boolean(generationContextId)}
                    providerStatus={providerStatus}
                    rows={contextRows}
                    selectedModel={selectedModel}
                    selectedProvider={selectedProvider}
                    selectedReasoningEffort={selectedReasoningEffort}
                    sessionAttachments={sessionLevelAttachments}
                    session={snapshot.session}
                    onGenerate={generateTestware}
                    onModelChange={setSelectedModel}
                    onProviderChange={setSelectedProvider}
                    onReasoningEffortChange={setSelectedReasoningEffort}
                    onToggleAttachment={toggleReviewedAttachment}
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
