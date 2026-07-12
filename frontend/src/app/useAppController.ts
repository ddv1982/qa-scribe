import { useEffect, useMemo, useRef, useState } from 'react'
import { type Entry, type GenerateAiActionKind, type GenerationJobStatus, type Session } from '../tauri'
import { emptyRichEditorDocument, richEditorDocumentToHtml, richEditorDocumentToPlainText, serializeRichEditorDocument } from '../editor/editorDocument'
import { managedAttachmentReferencesForClipboard } from '../editor/clipboardExport'
import { countWords } from '../ui/format'
import type { BusyAction, PendingAiActions, MainView } from '../ui/types'
import { useSettingsController } from '../hooks/useSettingsController'
import { deleteConfirmationCopy, type DeleteConfirmation } from '../workflows/deleteConfirmation'
import { createAttachmentActions } from './attachmentActions'
import { createCopyActions } from './copyActions'
import { createGenerationActions, generationIsActive } from './generationActions'
import { createRecordActions } from './recordActions'
import { createSessionActions } from './sessionActions'
import type { AppWorkflowContext, CopiedTarget, LatestNoteGenerationUndo } from './types'
import { useAppStartup } from './useAppStartup'
import { usePendingChangeProtection } from './usePendingChangeProtection'
import { useRecordHydration } from './useRecordHydration'

export { mergeRecordLists } from './useRecordHydration'

