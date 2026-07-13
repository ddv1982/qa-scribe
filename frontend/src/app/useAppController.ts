import { useEffect, useMemo, useRef, useState } from 'react'
import { type GenerateAiActionKind } from '../tauri'
import { richEditorDocumentToPlainText, serializeRichEditorDocument } from '../editor/editorDocument'
import { managedAttachmentReferencesForClipboard } from '../editor/clipboardExport'
import { countWords } from '../ui/format'
import type { PendingAiActions, MainView } from '../ui/types'
import { useSettingsController } from '../hooks/useSettingsController'
import { deleteConfirmationCopy } from '../workflows/deleteConfirmation'
import { useAttachmentActions } from './attachmentActions'
import { useCopyActions } from './copyActions'
import { generationIsActive, useGenerationActions } from './generationActions'
import { useRecordActions } from './recordActions'
import { useSessionActions } from './sessionActions'
import type {
  AiSelection,
  RecordWorkspace,
  WorkflowNavigation,
} from './types'
import { useAppStartup } from './useAppStartup'
import { usePendingChangeProtection } from './usePendingChangeProtection'
import { useRecordHydration } from './useRecordHydration'
import { useSessionWorkspace } from './useSessionWorkspace'
import { useWorkflowFeedback } from './useWorkflowFeedback'
import { useGenerationWorkspace } from './useGenerationWorkspace'
import { useDeletionWorkspace } from './useDeletionWorkspace'

export { mergeRecordLists } from './useRecordHydration'

export function useAppController() {
  const {
    sessions,
    activeSession,
    noteEntry,
    sessionLibraryComplete,
    sessionTitle,
    noteBody,
    noteBodyHtml,
    savedTitleRef,
    savedBodyRef,
    suppressAmbientNoteSaveRef,
    setSessions,
    setSessionLibraryComplete,
    setSessionTitle,
    setNoteBody,
    workspace: sessionWorkspace,
  } = useSessionWorkspace()
  const { busyAction, copiedTarget, notice, error, setBusyAction, setNotice, setError, feedback, copyFeedback } = useWorkflowFeedback()
  const {
    generationJobs,
    pendingGenerationAction,
    latestNoteGenerationUndo,
    setPendingGenerationAction,
    setLatestNoteGenerationUndo,
    workspace: generationWorkspace,
  } = useGenerationWorkspace()
  const { deleteConfirmation, setDeleteConfirmation, workspace: deletion } = useDeletionWorkspace()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<MainView>('sessions')
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
  const noteScreenshotCount = useMemo(
    () => managedAttachmentReferencesForClipboard({ title: sessionTitle, bodyHtml: noteBodyHtml }).length,
    [noteBodyHtml, sessionTitle],
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

  const recordWorkspace: RecordWorkspace = {
    drafts,
    findings,
    dirtyDraftIdsRef,
    dirtyFindingIdsRef,
    draftsRef,
    findingsRef,
    setDrafts,
    setFindings,
    setTestwareDraftCount,
    setFindingCount,
  }
  const selection: AiSelection = {
    selectedProvider,
    selectedModel,
    selectedReasoningEffort,
  }
  const navigation: WorkflowNavigation = {
    setActiveView,
  }
  const attachmentActions = useAttachmentActions({ session: sessionWorkspace, feedback })
  const sessionActions = useSessionActions({
    session: sessionWorkspace,
    records: recordWorkspace,
    generation: generationWorkspace,
    feedback,
    navigation,
    deletion,
    materializeInlineImages: attachmentActions.materializeInlineImages,
    invalidateRecordLoads,
    resetRecordHydration,
    saveDirtyRecordsNow: () => saveDirtyRecordsNowRef.current(),
  })
  const generationActions = useGenerationActions({
    session: sessionWorkspace,
    records: recordWorkspace,
    generation: generationWorkspace,
    selection,
    feedback,
    navigation,
    saveNoteNow: sessionActions.saveNoteNow,
  })
  const recordActions = useRecordActions({
    session: sessionWorkspace,
    records: recordWorkspace,
    feedback,
    navigation,
    deletion,
    saveNoteNow: sessionActions.saveNoteNow,
    handleDeleteSession: sessionActions.handleDeleteSession,
    materializeInlineImages: attachmentActions.materializeInlineImages,
    loaders: {
      loadDraftsForSession,
      loadFindingsForSession,
    },
  })
  const copyActions = useCopyActions({ source: sessionWorkspace, feedback, copy: copyFeedback })

  useEffect(() => {
    saveDirtyRecordsNowRef.current = recordActions.saveDirtyRecordsNow
  })

  usePendingChangeProtection({
    hasActiveSession: Boolean(activeSession),
    hasNoteEntry: Boolean(noteEntry),
    sessionTitle,
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
    if (!activeSession || !bootedRef.current) return
    const trimmedTitle = sessionTitle.trim()
    if (!trimmedTitle || trimmedTitle === savedTitleRef.current) return

    const timeout = window.setTimeout(() => {
      if (suppressAmbientNoteSaveRef.current) return
      void sessionActions.saveTitle(trimmedTitle)
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [activeSession, sessionTitle]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to Session identity and title

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
    sessionTitle,
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
    setSessionTitle,
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
