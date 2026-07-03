import { useEffect, useMemo, useRef, useState } from 'react'
import { getSettings, listSessions, type Draft, type Entry, type Finding, type GenerateAiActionKind, type GenerationJobStatus, type Session } from '../tauri'
import { emptyRichEditorDocument, richEditorDocumentToHtml, richEditorDocumentToPlainText, serializeRichEditorDocument } from '../editor/editorDocument'
import { managedAttachmentReferencesForClipboard } from '../editor/clipboardExport'
import { countWords, formatError } from '../ui/format'
import type { BusyAction, PendingAiActions, WorkspaceView } from '../ui/types'
import { useSettingsController } from '../hooks/useSettingsController'
import { deleteConfirmationCopy, type DeleteConfirmation } from '../workflows/deleteConfirmation'
import { createAttachmentActions } from './attachmentActions'
import { createCopyActions } from './copyActions'
import { createGenerationActions, generationIsActive } from './generationActions'
import { createRecordActions } from './recordActions'
import { createSessionActions } from './sessionActions'
import type { AppWorkflowContext, CopiedTarget, LatestNoteGenerationUndo } from './types'

export function useAppController() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [noteEntry, setNoteEntry] = useState<Entry | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [noteTitle, setNoteTitle] = useState('')
  const [noteBody, setNoteBody] = useState(emptyRichEditorDocument)
  const [generationJobs, setGenerationJobs] = useState<Record<string, GenerationJobStatus>>({})
  const [busyAction, setBusyAction] = useState<BusyAction | null>('boot')
  const [copiedTarget, setCopiedTarget] = useState<CopiedTarget | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<WorkspaceView>('notes')
  const [pendingGenerationAction, setPendingGenerationAction] = useState<GenerateAiActionKind | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
  const [latestNoteGenerationUndo, setLatestNoteGenerationUndo] = useState<LatestNoteGenerationUndo | null>(null)

  const savedTitleRef = useRef('')
  const savedBodyRef = useRef(serializeRichEditorDocument(emptyRichEditorDocument))
  const noteBodyRef = useRef(emptyRichEditorDocument)
  const noteBodyWriteVersionRef = useRef(0)
  const deletingSessionIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const noteEntryIdRef = useRef<string | null>(null)
  const copySuccessResetRef = useRef<number | null>(null)
  const bootedRef = useRef(false)
  const saveNoteNowRef = useRef<() => Promise<boolean>>(async () => true)
  const {
    activeProvider,
    loadProviderStatus,
    loadSettings,
    providerStatus,
    refreshProviderStatus,
    selectedModel,
    selectedProvider,
    selectedReasoningEffort,
    setTheme,
    settingsDraft,
    settingsSaveState,
    theme,
    updateSettingsDraft,
    handleSaveSettings: saveSettingsDraft,
  } = useSettingsController({ setError, setNotice })

  const testwareDrafts = drafts.filter((draft) => draft.kind === 'testware')
  const noteBodyHtml = useMemo(() => richEditorDocumentToHtml(noteBody), [noteBody])
  const noteScreenshotCount = useMemo(
    () => managedAttachmentReferencesForClipboard({ title: noteTitle, bodyHtml: noteBodyHtml }).length,
    [noteBodyHtml, noteTitle],
  )
  const draftScreenshotCounts = useMemo(
    () =>
      Object.fromEntries(
        testwareDrafts.map((draft) => [
          draft.id,
          managedAttachmentReferencesForClipboard({ title: draft.title, bodyHtml: draft.body }).length,
        ]),
      ),
    [testwareDrafts],
  )
  const findingScreenshotCounts = useMemo(
    () =>
      Object.fromEntries(
        findings.map((finding) => [
          finding.id,
          managedAttachmentReferencesForClipboard({ title: finding.title, bodyHtml: finding.body }).length,
        ]),
      ),
    [findings],
  )
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    if (!query) return sessions
    return sessions.filter((session) => session.title.toLocaleLowerCase().includes(query))
  }, [sessions, searchQuery])
  const noteWordCount = countWords(richEditorDocumentToPlainText(noteBody))
  const noteIsReady = Boolean(activeSession && noteEntry)
  const isBusy = busyAction !== null
  const deleteCopy = deleteConfirmation ? deleteConfirmationCopy(deleteConfirmation) : null
  const activeSessionJobs = useMemo(
    () => Object.values(generationJobs).filter((job) => activeSession && job.sessionId === activeSession.id && generationIsActive(job)),
    [generationJobs, activeSession],
  )
  const pendingAiActions = useMemo<PendingAiActions>(() => {
    const pending: PendingAiActions = {}
    // `job.action` is the backend's `GenerationJobStatus.action: String`, which
    // is always a `GenerateAiActionKind` value.
    for (const job of activeSessionJobs) pending[job.action as GenerateAiActionKind] = true
    return pending
  }, [activeSessionJobs])
  const activeTestwareJob = activeSessionJobs.find((job) => job.action === 'testware') ?? null
  const activeFindingJob = activeSessionJobs.find((job) => job.action === 'finding') ?? null

  const workflowContext: AppWorkflowContext = {
    activeSession,
    noteEntry,
    drafts,
    findings,
    sessions,
    testwareDrafts,
    noteTitle,
    noteBody,
    noteBodyHtml,
    selectedProvider,
    selectedModel,
    selectedReasoningEffort,
    latestNoteGenerationUndo,
    deleteConfirmation,
    savedTitleRef,
    savedBodyRef,
    noteBodyRef,
    noteBodyWriteVersionRef,
    deletingSessionIdRef,
    activeSessionIdRef,
    noteEntryIdRef,
    copySuccessResetRef,
    setSessions,
    setActiveSession,
    setNoteEntry,
    setDrafts,
    setFindings,
    setNoteTitle,
    setNoteBody,
    setGenerationJobs,
    setBusyAction,
    setCopiedTarget,
    setNotice,
    setError,
    setActiveView,
    setDeleteConfirmation,
    setLatestNoteGenerationUndo,
  }
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const attachmentActions = createAttachmentActions(workflowContext)
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const sessionActions = createSessionActions(workflowContext, attachmentActions.materializeInlineImages)
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const generationActions = createGenerationActions(workflowContext, sessionActions.saveNoteNow)
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const recordActions = createRecordActions(workflowContext, sessionActions.saveNoteNow, sessionActions.handleDeleteNote)
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const copyActions = createCopyActions(workflowContext)

  useEffect(() => {
    saveNoteNowRef.current = sessionActions.saveNoteNow
  })

  async function boot() {
    try {
      setBusyAction('boot')
      setError(null)
      const [nextSettings, nextSessions] = await Promise.all([getSettings(), listSessions()])
      loadSettings(nextSettings)
      setSessions(nextSessions)
      bootedRef.current = true
      if (nextSessions[0]) {
        await sessionActions.openNote(nextSessions[0], false)
      } else {
        setNotice('Create a note to start')
      }
      window.setTimeout(() => {
        void loadProviderStatusAfterBoot()
      }, 0)
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function loadProviderStatusAfterBoot() {
    try {
      await loadProviderStatus()
      await refreshProviderStatus()
    } catch (cause) {
      setError(formatError(cause))
    }
  }

  async function handleRefreshProviderStatus() {
    try {
      setBusyAction('refresh-providers')
      setError(null)
      await refreshProviderStatus()
      setNotice('Provider status refreshed')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveSettings() {
    try {
      setBusyAction('save-settings')
      await saveSettingsDraft()
    } finally {
      setBusyAction(null)
    }
  }

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id ?? null
    noteEntryIdRef.current = noteEntry?.id ?? null
  }, [activeSession?.id, noteEntry?.id])

  useEffect(() => {
    noteBodyRef.current = noteBody
  }, [noteBody])

  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup must clear the latest copy-success timeout.
      const resetTimeout = copySuccessResetRef.current
      if (resetTimeout) window.clearTimeout(resetTimeout)
    }
  }, [])

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
      void sessionActions.saveTitle(trimmedTitle)
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [activeSession, noteTitle]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity and title

  useEffect(() => {
    if (!noteEntry || !bootedRef.current) return
    const nextBody = serializeRichEditorDocument(noteBody)
    if (nextBody === savedBodyRef.current) return

    const timeout = window.setTimeout(() => {
      void sessionActions.saveNoteNow()
    }, 850)
    return () => window.clearTimeout(timeout)
  }, [noteEntry, noteBody]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity and body

  useEffect(() => {
    function handleBeforeUnload() {
      void saveNoteNowRef.current()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  return {
    ...attachmentActions,
    ...copyActions,
    ...generationActions,
    ...recordActions,
    ...sessionActions,
    activeFindingJob,
    activeProvider,
    activeTestwareJob,
    activeSession,
    activeView,
    busyAction,
    copiedTarget,
    deleteConfirmation,
    deleteCopy,
    draftScreenshotCounts,
    error,
    filteredSessions,
    findingScreenshotCounts,
    findings,
    isBusy,
    latestNoteGenerationUndo,
    noteBody,
    noteEntry,
    noteIsReady,
    noteScreenshotCount,
    noteTitle,
    noteWordCount,
    notice,
    pendingAiActions,
    pendingGenerationAction,
    providerStatus,
    searchQuery,
    selectedModel,
    selectedProvider,
    sessions,
    settingsDraft,
    settingsSaveState,
    setActiveView,
    setDeleteConfirmation,
    setError,
    setLatestNoteGenerationUndo,
    setNoteBody,
    setNoteTitle,
    setPendingGenerationAction,
    setSearchQuery,
    setTheme,
    testwareDrafts,
    theme,
    updateSettingsDraft,
    uploadEditorImage: attachmentActions.uploadEditorImage,
    handleRefreshProviderStatus,
    handleSaveSettings,
  }
}

export type AppController = ReturnType<typeof useAppController>