export function useAppController() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [noteEntry, setNoteEntry] = useState<Entry | null>(null)
  const [sessionLibraryComplete, setSessionLibraryComplete] = useState(false)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteBody, setNoteBody] = useState(emptyRichEditorDocument)
  const [generationJobs, setGenerationJobs] = useState<Record<string, GenerationJobStatus>>({})
  const [busyAction, setBusyAction] = useState<BusyAction | null>('boot')
  const [copiedTarget, setCopiedTarget] = useState<CopiedTarget | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<MainView>('notes')
  const [pendingGenerationAction, setPendingGenerationAction] = useState<GenerateAiActionKind | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
  const [latestNoteGenerationUndo, setLatestNoteGenerationUndo] = useState<LatestNoteGenerationUndo | null>(null)

  const savedTitleRef = useRef('')
  const savedBodyRef = useRef(serializeRichEditorDocument(emptyRichEditorDocument))
  const noteBodyRef = useRef(emptyRichEditorDocument)
  const noteTitleWriteVersionRef = useRef(0)
  const noteBodyWriteVersionRef = useRef(0)
  const deletingSessionIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const noteEntryIdRef = useRef<string | null>(null)
  const copySuccessResetRef = useRef<number | null>(null)
  const suppressAmbientNoteSaveRef = useRef(false)
  const forcedPendingSaveRef = useRef<Promise<boolean> | null>(null)
  const saveDirtyRecordsNowRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const {
    activeProvider,
    effectiveAiSelection,
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
  const {
    drafts,
    findings,
    testwareDraftCount,
    findingCount,
    draftsRef,
    findingsRef,
    dirtyDraftIdsRef,
    dirtyFindingIdsRef,
    setDrafts,
    setFindings,
    setTestwareDraftCount,
    setFindingCount,
    invalidateRecordLoads,
    resetRecordHydration,
    loadDraftsForSession,
    loadFindingsForSession,
  } = useRecordHydration({ activeSessionId: activeSession?.id ?? null, activeView, setError })

  // Memoized so its reference is stable across renders: `draftScreenshotCounts`
  // depends on it, and an inline `drafts.filter(...)` would produce a fresh array
  // every keystroke and re-run that DOMParser-backed memo needlessly.
  const testwareDrafts = useMemo(() => drafts.filter((draft) => draft.kind === 'testware'), [drafts])
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
  // Memoized: `richEditorDocumentToPlainText` walks/serializes the document, so
  // recomputing it on every unrelated render (e.g. a sibling state change) was
  // wasted work on the keystroke path.
  const noteWordCount = useMemo(() => countWords(richEditorDocumentToPlainText(noteBody)), [noteBody])
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
    testwareDraftCount,
    findingCount,
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
    noteTitleWriteVersionRef,
    noteBodyWriteVersionRef,
    deletingSessionIdRef,
    activeSessionIdRef,
    noteEntryIdRef,
    dirtyDraftIdsRef,
    dirtyFindingIdsRef,
    draftsRef,
    findingsRef,
    suppressAmbientNoteSaveRef,
    forcedPendingSaveRef,
    copySuccessResetRef,
    setSessions,
    setActiveSession,
    setNoteEntry,
    setDrafts,
    setFindings,
    setTestwareDraftCount,
    setFindingCount,
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
  const sessionActions = createSessionActions(workflowContext, attachmentActions.materializeInlineImages, invalidateRecordLoads, resetRecordHydration, () =>
    saveDirtyRecordsNowRef.current(),
  )
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const generationActions = createGenerationActions(workflowContext, sessionActions.saveNoteNow)
  /* eslint-disable react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects. */
  const recordActions = createRecordActions(
    workflowContext,
    sessionActions.saveNoteNow,
    sessionActions.handleDeleteSession,
    attachmentActions.materializeInlineImages,
    {
      loadDraftsForSession,
      loadFindingsForSession,
    },
  )
  /* eslint-enable react-hooks/refs */
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const copyActions = createCopyActions(workflowContext)

  useEffect(() => {
    saveDirtyRecordsNowRef.current = recordActions.saveDirtyRecordsNow
  })

  usePendingChangeProtection({
    hasActiveSession: Boolean(activeSession),
    hasNoteEntry: Boolean(noteEntry),
    noteTitle,
    noteBody,
    savedTitleRef,
    savedBodyRef,
    dirtyDraftIdsRef,
    dirtyFindingIdsRef,
    savePendingChanges: sessionActions.savePendingSessionEdits,
  })

  const { bootedRef, handleLoadSessionLibrary, handleRefreshProviderStatus, handleSaveSettings } = useAppStartup({
    loadSettings,
    openSession: sessionActions.openSession,
    reconcileActiveJobs: generationActions.reconcileActiveJobs,
    loadProviderStatus,
    refreshProviderStatus,
    saveSettingsDraft,
    setSessions,
    setSessionLibraryComplete,
    setBusyAction,
    setNotice,
    setError,
  })

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
    if (!activeSession || !bootedRef.current) return
    const trimmedTitle = noteTitle.trim()
    if (!trimmedTitle || trimmedTitle === savedTitleRef.current) return

    const timeout = window.setTimeout(() => {
      if (suppressAmbientNoteSaveRef.current) return
      void sessionActions.saveTitle(trimmedTitle)
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [activeSession, noteTitle]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity and title

  useEffect(() => {
    if (!noteEntry || !bootedRef.current) return
    const nextBody = serializeRichEditorDocument(noteBody)
    if (nextBody === savedBodyRef.current) return

    const timeout = window.setTimeout(() => {
      if (suppressAmbientNoteSaveRef.current) return
      void sessionActions.saveNoteNow()
    }, 850)
    return () => window.clearTimeout(timeout)
  }, [noteEntry, noteBody]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity and body

  return {
    ...attachmentActions,
    ...copyActions,
    ...generationActions,
    ...recordActions,
    ...sessionActions,
    activeFindingJob,
    activeProvider,
    effectiveAiSelection,
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
    findingCount,
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
    sessionLibraryComplete,
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
    testwareDraftCount,
    theme,
    updateSettingsDraft,
    uploadEditorImage: attachmentActions.uploadEditorImage,
    handleLoadSessionLibrary,
    handleRefreshProviderStatus,
    handleSaveSettings,
  }
}

export type AppController = ReturnType<typeof useAppController>
