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
  deleteDraft,
  deleteFinding,
  deleteSession,
  cancelAiActionJob,
  getProviderStatus,
  getSettings,
  importClipboardScreenshot,
  listDrafts,
  listEntries,
  listFindings,
  listSessions,
  reopenSession,
  startAiActionJob,
  updateDraft,
  updateEntry,
  updateFinding,
  updateSession,
  updateSettings,
  type AiProvider,
  type AppSettings,
  type Draft,
  type Entry,
  type Finding,
  type GenerateAiActionKind,
  type GenerationJobEvent,
  type GenerationJobStatus,
  type ProviderStatus,
  type Session,
} from './tauri'
import { RailItem } from './components/Common'
import { ModelCombobox, ProviderGlyph } from './components/ModelSelector'
import {
  containsInlineImageData,
  emptyEditorHtml,
  inlineImageFilename,
  managedAttachmentProtocol,
  normalizeEditorHtml,
  pastedImageFilename,
  readFileAsDataUrl,
  stripHtml,
} from './editor/editorHtml'
import { countWords, formatError, formatSessionDate, initialTheme, nextUntitledRecordTitle, nextUntitledTitle, statusLabel } from './ui/format'
import type { BusyAction, PendingAiActions, SettingsSaveState, ThemePreference, WorkspaceView } from './ui/types'
import type { RichEditorImageUpload } from './editor/RichTextEditor'
import { copyRecordForJira } from './editor/clipboardExport'
import { richEditorImageInserterForElement, type RichEditorImageInserter } from './editor/richEditorRegistry'
import { FindingsView } from './views/FindingsView'
import { NotesView } from './views/NotesView'
import { SettingsView } from './views/SettingsView'
import { TemplatesView } from './views/TemplatesView'
import { TestwareView } from './views/TestwareView'

const noteBodyMaxLength = 100_000

type DeleteConfirmation =
  | { kind: 'note'; session: Session }
  | { kind: 'draft'; draft: Draft }
  | { kind: 'finding'; finding: Finding }

function generationIsActive(job: GenerationJobStatus): boolean {
  return job.state === 'starting' || job.state === 'running' || job.state === 'cancelling'
}

function deleteConfirmationCopy(confirmation: DeleteConfirmation) {
  if (confirmation.kind === 'note') {
    return {
      title: `Delete "${confirmation.session.title}"?`,
      body: 'This removes the note, its testware, findings, and attachments. This cannot be undone.',
      confirmLabel: 'Delete note permanently',
    }
  }
  if (confirmation.kind === 'draft') {
    return {
      title: `Delete "${confirmation.draft.title}"?`,
      body: 'This removes this testware draft only. AI run history is kept. This cannot be undone.',
      confirmLabel: 'Delete testware permanently',
    }
  }
  return {
    title: `Delete "${confirmation.finding.title}"?`,
    body: 'This removes this finding and its evidence links. Source notes and attachments are kept. This cannot be undone.',
    confirmLabel: 'Delete finding permanently',
  }
}

