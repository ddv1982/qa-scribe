import { useEffect, useMemo, useRef, useState } from 'react'
import { reopenSession, type GenerateAiActionKind } from '../tauri'
import { richEditorDocumentToPlainText, serializeRichEditorDocument } from '../editor/editorDocument'
import { managedAttachmentReferencesForClipboard } from '../editor/clipboardExport'
import { countWords, formatError } from '../ui/format'
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
import { useOutputLibraries } from './useOutputLibraries'
import { navigationHash, parseNavigationRoute, type AppNavigationRoute } from './navigationRoute'
import { createOpenGenerationPreflight } from './generationPreflightAction'
import { useSettingsDiscovery } from './useSettingsDiscovery'

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
  const [pendingNavigationView, setPendingNavigationView] = useState<MainView | null>(null)
  const [pendingSettingsSection, setPendingSettingsSection] = useState<string | null>(null)
  const [settingsSection, setSettingsSection] = useState<string | null>(null)
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null)
  const initialNavigationRouteRef = useRef(parseNavigationRoute(window.location.hash))
  const navigationRouteHydratedRef = useRef(false)
  const settingsReturnViewRef = useRef<MainView>('sessions')
  const outputLibraries = useOutputLibraries(activeView)
  const saveDirtyRecordsNowRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const {
    activeProvider,
    discoverProviderDefaults,
    discardSettingsDraft,
    effectiveAiSelection,
    loadProviderStatus,
    loadSettings,
    providerDiscoveryState,
    providerStatus,
    refreshProviderStatus,
    selectedModel,
    selectedProvider,
    selectedReasoningEffort,
    setTheme,
    settingsDraft,
    settingsDirty,
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
    draftLoadError,
    draftLoadState,
    findingLoadError,
    findingLoadState,
    draftsRef,
    findingsRef,
    savedDraftsRef,
    savedFindingsRef,
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
  } = useRecordHydration({ activeSessionId: activeSession?.id ?? null, activeView })

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
  const openGenerationPreflight = createOpenGenerationPreflight(
    activeProvider, refreshProviderStatus, setBusyAction, setPendingGenerationAction,
  )
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
    savedDraftsRef,
    savedFindingsRef,
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
  function requestActiveView(view: MainView) {
    if (view === activeView) return
    if (settingsDirty || dirtyDraftIdsRef.current.size > 0 || dirtyFindingIdsRef.current.size > 0) {
      setPendingNavigationView(view)
      return
    }
    setActiveView(view)
  }

  function openSettingsSection(sectionId?: string) {
    if (activeView !== 'settings') settingsReturnViewRef.current = activeView
    const nextSection = sectionId ?? null
    setSettingsSection(nextSection)
    setPendingSettingsSection(nextSection)
    requestActiveView('settings')
  }

  function closeSettings() { requestActiveView(settingsReturnViewRef.current) }
  function openSessionInCurrentView(session: (typeof sessions)[number]) {
    const destination = activeView === 'testware' || activeView === 'findings' ? activeView : 'sessions'
    return sessionActions.openSession(session, true, () => setActiveView(destination))
  }

  async function openLibraryRecord(sessionId: string, view: 'testware' | 'findings', recordId: string) {
    const session = sessions.find((candidate) => candidate.id === sessionId) ?? await reopenSession(sessionId)
    await sessionActions.openSession(session, false, () => {
      setFocusedRecordId(recordId)
      setActiveView(view)
    })
  }

  async function applyNavigationRoute(route: AppNavigationRoute) {
    if (route.kind === 'settings') {
      if (activeView !== 'settings') settingsReturnViewRef.current = activeView
      setSettingsSection(route.sectionId)
      setPendingSettingsSection(route.sectionId)
      requestActiveView('settings')
      return
    }
    if (route.kind === 'library') {
      requestActiveView(route.view)
      return
    }
    setFocusedRecordId(route.recordId)
    if (!route.sessionId || activeSession?.id === route.sessionId) {
      requestActiveView(route.view)
      return
    }
    try {
      const session = sessions.find((candidate) => candidate.id === route.sessionId) ?? await reopenSession(route.sessionId)
      await sessionActions.openSession(session, false, () => setActiveView(route.view))
    } catch (cause) {
      setError(`Could not open the linked workspace. ${formatError(cause)}`)
    }
  }

  async function savePendingNavigationChanges() {
    const recordsSaved = await recordActions.saveDirtyRecordsNow()
    const settingsSaved = !settingsDirty || await saveSettingsDraft()
    if (!recordsSaved || !settingsSaved || !pendingNavigationView) return
    setActiveView(pendingNavigationView)
    setPendingNavigationView(null)
  }

  function discardPendingNavigationChanges() {
    if (!pendingNavigationView) return
    recordActions.discardAllDirtyRecords()
    if (settingsDirty) discardSettingsDraft()
    setActiveView(pendingNavigationView)
    setPendingNavigationView(null)
  }

  function cancelPendingNavigation() {
    setPendingNavigationView(null)
    window.history.replaceState(null, '', navigationHash({
      activeView,
      sessionId: activeSession?.id ?? null,
      focusedRecordId,
      settingsSectionId: settingsSection,
    }))
  }

  async function saveAllPendingChanges(): Promise<boolean> {
    const sessionSaved = await sessionActions.savePendingSessionEdits()
    if (!sessionSaved) return false
    return !settingsDirty || saveSettingsDraft()
  }

  useEffect(() => {
    saveDirtyRecordsNowRef.current = recordActions.saveDirtyRecordsNow
  })

  useEffect(() => {
    if (activeView !== 'settings' || !pendingSettingsSection) return
    const timeout = window.setTimeout(() => {
      const section = document.getElementById(pendingSettingsSection)
      section?.scrollIntoView?.({ block: 'start' })
      section?.focus({ preventScroll: true })
      setPendingSettingsSection(null)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [activeView, pendingSettingsSection])

  useSettingsDiscovery(activeView, activeProvider, discoverProviderDefaults)

  usePendingChangeProtection({
    hasActiveSession: Boolean(activeSession),
    hasNoteEntry: Boolean(noteEntry),
    sessionTitle,
    noteBody,
    savedTitleRef,
    savedBodyRef,
    dirtyDraftIdsRef,
    dirtyFindingIdsRef,
    settingsDirty,
    savePendingChanges: saveAllPendingChanges,
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
    if (navigationRouteHydratedRef.current || !bootedRef.current || busyAction !== null) return
    const route = initialNavigationRouteRef.current
    navigationRouteHydratedRef.current = true
    if (!route) return
    const timeout = window.setTimeout(() => void applyNavigationRoute(route), 0)
    return () => window.clearTimeout(timeout)
  }, [activeSession, busyAction]) // eslint-disable-line react-hooks/exhaustive-deps -- hydrate the immutable launch route once after startup

  useEffect(() => {
    function handleHistoryNavigation() {
      const route = parseNavigationRoute(window.location.hash)
      if (route) void applyNavigationRoute(route)
    }
    window.addEventListener('hashchange', handleHistoryNavigation)
    return () => window.removeEventListener('hashchange', handleHistoryNavigation)
  })

  useEffect(() => {
    if (!navigationRouteHydratedRef.current) return
    const nextHash = navigationHash({
      activeView,
      sessionId: activeSession?.id ?? null,
      focusedRecordId,
      settingsSectionId: settingsSection,
    })
    if (window.location.hash !== nextHash) window.history.pushState(null, '', nextHash)
  }, [activeSession?.id, activeView, focusedRecordId, settingsSection])

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
    ...outputLibraries,
    activeFindingJob,
    activeProvider,
    discardSettingsDraft,
    effectiveAiSelection,
    activeTestwareJob,
    activeSession,
    activeView,
    busyAction,
    copiedTarget,
    deleteConfirmation,
    deleteCopy,
    draftScreenshotCounts,
    draftLoadError,
    draftLoadState,
    error,
    filteredSessions,
    findingCount,
    findingScreenshotCounts,
    findingLoadError,
    findingLoadState,
    findings,
    focusedRecordId,
    isBusy,
    latestNoteGenerationUndo,
    loadDraftsForSession,
    loadFindingsForSession,
    noteBody,
    noteEntry,
    noteIsReady,
    noteScreenshotCount,
    sessionTitle,
    noteWordCount,
    closeSettings,
    openSettingsSection,
    openSessionInCurrentView,
    openLibraryRecord,
    openGenerationPreflight,
    notice,
    pendingAiActions,
    pendingGenerationAction,
    pendingNavigationView,
    providerDiscoveryState,
    providerStatus,
    searchQuery,
    selectedModel,
    selectedProvider,
    sessionLibraryComplete,
    sessions,
    settingsDraft,
    settingsDirty,
    settingsSaveState,
    setActiveView: requestActiveView,
    setDeleteConfirmation,
    setError,
    setLatestNoteGenerationUndo,
    setNoteBody,
    setSessionTitle,
    setPendingGenerationAction,
    setSearchQuery,
    setTheme,
    savePendingNavigationChanges,
    discardPendingNavigationChanges,
    cancelPendingNavigation,
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
