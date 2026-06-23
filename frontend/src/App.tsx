import { useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react'
import {
  Box,
  ClipboardCheck,
  FileText,
  Flag,
  Loader2,
  PencilLine,
  Plus,
  Search,
  Settings,
} from 'lucide-react'
import {
  createDraft,
  createEntry,
  createFinding,
  createSession,
  generateAiAction,
  getProviderStatus,
  getSettings,
  importClipboardScreenshot,
  listDrafts,
  listEntries,
  listFindings,
  listSessions,
  reopenSession,
  updateDraft,
  updateEntry,
  updateSession,
  updateSettings,
  type AiProvider,
  type AppSettings,
  type Draft,
  type Entry,
  type Finding,
  type GenerateAiActionKind,
  type ProviderStatus,
  type Session,
} from './tauri'
import { RailItem } from './components/Common'
import { ModelCombobox, ProviderGlyph } from './components/ModelSelector'
import {
  containsInlineImageData,
  emptyNoteHtml,
  inlineImageFilename,
  insertEditorHtml,
  managedAttachmentImageHtml,
  managedAttachmentProtocol,
  normalizeEditorHtml,
  pastedImageFilename,
  readFileAsDataUrl,
  restoreSelection,
  selectedRangeWithin,
  serializeEditorHtml,
  stripHtml,
} from './editor/editorHtml'
import { countWords, formatError, formatSessionDate, initialTheme, nextUntitledTitle, statusLabel } from './ui/format'
import type { BusyAction, SettingsSaveState, ThemePreference, WorkspaceView } from './ui/types'
import { FindingsView } from './views/FindingsView'
import { NotesView } from './views/NotesView'
import { SettingsView } from './views/SettingsView'
import { TemplatesView } from './views/TemplatesView'
import { TestwareView } from './views/TestwareView'

const noteBodyMaxLength = 100_000

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [noteEntry, setNoteEntry] = useState<Entry | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [noteTitle, setNoteTitle] = useState('')
  const [noteBody, setNoteBody] = useState(emptyNoteHtml)
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>('codex_cli')
  const [selectedModel, setSelectedModel] = useState('default')
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null)
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>('idle')
  const [busyAction, setBusyAction] = useState<BusyAction | null>('boot')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<WorkspaceView>('notes')
  const [theme, setTheme] = useState<ThemePreference>(() => initialTheme())

  const savedTitleRef = useRef('')
  const savedBodyRef = useRef(emptyNoteHtml)
  const settingsSaveResetRef = useRef<number | null>(null)
  const bootedRef = useRef(false)

  const providerOptions = providerStatus?.providers ?? []
  const activeProvider = providerOptions.find((provider) => provider.id === selectedProvider) ?? providerOptions[0] ?? null
  const testwareDrafts = drafts.filter((draft) => draft.kind === 'testware')
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    if (!query) return sessions
    return sessions.filter((session) => session.title.toLocaleLowerCase().includes(query))
  }, [sessions, searchQuery])
  const noteWordCount = countWords(stripHtml(noteBody))
  const noteIsReady = Boolean(activeSession && noteEntry)
  const isBusy = busyAction !== null

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem('qa-scribe-theme', theme)
  }, [theme])

  useEffect(() => {
    return () => {
      if (settingsSaveResetRef.current) window.clearTimeout(settingsSaveResetRef.current)
    }
  }, [])

  useEffect(() => {
    void boot()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- desktop boot is intentionally one-shot

  useEffect(() => {
    if (!activeSession || !bootedRef.current) return
    const trimmedTitle = noteTitle.trim()
    if (!trimmedTitle || trimmedTitle === savedTitleRef.current) return

    const timeout = window.setTimeout(() => {
      void saveTitle(trimmedTitle)
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [activeSession, noteTitle]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity and title

  useEffect(() => {
    if (!noteEntry || !bootedRef.current) return
    const nextBody = normalizeEditorHtml(noteBody)
    if (nextBody === savedBodyRef.current) return

    const timeout = window.setTimeout(() => {
      void saveNoteNow()
    }, 850)
    return () => window.clearTimeout(timeout)
  }, [noteEntry, noteBody]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity and body

  useEffect(() => {
    if (!settings || !bootedRef.current) return
    if (selectedProvider === settings.selectedAiProvider && selectedModel === settings.selectedAiModel) return

    const timeout = window.setTimeout(() => {
      void persistSettings({
        ...settings,
        selectedAiProvider: selectedProvider,
        selectedAiModel: selectedModel.trim() || 'default',
      })
    }, 550)
    return () => window.clearTimeout(timeout)
  }, [settings, selectedProvider, selectedModel])

  async function boot() {
    try {
      setBusyAction('boot')
      setError(null)
      const [nextSettings, nextProviderStatus, nextSessions] = await Promise.all([getSettings(), getProviderStatus(), listSessions()])
      setSettings(nextSettings)
      setSettingsDraft(nextSettings)
      setProviderStatus(nextProviderStatus)
      setSelectedProvider(nextSettings.selectedAiProvider)
      setSelectedModel(nextSettings.selectedAiModel || 'default')
      setSessions(nextSessions)
      bootedRef.current = true
      if (nextSessions[0]) {
        await openNote(nextSessions[0], false)
      } else {
        setNotice('Create a note to start')
      }
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function openNote(session: Session, showNotice = true) {
    try {
      setBusyAction('open-note')
      setError(null)
      const reopened = await reopenSession(session.id)
      const [nextEntries, nextDrafts, nextFindings] = await Promise.all([
        listEntries(session.id),
        listDrafts(session.id),
        listFindings(session.id),
      ])
      const editableNote = await ensureNoteEntry(reopened.id, nextEntries)

      setActiveSession(reopened)
      setNoteEntry(editableNote)
      setDrafts(nextDrafts)
      setFindings(nextFindings)
      setNoteTitle(reopened.title)
      setNoteBody(normalizeEditorHtml(editableNote.body))
      savedTitleRef.current = reopened.title
      savedBodyRef.current = normalizeEditorHtml(editableNote.body)
      setActiveView('notes')
      if (showNotice) setNotice(`Opened ${reopened.title}`)
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function ensureNoteEntry(sessionId: string, currentEntries: Entry[]): Promise<Entry> {
    const existing = currentEntries.find((entry) => entry.entryType === 'note')
    if (existing) return existing
    return createEntry({
      sessionId,
      entryType: 'note',
      title: 'Note body',
      body: emptyNoteHtml,
      metadataJson: null,
      excludedFromGeneration: false,
    })
  }

  async function handleNewNote() {
    try {
      setBusyAction('new-note')
      setError(null)
      const title = nextUntitledTitle(sessions)
      const session = await createSession({ title, sessionContext: null, objectiveNotes: null })
      const editableNote = await createEntry({
        sessionId: session.id,
        entryType: 'note',
        title: 'Note body',
        body: emptyNoteHtml,
        metadataJson: null,
        excludedFromGeneration: false,
      })
      const nextSessions = await listSessions()
      setSessions(nextSessions)
      setActiveSession(session)
      setNoteEntry(editableNote)
      setDrafts([])
      setFindings([])
      setNoteTitle(session.title)
      setNoteBody(emptyNoteHtml)
      savedTitleRef.current = session.title
      savedBodyRef.current = emptyNoteHtml
      setActiveView('notes')
      setNotice('New note created')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function saveTitle(title: string): Promise<boolean> {
    if (!activeSession) return false
    try {
      setBusyAction('save-title')
      const saved = await updateSession(activeSession.id, { title })
      savedTitleRef.current = saved.title
      setActiveSession(saved)
      setSessions((previous) => previous.map((session) => (session.id === saved.id ? saved : session)))
      setNotice('Note saved')
      return true
    } catch (cause) {
      setError(formatError(cause))
      return false
    } finally {
      setBusyAction(null)
    }
  }

  async function saveBody(body: string): Promise<boolean> {
    if (!noteEntry) return false
    if (body.length > noteBodyMaxLength) {
      setError('Note is too large to autosave. This usually means an image was embedded directly in the note; paste images again so QA Scribe can store them as attachments.')
      return false
    }
    try {
      setBusyAction('save-body')
      const saved = await updateEntry(noteEntry.id, { body })
      savedBodyRef.current = saved.body
      setNoteEntry(saved)
      setNotice('Note saved')
      return true
    } catch (cause) {
      setError(formatError(cause))
      return false
    } finally {
      setBusyAction(null)
    }
  }

  async function saveNoteNow(): Promise<boolean> {
    const title = noteTitle.trim()
    let body: string
    try {
      body = await materializeInlineImages(noteBody)
    } catch (cause) {
      setError(formatError(cause))
      return false
    }
    let saved = true
    if (activeSession && title && title !== savedTitleRef.current) {
      saved = (await saveTitle(title)) && saved
    }
    if (noteEntry && body !== savedBodyRef.current) {
      saved = (await saveBody(body)) && saved
    }
    return saved
  }

  async function handleAiAction(action: GenerateAiActionKind) {
    if (!activeSession || !noteEntry) return
    const busy = action === 'testware' ? 'ai-testware' : action === 'finding' ? 'ai-finding' : 'ai-summary'
    try {
      setBusyAction(busy)
      setError(null)
      const saved = await saveNoteNow()
      if (!saved) return
      const result = await generateAiAction({
        sessionId: activeSession.id,
        provider: selectedProvider,
        model: selectedModel.trim() || 'default',
        reasoningEffort: null,
        action,
        noteEntryId: noteEntry.id,
      })
      if (result.draft) {
        setDrafts(await listDrafts(activeSession.id))
        setActiveView('testware')
        setNotice('Testware generated')
      } else if (result.finding) {
        setFindings(await listFindings(activeSession.id))
        setActiveView('findings')
        setNotice('Finding created')
      } else if (result.noteEntry) {
        const body = normalizeEditorHtml(result.noteEntry.body)
        setNoteEntry(result.noteEntry)
        setNoteBody(body)
        savedBodyRef.current = body
        setNotice('Note summarized')
      } else {
        setNotice(result.aiRun.errorMessage ?? 'AI action finished without creating output')
      }
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleManualTestware() {
    if (!activeSession) return
    try {
      setBusyAction('manual-testware')
      setError(null)
      const saved = await saveNoteNow()
      if (!saved) return
      await createDraft({
        sessionId: activeSession.id,
        aiRunId: null,
        kind: 'testware',
        title: `${activeSession.title} Test Cases`,
        body: renderManualTestware(activeSession.title, noteBody),
      })
      setDrafts(await listDrafts(activeSession.id))
      setActiveView('testware')
      setNotice('Manual testware created')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleManualFinding() {
    if (!activeSession) return
    try {
      setBusyAction('manual-finding')
      setError(null)
      const saved = await saveNoteNow()
      if (!saved) return
      await createFinding({
        sessionId: activeSession.id,
        title: `Finding from ${activeSession.title}`,
        body: stripHtml(noteBody).slice(0, 4000) || 'Describe the finding.',
        kind: 'bug',
        metadataJson: null,
      })
      setFindings(await listFindings(activeSession.id))
      setActiveView('findings')
      setNotice('Manual finding created')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveDraft(draft: Draft) {
    try {
      setBusyAction(`draft:${draft.id}`)
      setError(null)
      const saved = await updateDraft(draft.id, { title: draft.title, body: draft.body })
      setDrafts((previous) => previous.map((item) => (item.id === saved.id ? saved : item)))
      setNotice('Testware saved')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  function updateLocalDraft(id: string, patch: Partial<Pick<Draft, 'title' | 'body'>>) {
    setDrafts((previous) => previous.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)))
  }

  async function persistSettings(nextSettings: AppSettings): Promise<AppSettings | null> {
    try {
      setError(null)
      const saved = await updateSettings(nextSettings)
      setSettings(saved)
      setSettingsDraft(saved)
      setSelectedProvider(saved.selectedAiProvider)
      setSelectedModel(saved.selectedAiModel)
      setNotice('Settings saved')
      return saved
    } catch (cause) {
      setError(formatError(cause))
      return null
    }
  }

  async function handleSaveSettings() {
    if (!settingsDraft) return
    try {
      setBusyAction('save-settings')
      setSettingsSaveState('saving')
      const saved = await persistSettings({
        ...settingsDraft,
        selectedAiProvider: selectedProvider,
        selectedAiModel: selectedModel.trim() || 'default',
      })
      setSettingsSaveState(saved ? 'saved' : 'error')
      if (saved) scheduleSettingsSaveReset()
    } finally {
      setBusyAction(null)
    }
  }

  function updateSettingsDraft(patch: Partial<AppSettings>) {
    setSettingsSaveState('idle')
    setSettingsDraft((previous) => (previous ? { ...previous, ...patch } : previous))
  }

  function scheduleSettingsSaveReset() {
    if (settingsSaveResetRef.current) window.clearTimeout(settingsSaveResetRef.current)
    settingsSaveResetRef.current = window.setTimeout(() => {
      setSettingsSaveState('idle')
      settingsSaveResetRef.current = null
    }, 1800)
  }

  function handleProviderChange(provider: AiProvider) {
    setSelectedProvider(provider)
    const nextProvider = providerOptions.find((option) => option.id === provider)
    if (!nextProvider) return

    const currentModel = selectedModel.trim() || 'default'
    if (!nextProvider.models.some((model) => model.id === currentModel)) {
      setSelectedModel('default')
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null
    const editor = target?.closest<HTMLElement>('.rich-editor')
    if (!editor) return

    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/'))
    if (!file) return

    const insertionRange = selectedRangeWithin(editor)
    event.preventDefault()
    void importPastedImage(file, insertionRange)
  }

  async function importPastedImage(file: File, insertionRange: Range | null) {
    if (!activeSession || !noteEntry) {
      setError('Open a note before pasting images.')
      return
    }

    try {
      setBusyAction('attach-image')
      setError(null)
      const dataUrl = await readFileAsDataUrl(file)
      const filename = pastedImageFilename(file)
      const attachment = await importClipboardScreenshot({
        sessionId: activeSession.id,
        entryId: noteEntry.id,
        filename,
        dataUrl,
      })
      restoreSelection(insertionRange)
      insertEditorHtml(managedAttachmentImageHtml(attachment.id, attachment.filename, dataUrl))
      const editor = document.querySelector<HTMLElement>('.rich-editor')
      if (editor) {
        setNoteBody(serializeEditorHtml(editor))
      }
      setNotice('Image attached')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function materializeInlineImages(html: string): Promise<string> {
    if (!activeSession || !noteEntry || !containsInlineImageData(html)) {
      return normalizeEditorHtml(html)
    }

    const documentFragment = new DOMParser().parseFromString(html, 'text/html')
    const images = Array.from(documentFragment.body.querySelectorAll<HTMLImageElement>('img')).filter((image) =>
      (image.getAttribute('src') ?? '').startsWith('data:image/'),
    )

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index]
      const dataUrl = image.getAttribute('src')
      if (!dataUrl) continue

      const filename = inlineImageFilename(image, index, dataUrl)
      const attachment = await importClipboardScreenshot({
        sessionId: activeSession.id,
        entryId: noteEntry.id,
        filename,
        dataUrl,
      })
      image.setAttribute('data-attachment-id', attachment.id)
      image.setAttribute('src', `${managedAttachmentProtocol}${attachment.id}`)
      image.setAttribute('alt', image.getAttribute('alt') || attachment.filename)
      image.removeAttribute('srcset')
    }

    const body = normalizeEditorHtml(documentFragment.body.innerHTML)
    setNoteBody(body)
    return body
  }

  return (
    <main className="app-shell" onPaste={handlePaste}>
      <header className="top-bar">
        <div className="brand-cluster">
          <span className="brand-mark">
            <PencilLine size={21} strokeWidth={2.4} />
          </span>
          <strong>QA Scribe</strong>
        </div>

        <label className="global-search">
          <Search size={17} />
          <span className="sr-only">Search notes</span>
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search notes, testware, findings..." />
        </label>

        <button className="primary-button top-new-button" type="button" disabled={isBusy} onClick={() => void handleNewNote()}>
          {busyAction === 'new-note' ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
          New note
        </button>
      </header>

      <aside className="left-rail" aria-label="Workspace navigation">
        <nav className="section-nav" aria-label="Primary">
          <RailItem icon={FileText} label="Notes" count={sessions.length} active={activeView === 'notes'} onClick={() => setActiveView('notes')} />
          <RailItem icon={Box} label="Testware" count={testwareDrafts.length} active={activeView === 'testware'} onClick={() => setActiveView('testware')} />
          <RailItem icon={Flag} label="Findings" count={findings.length} active={activeView === 'findings'} onClick={() => setActiveView('findings')} />
          <RailItem icon={ClipboardCheck} label="Templates" active={activeView === 'templates'} onClick={() => setActiveView('templates')} />
        </nav>

        <section className="note-picker" aria-label="Choose note">
          <p className="rail-heading">Choose note</p>
          <div className="note-picker-list" role="listbox" aria-label="Notes">
            {filteredSessions.slice(0, 8).map((session) => (
              <button
                key={session.id}
                className={activeSession?.id === session.id ? 'note-picker-item active' : 'note-picker-item'}
                type="button"
                role="option"
                aria-selected={activeSession?.id === session.id}
                disabled={isBusy && activeSession?.id !== session.id}
                onClick={() => void openNote(session)}
              >
                <span>{session.title}</span>
                <small>{formatSessionDate(session.updatedAt)}</small>
              </button>
            ))}
            {filteredSessions.length === 0 ? <p className="note-picker-empty">No matching notes</p> : null}
          </div>
          {filteredSessions.length > 8 ? <p className="note-picker-more">Showing 8 of {filteredSessions.length}. Search to narrow.</p> : null}
        </section>

        <section className="model-selector" aria-label="AI model">
          <p className="rail-heading">AI model</p>
          <label className="select-shell">
            <ProviderGlyph provider={selectedProvider} />
            <select value={selectedProvider} onChange={(event) => handleProviderChange(event.target.value as AiProvider)}>
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label} {provider.available ? '' : `(${statusLabel(provider.status)})`}
                </option>
              ))}
            </select>
          </label>
          <ModelCombobox models={activeProvider?.models ?? []} value={selectedModel} onChange={setSelectedModel} />
          <p className={activeProvider?.available ? 'provider-hint ready' : 'provider-hint'}>
            {activeProvider ? activeProvider.reason : 'Loading provider status'}
          </p>
        </section>

        <button className={activeView === 'settings' ? 'settings-link active' : 'settings-link'} type="button" onClick={() => setActiveView('settings')}>
          <Settings size={17} />
          Settings
        </button>
      </aside>

      <section className="center-workspace" aria-label="Workspace">
        {activeView === 'notes' ? (
          <NotesView
            activeProviderAvailable={Boolean(activeProvider?.available)}
            activeSession={activeSession}
            busyAction={busyAction}
            filteredSessions={filteredSessions}
            isBusy={isBusy}
            noteBody={noteBody}
            noteIsReady={noteIsReady}
            noteTitle={noteTitle}
            noteWordCount={noteWordCount}
            notice={notice}
            error={error}
            onAiAction={handleAiAction}
            onNewNote={handleNewNote}
            onOpenNote={openNote}
            onSetNoteBody={setNoteBody}
            onSetNoteTitle={setNoteTitle}
          />
        ) : null}

        {activeView === 'testware' ? (
          <TestwareView
            busyAction={busyAction}
            drafts={testwareDrafts}
            isBusy={isBusy}
            onManualCreate={handleManualTestware}
            onSaveDraft={handleSaveDraft}
            updateLocalDraft={updateLocalDraft}
          />
        ) : null}

        {activeView === 'findings' ? (
          <FindingsView busyAction={busyAction} findings={findings} isBusy={isBusy} onManualCreate={handleManualFinding} />
        ) : null}

        {activeView === 'templates' ? (
          <TemplatesView
            busyAction={busyAction}
            settingsDraft={settingsDraft}
            settingsSaveState={settingsSaveState}
            updateSettingsDraft={updateSettingsDraft}
            onSaveSettings={handleSaveSettings}
          />
        ) : null}

        {activeView === 'settings' ? (
          <SettingsView
            busyAction={busyAction}
            providerStatus={providerStatus}
            settingsDraft={settingsDraft}
            settingsSaveState={settingsSaveState}
            theme={theme}
            updateSettingsDraft={updateSettingsDraft}
            setTheme={setTheme}
            onSaveSettings={handleSaveSettings}
          />
        ) : null}
      </section>
    </main>
  )
}

function renderManualTestware(title: string, body: string): string {
  const note = stripHtml(body) || 'Add source note detail.'
  return [`# ${title} Test Cases`, '', '## Source Note', note, '', '## Test Cases', '- Scenario:', '  - Steps:', '  - Expected result:'].join('\n')
}
