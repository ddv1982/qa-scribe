import { useEffect, useState, type ClipboardEvent } from 'react'
import {
  createDraft,
  createEntry,
  createEvidenceLink,
  createFinding,
  createGenerationContext,
  createSession,
  exportSession,
  getAttachmentPreviewDataUrl,
  getAppStatus,
  getCommandShellStatus,
  getProviderStatus,
  getSettings,
  generateSessionReport,
  importAttachment,
  importClipboardScreenshot,
  listAttachments,
  listEntries,
  listDrafts,
  listFindings,
  listSessions,
  reopenSession,
  updateDraft,
  updateEntry,
  updateSettings,
  type Attachment,
  type AppSettings,
  type AppStatus,
  type CommandShellStatus,
  type Draft,
  type Entry,
  type EntryType,
  type AiProvider,
  type Finding,
  type GenerationContext,
  type ProviderStatus,
  type Session,
  type SessionExport,
} from './tauri'

const entryTypes: EntryType[] = ['note', 'observation', 'api_response', 'log', 'finding_candidate']

export function App() {
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null)
  const [shellStatus, setShellStatus] = useState<CommandShellStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [generationContext, setGenerationContext] = useState<GenerationContext | null>(null)
  const [sessionTitle, setSessionTitle] = useState('Exploratory checkout pass')
  const [sessionContext, setSessionContext] = useState('Feature, build, URL, API, or flow under test')
  const [objectiveNotes, setObjectiveNotes] = useState('What are we trying to learn or verify?')
  const [entryType, setEntryType] = useState<EntryType>('note')
  const [entryBody, setEntryBody] = useState('')
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [findingTitle, setFindingTitle] = useState('')
  const [attachmentSourcePath, setAttachmentSourcePath] = useState('')
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null)
  const [sessionExport, setSessionExport] = useState<SessionExport | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>('codex_cli')
  const [selectedModel, setSelectedModel] = useState('default')
  const [settingsPrompt, setSettingsPrompt] = useState('')
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null

  useEffect(() => {
    void refreshBootData()
  }, [])

  async function refreshBootData() {
    try {
      setBusyAction('loading')
      setError(null)
      const [nextAppStatus, nextShellStatus, nextSettings, nextProviderStatus, nextSessions] = await Promise.all([
        getAppStatus(),
        getCommandShellStatus(),
        getSettings(),
        getProviderStatus(),
        listSessions(),
      ])
      setAppStatus(nextAppStatus)
      setShellStatus(nextShellStatus)
      setSettings(nextSettings)
      setSettingsPrompt(nextSettings.generationSystemPrompt)
      setProviderStatus(nextProviderStatus)
      setSelectedProvider(nextProviderStatus.providers[0]?.id ?? 'codex_cli')
      setSessions(nextSessions)
      if (nextSessions[0]) await openSession(nextSessions[0])
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function openSession(session: Session) {
    try {
      setBusyAction('opening')
      setError(null)
      const reopened = await reopenSession(session.id)
      const [nextEntries, nextFindings, nextDrafts, nextAttachments] = await Promise.all([
        listEntries(session.id),
        listFindings(session.id),
        listDrafts(session.id),
        listAttachments(session.id),
      ])
      setActiveSession(reopened)
      setEntries(nextEntries)
      setFindings(nextFindings)
      setDrafts(nextDrafts)
      setAttachments(nextAttachments)
      setSelectedEntryId(nextEntries[0]?.id ?? null)
      setGenerationContext(null)
      setPreviewDataUrl(null)
      setSessionExport(null)
      setNotice(`Opened Session: ${reopened.title}`)
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCreateSession() {
    try {
      setBusyAction('session')
      setError(null)
      const session = await createSession({
        title: sessionTitle,
        sessionContext,
        objectiveNotes,
      })
      const nextSessions = await listSessions()
      setSessions(nextSessions)
      setActiveSession(session)
      setEntries([])
      setFindings([])
      setDrafts([])
      setAttachments([])
      setSelectedEntryId(null)
      setPreviewDataUrl(null)
      setSessionExport(null)
      setNotice('New Session ready for capture')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCreateEntry() {
    if (!activeSession || !entryBody.trim()) return
    try {
      setBusyAction('entry')
      setError(null)
      const entry = await createEntry({
        sessionId: activeSession.id,
        entryType,
        title: null,
        body: entryBody,
        metadataJson: null,
        excludedFromGeneration: false,
      })
      const nextEntries = await listEntries(activeSession.id)
      setEntries(nextEntries)
      setSelectedEntryId(entry.id)
      setEntryBody('')
      setNotice('Entry added to the Session Timeline')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCreateFinding() {
    if (!activeSession || !selectedEntry) return
    try {
      setBusyAction('finding')
      setError(null)
      const finding = await createFinding({
        sessionId: activeSession.id,
        title: findingTitle.trim() || selectedEntry.body.slice(0, 80),
        body: selectedEntry.body,
        kind: 'bug',
        metadataJson: null,
      })
      await createEvidenceLink({ findingId: finding.id, entryId: selectedEntry.id })
      setFindings(await listFindings(activeSession.id))
      setFindingTitle('')
      setNotice('Finding created and linked to Entry Evidence')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleGenerationDraft() {
    if (!activeSession) return
    try {
      setBusyAction('draft')
      setError(null)
      const context = await createGenerationContext(activeSession.id)
      await createDraft({
        sessionId: activeSession.id,
        aiRunId: null,
        kind: 'session_report',
        title: `${activeSession.title} Session Report Draft`,
        body: renderManualDraft(activeSession, entries, findings),
      })
      setGenerationContext(context)
      setDrafts(await listDrafts(activeSession.id))
      setNotice('Generation Context and editable Draft created')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleAiGeneration() {
    if (!activeSession) return
    try {
      setBusyAction('ai-generation')
      setError(null)
      const result = await generateSessionReport({
        sessionId: activeSession.id,
        provider: selectedProvider,
        model: selectedModel,
        reasoningEffort: null,
      })
      setGenerationContext(result.generationContext)
      if (result.draft) {
        setDrafts(await listDrafts(activeSession.id))
        setNotice('AI Session Report Draft generated locally')
      } else {
        setNotice(result.aiRun.errorMessage ?? 'AI provider command failed without creating a Draft')
      }
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveSettings() {
    if (!settings) return
    try {
      setBusyAction('settings')
      setError(null)
      const nextSettings = await updateSettings({
        ...settings,
        generationSystemPrompt: settingsPrompt,
      })
      setSettings(nextSettings)
      setSettingsPrompt(nextSettings.generationSystemPrompt)
      setNotice('Settings saved locally')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleToggleEntryGeneration(entry: Entry) {
    if (!activeSession) return
    try {
      setBusyAction(`entry-toggle:${entry.id}`)
      setError(null)
      await updateEntry(entry.id, { excludedFromGeneration: !entry.excludedFromGeneration })
      setEntries(await listEntries(activeSession.id))
      setNotice(entry.excludedFromGeneration ? 'Entry included in generation' : 'Entry excluded from generation')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleImportAttachment() {
    if (!activeSession || !attachmentSourcePath.trim()) return
    try {
      setBusyAction('attachment')
      setError(null)
      await importAttachment({
        sessionId: activeSession.id,
        entryId: selectedEntry?.id ?? null,
        sourcePath: attachmentSourcePath,
      })
      setAttachments(await listAttachments(activeSession.id))
      setAttachmentSourcePath('')
      setNotice('Attachment imported into managed local storage')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handlePasteAttachment(event: ClipboardEvent<HTMLElement>) {
    if (!activeSession) return
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith('image/'))
    if (!image) return
    event.preventDefault()
    try {
      setBusyAction('clipboard')
      setError(null)
      const dataUrl = await readFileAsDataUrl(image)
      await importClipboardScreenshot({
        sessionId: activeSession.id,
        entryId: selectedEntry?.id ?? null,
        filename: image.name || `clipboard-screenshot-${Date.now()}.png`,
        dataUrl,
      })
      setAttachments(await listAttachments(activeSession.id))
      setNotice('Clipboard screenshot imported into managed local storage')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handlePreviewAttachment(attachment: Attachment) {
    try {
      setBusyAction(`attachment:${attachment.id}`)
      setError(null)
      setPreviewDataUrl(await getAttachmentPreviewDataUrl(attachment.id))
      setNotice(`Preview loaded for ${attachment.filename}`)
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleLinkAttachment(attachment: Attachment) {
    if (!findings[0]) return
    try {
      setBusyAction(`attachment-link:${attachment.id}`)
      setError(null)
      await createEvidenceLink({ findingId: findings[0].id, attachmentId: attachment.id })
      setNotice(`Attachment linked as Evidence for ${findings[0].title}`)
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCopyPreviewDataUrl() {
    if (!previewDataUrl) return
    try {
      await navigator.clipboard.writeText(previewDataUrl)
      setNotice('Attachment preview data URL copied')
    } catch (cause) {
      setError(formatError(cause))
    }
  }

  async function handleExport(format: 'markdown' | 'json') {
    if (!activeSession) return
    try {
      setBusyAction(`export:${format}`)
      setError(null)
      setSessionExport(await exportSession(activeSession.id, format))
      setNotice(`${format.toUpperCase()} export rendered locally`)
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  function updateLocalDraftBody(id: string, body: string) {
    setDrafts((previous) => previous.map((draft) => (draft.id === id ? { ...draft, body } : draft)))
  }

  async function handleSaveDraft(draft: Draft) {
    try {
      setBusyAction(`draft:${draft.id}`)
      setError(null)
      const saved = await updateDraft(draft.id, { title: draft.title, body: draft.body })
      setDrafts((previous) => previous.map((item) => (item.id === saved.id ? saved : item)))
      setNotice('Draft saved locally')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <main className="workspace-shell">
      <aside className="session-rail">
        <div>
          <p className="eyebrow">qa-scribe</p>
          <h1>Session Library</h1>
          <p className="rail-copy">Rust/Tauri rebuild with fresh local storage.</p>
        </div>
        <section className="new-session-card" aria-label="Create Session">
          <label>
            Session title
            <input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} />
          </label>
          <label>
            Session Context
            <textarea value={sessionContext} onChange={(event) => setSessionContext(event.target.value)} />
          </label>
          <label>
            Objective Notes
            <textarea value={objectiveNotes} onChange={(event) => setObjectiveNotes(event.target.value)} />
          </label>
          <button disabled={busyAction !== null || !sessionTitle.trim()} onClick={handleCreateSession}>
            {busyAction === 'session' ? 'Creating...' : 'New Session'}
          </button>
        </section>
        <nav className="session-list" aria-label="Saved Sessions">
          {sessions.map((session) => (
            <button
              className={session.id === activeSession?.id ? 'active' : ''}
              key={session.id}
              disabled={busyAction !== null}
              onClick={() => void openSession(session)}
            >
              <strong>{session.title}</strong>
              <span>{new Date(session.lastOpenedAt).toLocaleString()}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="timeline-pane">
        <header className="pane-header">
          <div>
            <p className="eyebrow">Session Timeline</p>
            <h2>{activeSession?.title ?? 'Create or reopen a Session'}</h2>
            <p>{activeSession?.sessionContext ?? 'Entries will appear here as raw testing material.'}</p>
          </div>
          <button disabled={busyAction !== null || !activeSession || includedEntries(entries).length === 0} onClick={handleGenerationDraft}>
            {busyAction === 'draft' ? 'Creating...' : 'Create Draft'}
          </button>
          <button disabled={busyAction !== null || !activeSession} onClick={() => void handleExport('markdown')}>
            Export MD
          </button>
          <button disabled={busyAction !== null || !activeSession} onClick={() => void handleExport('json')}>
            Export JSON
          </button>
        </header>

        {notice ? <p className="notice">{notice}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <section className="capture-card" aria-label="Capture Entry">
          <label>
            Entry type
            <select value={entryType} onChange={(event) => setEntryType(event.target.value as EntryType)}>
              {entryTypes.map((type) => (
                <option key={type} value={type}>
                  {formatEntryType(type)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Entry body
            <textarea
              placeholder="Capture a Note, Observation, API Response, Log, or possible Finding..."
              value={entryBody}
              onChange={(event) => setEntryBody(event.target.value)}
            />
          </label>
          <button disabled={busyAction !== null || !activeSession || !entryBody.trim()} onClick={handleCreateEntry}>
            {busyAction === 'entry' ? 'Adding...' : 'Add Entry'}
          </button>
        </section>

        <div className="timeline-list">
          {entries.map((entry) => (
            <article
              className={entry.id === selectedEntryId ? 'timeline-entry selected' : 'timeline-entry'}
              key={entry.id}
            >
              <button onClick={() => setSelectedEntryId(entry.id)}>
                <span>{formatEntryType(entry.entryType)}</span>
                <time>{new Date(entry.createdAt).toLocaleTimeString()}</time>
              </button>
              {entry.excludedFromGeneration ? <span className="entry-badge">Excluded from generation</span> : null}
              <p>{entry.body}</p>
            </article>
          ))}
          {entries.length === 0 ? <p className="empty-state">No Entries captured yet.</p> : null}
        </div>
      </section>

      <aside className="inspector-pane">
        <section className="panel">
          <p className="eyebrow">Inspector</p>
          {selectedEntry ? (
            <>
              <h2>{formatEntryType(selectedEntry.entryType)}</h2>
              <p>{selectedEntry.body}</p>
              <input
                placeholder="Finding title"
                value={findingTitle}
                onChange={(event) => setFindingTitle(event.target.value)}
              />
              <button disabled={busyAction !== null} onClick={handleCreateFinding}>
                {busyAction === 'finding' ? 'Creating...' : 'Create Finding From Entry'}
              </button>
              <button disabled={busyAction !== null} onClick={() => void handleToggleEntryGeneration(selectedEntry)}>
                {selectedEntry.excludedFromGeneration ? 'Include In Generation' : 'Exclude From Generation'}
              </button>
            </>
          ) : (
            <p>Select an Entry to inspect it or create a Finding.</p>
          )}
        </section>

        <section className="panel">
          <p className="eyebrow">Generation Context</p>
          <p>{generationContext ? `Created ${new Date(generationContext.createdAt).toLocaleString()}` : 'Not created yet.'}</p>
          <p>{includedEntries(entries).length} Entries included for generation.</p>
          <p>{findings.length} Findings in this local view.</p>
          <div className="context-material" aria-label="Generation Context material">
            <p className="context-heading">Entries</p>
            {includedEntries(entries).slice(0, 4).map((entry) => (
              <p key={entry.id}>
                <strong>{formatEntryType(entry.entryType)}:</strong> {entry.body}
              </p>
            ))}
            {includedEntries(entries).length > 4 ? <p>{includedEntries(entries).length - 4} more Entries available.</p> : null}
            <p className="context-heading">Findings</p>
            {findings.slice(0, 4).map((finding) => (
              <p key={finding.id}>
                <strong>{finding.title}:</strong> {finding.body}
              </p>
            ))}
            {findings.length === 0 ? <p>No Findings created yet.</p> : null}
            {findings.length > 4 ? <p>{findings.length - 4} more Findings available.</p> : null}
            <p className="context-heading">Attachments</p>
            {attachments.slice(0, 4).map((attachment) => (
              <p key={attachment.id}>
                <strong>{attachment.filename}:</strong> {attachment.relativePath}
              </p>
            ))}
            {attachments.length === 0 ? <p>No Attachments imported yet.</p> : null}
            {attachments.length > 4 ? <p>{attachments.length - 4} more Attachments available.</p> : null}
          </div>
          <p className="deferred-note">AI generation runs only when you choose a detected local CLI provider.</p>
        </section>

        <section className="panel">
          <p className="eyebrow">AI Generation</p>
          <label>
            Provider
            <select value={selectedProvider} onChange={(event) => setSelectedProvider(event.target.value as AiProvider)}>
              {providerStatus?.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label} {provider.available ? '' : '(unavailable)'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model label
            <input value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} />
          </label>
          <button disabled={busyAction !== null || !activeSession || includedEntries(entries).length === 0} onClick={handleAiGeneration}>
            {busyAction === 'ai-generation' ? 'Generating...' : 'Generate With Local CLI'}
          </button>
          {providerStatus?.providers.map((provider) => (
            <p className="provider-line" key={provider.id}>
              <strong>{provider.label}:</strong> {provider.reason}
            </p>
          ))}
        </section>

        <section className="panel" onPaste={(event) => void handlePasteAttachment(event)}>
          <p className="eyebrow">Attachments</p>
          <p>Paste an image here to import a clipboard screenshot, or import by local path.</p>
          <label>
            Source file path
            <input
              placeholder="/path/to/screenshot.png"
              value={attachmentSourcePath}
              onChange={(event) => setAttachmentSourcePath(event.target.value)}
            />
          </label>
          <button disabled={busyAction !== null || !activeSession || !attachmentSourcePath.trim()} onClick={handleImportAttachment}>
            {busyAction === 'attachment' ? 'Importing...' : 'Import Attachment'}
          </button>
          <div className="attachment-list">
            {attachments.map((attachment) => (
              <article key={attachment.id}>
                <strong>{attachment.filename}</strong>
                <span>{Math.round(attachment.sizeBytes / 1024)} KB</span>
                <button disabled={busyAction !== null} onClick={() => void handlePreviewAttachment(attachment)}>
                  Preview
                </button>
                <button disabled={busyAction !== null || findings.length === 0} onClick={() => void handleLinkAttachment(attachment)}>
                  Link to Latest Finding
                </button>
              </article>
            ))}
            {attachments.length === 0 ? <p>No managed Attachments yet.</p> : null}
          </div>
          {previewDataUrl ? (
            <>
              <button onClick={() => void handleCopyPreviewDataUrl()}>Copy Preview Data URL</button>
              {previewDataUrl.startsWith('data:image/') ? <img alt="Attachment preview" className="attachment-preview" src={previewDataUrl} /> : <textarea readOnly value={previewDataUrl} />}
            </>
          ) : null}
        </section>

        <section className="panel drafts-panel">
          <p className="eyebrow">Export</p>
          {sessionExport ? (
            <article>
              <h3>{sessionExport.filename}</h3>
              <textarea readOnly value={sessionExport.body} />
            </article>
          ) : (
            <p>Render a local Markdown or JSON export from the active Session.</p>
          )}
        </section>

        <section className="panel drafts-panel">
          <p className="eyebrow">Drafts</p>
          {drafts.map((draft) => (
            <article key={draft.id}>
              <h3>{draft.title}</h3>
              <label>
                Editable Draft body
                <textarea value={draft.body} onChange={(event) => updateLocalDraftBody(draft.id, event.target.value)} />
              </label>
              <button disabled={busyAction !== null} onClick={() => void handleSaveDraft(draft)}>
                {busyAction === `draft:${draft.id}` ? 'Saving...' : 'Save Draft'}
              </button>
            </article>
          ))}
          {drafts.length === 0 ? <p>No Drafts yet.</p> : null}
          <p className="deferred-note">Draft edits are saved to local SQLite when you choose Save Draft.</p>
        </section>

        <section className="panel">
          <p className="eyebrow">Settings</p>
          <label>
            Generation system prompt
            <textarea value={settingsPrompt} onChange={(event) => setSettingsPrompt(event.target.value)} />
          </label>
          <button disabled={busyAction !== null || !settings} onClick={handleSaveSettings}>
            {busyAction === 'settings' ? 'Saving...' : 'Save Settings'}
          </button>
        </section>

        <section className="panel system-panel">
          <p className="eyebrow">System</p>
          <dl>
            <dt>Storage</dt>
            <dd>{appStatus?.storageMode ?? 'loading'}</dd>
            <dt>Database</dt>
            <dd>{shellStatus?.databaseFilename ?? 'loading'}</dd>
            <dt>Providers</dt>
            <dd>{providerStatus?.providers.map((provider) => provider.label).join(', ') ?? 'loading'}</dd>
            <dt>Deferred</dt>
            <dd>{shellStatus?.deferredCommands.join(', ') ?? 'loading'}</dd>
          </dl>
        </section>
      </aside>
    </main>
  )
}

function formatEntryType(type: EntryType): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function renderManualDraft(session: Session, entries: Entry[], findings: Finding[]): string {
  const generationEntries = includedEntries(entries)
  return [
    `# ${session.title}`,
    '',
    '## Session Context',
    session.sessionContext ?? 'No Session Context captured.',
    '',
    '## Timeline Entries',
    generationEntries.map((entry, index) => `${index + 1}. ${formatEntryType(entry.entryType)}: ${entry.body}`).join('\n') || 'No Entries captured.',
    '',
    '## Findings',
    findings.map((finding) => `- ${finding.title}: ${finding.body}`).join('\n') || 'No Findings captured.',
  ].join('\n')
}

function includedEntries(entries: Entry[]): Entry[] {
  return entries.filter((entry) => !entry.excludedFromGeneration)
}

function formatError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('File could not be read')))
    reader.readAsDataURL(file)
  })
}