export function App() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [noteEntry, setNoteEntry] = useState<Entry | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [noteTitle, setNoteTitle] = useState('')
  const [noteBody, setNoteBody] = useState(emptyEditorHtml)
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>('codex_cli')
  const [selectedModel, setSelectedModel] = useState('default')
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null)
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>('idle')
  const [generationJobs, setGenerationJobs] = useState<Record<string, GenerationJobStatus>>({})
  const [busyAction, setBusyAction] = useState<BusyAction | null>('boot')
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<WorkspaceView>('notes')
  const [theme, setTheme] = useState<ThemePreference>(() => initialTheme())
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)

  const savedTitleRef = useRef('')
  const savedBodyRef = useRef(emptyEditorHtml)
  const deletingSessionIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const noteEntryIdRef = useRef<string | null>(null)
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
  const deleteCopy = deleteConfirmation ? deleteConfirmationCopy(deleteConfirmation) : null
  const activeSessionJobs = useMemo(
    () => Object.values(generationJobs).filter((job) => activeSession && job.sessionId === activeSession.id && generationIsActive(job)),
    [generationJobs, activeSession],
  )
  const pendingAiActions = useMemo<PendingAiActions>(() => {
    const pending: PendingAiActions = {}
    for (const job of activeSessionJobs) pending[job.action] = true
    return pending
  }, [activeSessionJobs])
  const activeTestwareJob = activeSessionJobs.find((job) => job.action === 'testware') ?? null
  const activeFindingJob = activeSessionJobs.find((job) => job.action === 'finding') ?? null

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem('qa-scribe-theme', theme)
  }, [theme])

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id ?? null
    noteEntryIdRef.current = noteEntry?.id ?? null
  }, [activeSession?.id, noteEntry?.id])

  useEffect(() => {
    return () => {
      if (settingsSaveResetRef.current) window.clearTimeout(settingsSaveResetRef.current)
    }
  }, [])

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
      body: emptyEditorHtml,
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
        body: emptyEditorHtml,
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
      setNoteBody(emptyEditorHtml)
      savedTitleRef.current = session.title
      savedBodyRef.current = emptyEditorHtml
      setActiveView('notes')
      setNotice('New note created')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  function clearActiveNoteState() {
    setActiveSession(null)
    setNoteEntry(null)
    setDrafts([])
    setFindings([])
    setNoteTitle('')
    setNoteBody(emptyEditorHtml)
    savedTitleRef.current = ''
    savedBodyRef.current = emptyEditorHtml
  }

  function requestDeleteNote() {
    if (!activeSession) return
    setDeleteConfirmation({ kind: 'note', session: activeSession })
  }

  async function handleDeleteNote(sessionToDelete: Session) {
    try {
      deletingSessionIdRef.current = sessionToDelete.id
      setBusyAction('delete-note')
      setError(null)
      await deleteSession(sessionToDelete.id)
      const nextSessions = await listSessions()
      setSessions(nextSessions)
      clearActiveNoteState()

      if (nextSessions[0]) {
        await openNote(nextSessions[0], false)
      } else {
        setActiveView('notes')
      }
      setNotice('Note deleted')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      deletingSessionIdRef.current = null
      setBusyAction(null)
    }
  }

  async function saveTitle(title: string): Promise<boolean> {
    if (!activeSession || deletingSessionIdRef.current === activeSession.id) return false
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
    if (!noteEntry || deletingSessionIdRef.current === noteEntry.sessionId) return false
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

  function storeGenerationStatus(status: GenerationJobStatus) {
    setGenerationJobs((previous) => ({ ...previous, [status.jobId]: status }))
  }

  function mergeDraft(draft: Draft) {
    setDrafts((previous) => {
      const exists = previous.some((item) => item.id === draft.id)
      if (exists) return previous.map((item) => (item.id === draft.id ? draft : item))
      return [draft, ...previous]
    })
  }

  function mergeFinding(finding: Finding) {
    setFindings((previous) => {
      const exists = previous.some((item) => item.id === finding.id)
      if (exists) return previous.map((item) => (item.id === finding.id ? finding : item))
      return [finding, ...previous]
    })
  }

  function applyGenerationEvent(event: GenerationJobEvent) {
    storeGenerationStatus(event.status)

    if (event.type === 'progress') {
      setNotice(event.message)
      return
    }

    if (event.type === 'partial') {
      setNotice(event.status.progressMessage || 'Generating')
      return
    }

    if (event.type === 'started') {
      setNotice(event.status.progressMessage || 'Generation started')
      return
    }

    if (event.type === 'cancelled') {
      setNotice('Generation cancelled')
      return
    }

    if (event.type === 'failed') {
      setError(event.errorMessage)
      return
    }

    const { result } = event
    if (result.draft && activeSessionIdRef.current === result.draft.sessionId) {
      mergeDraft(result.draft)
      setActiveView('testware')
      setNotice('Testware generated')
    } else if (result.finding && activeSessionIdRef.current === result.finding.sessionId) {
      mergeFinding(result.finding)
      setActiveView('findings')
      setNotice('Finding created')
    } else if (result.noteEntry && noteEntryIdRef.current === result.noteEntry.id) {
      const body = normalizeEditorHtml(result.noteEntry.body)
      setNoteEntry(result.noteEntry)
      setNoteBody(body)
      savedBodyRef.current = body
      setNotice('Note summarized')
    } else {
      setNotice(result.aiRun.errorMessage ?? 'AI action finished')
    }
  }

  async function handleAiAction(action: GenerateAiActionKind) {
    if (!activeSession || !noteEntry) return
    const busy = action === 'testware' ? 'ai-testware' : action === 'finding' ? 'ai-finding' : 'ai-summary'
    try {
      setBusyAction(busy)
      setError(null)
      const saved = await saveNoteNow()
      if (!saved) return
      const started = await startAiActionJob(
        {
          sessionId: activeSession.id,
          provider: selectedProvider,
          model: selectedModel.trim() || 'default',
          reasoningEffort: action === 'testware' || action === 'finding' ? 'low' : null,
          action,
          noteEntryId: noteEntry.id,
        },
        applyGenerationEvent,
      )
      storeGenerationStatus(started.status)
      if (action === 'testware') {
        setActiveView('testware')
        setNotice('Generating testware')
      } else if (action === 'finding') {
        setNotice('Generating finding')
      } else {
        setNotice('Summarizing note')
      }
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCancelGenerationJob(jobId: string) {
    try {
      setError(null)
      const status = await cancelAiActionJob(jobId)
      storeGenerationStatus(status)
      setNotice('Cancelling generation')
    } catch (cause) {
      setError(formatError(cause))
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
        title: nextUntitledRecordTitle(testwareDrafts, 'Untitled testware'),
        body: emptyEditorHtml,
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

  async function handlePrefillTestwareFromNote() {
    if (!activeSession) return
    try {
      setBusyAction('prefill-testware')
      setError(null)
      const saved = await saveNoteNow()
      if (!saved) return
      await createDraft({
        sessionId: activeSession.id,
        aiRunId: null,
        kind: 'testware',
        title: nextUntitledRecordTitle(testwareDrafts, 'Untitled testware'),
        body: renderPrefilledTestware(activeSession.title, noteBody),
      })
      setDrafts(await listDrafts(activeSession.id))
      setActiveView('testware')
      setNotice('Testware prefilled from note')
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
        title: nextUntitledRecordTitle(findings, 'Untitled finding'),
        body: emptyEditorHtml,
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

  async function handlePrefillFindingFromNote() {
    if (!activeSession) return
    try {
      setBusyAction('prefill-finding')
      setError(null)
      const saved = await saveNoteNow()
      if (!saved) return
      await createFinding({
        sessionId: activeSession.id,
        title: nextUntitledRecordTitle(findings, 'Untitled finding'),
        body: renderPrefilledFinding(noteBody),
        kind: 'bug',
        metadataJson: null,
      })
      setFindings(await listFindings(activeSession.id))
      setActiveView('findings')
      setNotice('Finding prefilled from note')
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

  async function handleSaveFinding(finding: Finding) {
    try {
      setBusyAction(`finding:${finding.id}`)
      setError(null)
      const saved = await updateFinding(finding.id, { title: finding.title, body: finding.body })
      setFindings((previous) => previous.map((item) => (item.id === saved.id ? saved : item)))
      setNotice('Finding saved')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  function updateLocalFinding(id: string, patch: Partial<Pick<Finding, 'title' | 'body'>>) {
    setFindings((previous) => previous.map((finding) => (finding.id === id ? { ...finding, ...patch } : finding)))
  }

  async function handleCopyNoteForJira() {
    if (!activeSession) return
    try {
      setBusyAction('copy-note')
      setError(null)
      await copyRecordForJira({ title: noteTitle, bodyHtml: noteBody })
      setNotice('Note copied for Jira')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCopyDraftForJira(draft: Draft) {
    try {
      setBusyAction(`copy-draft:${draft.id}`)
      setError(null)
      await copyRecordForJira({ title: draft.title, bodyHtml: draft.body })
      setNotice('Testware copied for Jira')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleCopyFindingForJira(finding: Finding) {
    try {
      setBusyAction(`copy-finding:${finding.id}`)
      setError(null)
      await copyRecordForJira({ title: finding.title, bodyHtml: finding.body })
      setNotice('Finding copied for Jira')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  function requestDeleteDraft(draft: Draft) {
    setDeleteConfirmation({ kind: 'draft', draft })
  }

  async function handleDeleteDraft(draft: Draft) {
    try {
      setBusyAction(`delete-draft:${draft.id}`)
      setError(null)
      await deleteDraft(draft.id)
      setDrafts(await listDrafts(draft.sessionId))
      setNotice('Testware deleted')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  function requestDeleteFinding(finding: Finding) {
    setDeleteConfirmation({ kind: 'finding', finding })
  }

  async function handleDeleteFinding(finding: Finding) {
    try {
      setBusyAction(`delete-finding:${finding.id}`)
      setError(null)
      await deleteFinding(finding.id)
      setFindings(await listFindings(finding.sessionId))
      setNotice('Finding deleted')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function confirmDelete() {
    const confirmation = deleteConfirmation
    if (!confirmation) return

    setDeleteConfirmation(null)
    if (confirmation.kind === 'note') {
      await handleDeleteNote(confirmation.session)
    } else if (confirmation.kind === 'draft') {
      await handleDeleteDraft(confirmation.draft)
    } else {
      await handleDeleteFinding(confirmation.finding)
    }
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
    if (!editor || !editor.classList.contains('note-rich-editor')) return

    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/'))
    if (!file) return

    const insertImage = richEditorImageInserterForElement(editor)
    if (!insertImage) return

    event.preventDefault()
    void importPastedImage(file, insertImage)
  }

  async function importPastedImage(file: File, insertImage: RichEditorImageInserter) {
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
      insertImage(attachment.id, attachment.filename, dataUrl)
      setNotice('Image attached')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function uploadEditorImage({ file, insertImage }: RichEditorImageUpload, entryId: string | null) {
    if (!activeSession) {
      setError('Open a note before uploading images.')
      return
    }

    if (entryId && !noteEntry) {
      setError('Open an editable note before uploading note images.')
      return
    }

    try {
      setBusyAction('attach-image')
      setError(null)
      const dataUrl = await readFileAsDataUrl(file)
      const filename = pastedImageFilename(file)
      const attachment = await importClipboardScreenshot({
        sessionId: activeSession.id,
        entryId,
        filename,
        dataUrl,
      })
      insertImage(attachment.id, attachment.filename, dataUrl)
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

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void boot()
    }, 0)
    return () => window.clearTimeout(timeout)
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
            pendingAiActions={pendingAiActions}
            onAiAction={handleAiAction}
            onCopyNote={handleCopyNoteForJira}
            onDeleteNote={requestDeleteNote}
            onNewNote={handleNewNote}
            onOpenNote={openNote}
            onSetNoteBody={setNoteBody}
            onSetNoteTitle={setNoteTitle}
            onUploadImage={(input) => {
              if (!noteEntry) {
                setError('Open an editable note before uploading note images.')
                return
              }
              return uploadEditorImage(input, noteEntry.id)
            }}
          />
        ) : null}

        {activeView === 'testware' ? (
          <TestwareView
            busyAction={busyAction}
            drafts={testwareDrafts}
            notice={notice}
            error={error}
            isBusy={isBusy}
            activeGenerationJob={activeTestwareJob}
            onCancelGenerationJob={handleCancelGenerationJob}
            onCopyDraft={handleCopyDraftForJira}
            onDeleteDraft={requestDeleteDraft}
            onManualCreate={handleManualTestware}
            onPrefillFromNote={handlePrefillTestwareFromNote}
            onSaveDraft={handleSaveDraft}
            onUploadImage={(input) => uploadEditorImage(input, null)}
            updateLocalDraft={updateLocalDraft}
          />
        ) : null}

        {activeView === 'findings' ? (
          <FindingsView
            busyAction={busyAction}
            findings={findings}
            notice={notice}
            error={error}
            isBusy={isBusy}
            activeGenerationJob={activeFindingJob}
            onCancelGenerationJob={handleCancelGenerationJob}
            onCopyFinding={handleCopyFindingForJira}
            onDeleteFinding={requestDeleteFinding}
            onManualCreate={handleManualFinding}
            onPrefillFromNote={handlePrefillFindingFromNote}
            onSaveFinding={handleSaveFinding}
            onUploadImage={(input) => uploadEditorImage(input, null)}
            updateLocalFinding={updateLocalFinding}
          />
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

      {deleteConfirmation && deleteCopy ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title">
            <div>
              <p className="eyebrow">Confirm delete</p>
              <h2 id="delete-dialog-title">{deleteCopy.title}</h2>
              <p>{deleteCopy.body}</p>
            </div>
            <div className="confirmation-actions">
              <button className="secondary-button" type="button" disabled={isBusy} onClick={() => setDeleteConfirmation(null)}>
                Cancel
              </button>
              <button className="primary-button danger-button" type="button" disabled={isBusy} onClick={() => void confirmDelete()}>
                {deleteCopy.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}

function renderPrefilledTestware(title: string, body: string): string {
  const note = stripHtml(body) || 'Add source note detail.'
  return [
    `<h2>${escapeHtml(title)} Test Cases</h2>`,
    '<h3>Source note</h3>',
    `<p>${escapeHtml(note)}</p>`,
    '<h3>Test cases</h3>',
    '<ol>',
    '<li><p><strong>Scenario:</strong> Describe the behavior under test.</p><p><strong>Steps:</strong> Add concise steps.</p><p><strong>Expected result:</strong> Describe the expected outcome.</p></li>',
    '</ol>',
  ].join('')
}

function renderPrefilledFinding(body: string): string {
  const note = stripHtml(body).slice(0, 4000) || 'Describe the finding.'
  return [
    '<h2>Finding detail</h2>',
    `<p>${escapeHtml(note)}</p>`,
    '<h3>Reproduction</h3>',
    '<ol><li>Add the first reproduction step.</li><li>Add the expected and actual result.</li></ol>',
    '<h3>Impact</h3>',
    '<p>Describe user impact and risk.</p>',
  ].join('')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
