import { useEffect, useRef, useState } from 'react'
import { serializeRichEditorDocument } from '../editor/editorDocument'
import type { MainView } from '../ui/types'
import { useSettingsController } from '../hooks/useSettingsController'
import { deleteConfirmationCopy } from '../workflows/deleteConfirmation'
import { useAttachmentActions, type AttachmentUploadOwner } from './attachmentActions'
import { useCopyActions } from './copyActions'
import { useGenerationActions } from './generationActions'
import { useRecordActions } from './recordActions'
import { useSessionActions } from './sessionActions'
import type { AiSelection, RecordWorkspace, WorkflowNavigation } from './types'
import { useAppStartup } from './useAppStartup'
import { usePendingChangeProtection } from './usePendingChangeProtection'
import { useRecordHydration } from './useRecordHydration'
import { useSessionWorkspace } from './useSessionWorkspace'
import { useWorkflowFeedback } from './useWorkflowFeedback'
import { useGenerationWorkspace } from './useGenerationWorkspace'
import { useDeletionWorkspace } from './useDeletionWorkspace'
import { useOutputLibraries } from './useOutputLibraries'
import { navigationHash, parseNavigationRoute } from './navigationRoute'
import { createOpenGenerationPreflight } from './generationPreflightAction'
import { useSettingsDiscovery } from './useSettingsDiscovery'
import {
  useAppControllerGenerationState,
  useAppControllerPresentationState,
} from './useAppController.derivedState'
import { useAppControllerNavigation } from './useAppController.navigation'

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
    setLatestNoteGenerationUndo: setLatestNoteGenerationUndoState,
    workspace: generationWorkspace,
  } = useGenerationWorkspace()
  const latestNoteGenerationUndoRef = useRef(latestNoteGenerationUndo)
  function setLatestNoteGenerationUndo(value: Parameters<typeof setLatestNoteGenerationUndoState>[0]) {
    const next = typeof value === 'function' ? value(latestNoteGenerationUndoRef.current) : value
    latestNoteGenerationUndoRef.current = next
    setLatestNoteGenerationUndoState(next)
  }
  const coordinatedGenerationWorkspace = {
    ...generationWorkspace,
    latestNoteGenerationUndo,
    setLatestNoteGenerationUndo,
  }
  const { deleteConfirmation, setDeleteConfirmation, workspace: deletion } = useDeletionWorkspace()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<MainView>('sessions')
  const [pendingNavigationView, setPendingNavigationView] = useState<MainView | null>(null)
  const pendingNavigationContinuationRef = useRef<(() => void | Promise<void>) | null>(null)
  const pendingNavigationEpochRef = useRef(0)
  const [pendingSettingsSection, setPendingSettingsSection] = useState<string | null>(null)
  const [settingsSection, setSettingsSection] = useState<string | null>(null)
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null)
  const initialNavigationRouteRef = useRef(parseNavigationRoute(window.location.hash))
  const navigationRouteHydratedRef = useRef(false)
  const settingsReturnViewRef = useRef<MainView>('sessions')
  const outputLibraries = useOutputLibraries(activeView)
  const saveDirtyRecordsNowRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const retryPendingRecordCompensationsRef = useRef<(sessionId: string) => Promise<boolean>>(() => Promise.resolve(true))
  const summaryRecovery = {
    recoveredJobsRef: useRef(new Map<string, (typeof generationJobs)[string]>()),
    unresolvedSummaryJobsRef: useRef(new Map<string, string>()),
    completedSummaryEntriesRef: useRef(new Map<string, NonNullable<typeof noteEntry>>()),
    openingSessionIdRef: useRef<string | null>(null),
    discoveryPendingRef: useRef(true),
    blockedSaveSessionIdsRef: useRef(new Set<string>()),
  }
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
    invalidateDraftLoads,
    invalidateFindingLoads,
    resetRecordHydration,
    suspendRecordLoads,
    restoreRecordLoads,
    loadDraftsForSession,
    loadFindingsForSession,
  } = useRecordHydration({ activeSessionId: activeSession?.id ?? null, activeView })
  const {
    draftScreenshotCounts, filteredSessions, findingScreenshotCounts,
    noteScreenshotCount, noteWordCount, testwareDrafts,
  } = useAppControllerPresentationState({
    drafts, findings, noteBody, noteBodyHtml, searchQuery, sessionTitle, sessions,
  })
  const openGenerationPreflight = createOpenGenerationPreflight(
    activeProvider, refreshProviderStatus, setBusyAction, setPendingGenerationAction,
  )
  const noteIsReady = Boolean(activeSession && noteEntry)
  const sessionTitleValidationError = activeSession && !sessionTitle.trim()
    ? 'Session title is required.'
    : null
  const pendingRecoveredSummaryDecision = Boolean(
    latestNoteGenerationUndo?.pendingRecoveryDecision
    && latestNoteGenerationUndo.entryId === noteEntry?.id,
  )
  /* eslint-disable react-hooks/refs -- these write-through refs are the authoritative retry baselines; every mutation is paired with state that schedules a render. */
  const sessionHasPendingChanges = Boolean(
    pendingRecoveredSummaryDecision
    || (activeSession && sessionTitle !== savedTitleRef.current)
    || (noteEntry && serializeRichEditorDocument(noteBody) !== savedBodyRef.current),
  )
  /* eslint-enable react-hooks/refs */
  const sessionSaveState = sessionTitleValidationError
    ? 'invalid' as const
    : busyAction === 'save-title' || busyAction === 'save-body'
      ? 'saving' as const
      : sessionHasPendingChanges
        ? 'unsaved' as const
        : 'saved' as const
  const isBusy = busyAction !== null
  const deleteCopy = deleteConfirmation ? deleteConfirmationCopy(deleteConfirmation) : null
  const { activeFindingJob, activeTestwareJob, pendingAiActions } = useAppControllerGenerationState({
    activeSession, generationJobs,
  })

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
  const registerImportedAttachmentRef = useRef<(owner: AttachmentUploadOwner, attachmentId: string) => void>(() => {})
  const attachmentActions = useAttachmentActions({
    session: sessionWorkspace,
    feedback,
    registerImportedAttachment: (owner, attachmentId) => {
      registerImportedAttachmentRef.current(owner, attachmentId)
    },
  })
  const sessionActions = useSessionActions({
    session: sessionWorkspace,
    records: recordWorkspace,
    generation: coordinatedGenerationWorkspace, latestNoteGenerationUndoRef, summaryRecovery,
    feedback,
    navigation,
    deletion,
    materializeInlineImages: attachmentActions.materializeInlineImages,
    cleanupMaterializedAttachments: attachmentActions.cleanupMaterializedAttachments,
    suspendRecordLoads,
    restoreRecordLoads,
    resetRecordHydration,
    saveDirtyRecordsNow: () => saveDirtyRecordsNowRef.current(),
    retryPendingRecordCompensations: (sessionId) => retryPendingRecordCompensationsRef.current(sessionId),
  })
  function setEditedSessionTitle(value: Parameters<typeof setSessionTitle>[0]) {
    const next = typeof value === 'function' ? value(sessionWorkspace.sessionTitleRef.current) : value
    if (next === sessionWorkspace.sessionTitleRef.current) return
    sessionActions.registerTitleEditIntent()
    setSessionTitle(next)
  }
  function setEditedNoteBody(value: Parameters<typeof setNoteBody>[0]) {
    const next = typeof value === 'function' ? value(sessionWorkspace.noteBodyRef.current) : value
    sessionActions.registerNoteEditIntent(next)
    const recoveryDecision = latestNoteGenerationUndoRef.current
    if (recoveryDecision?.pendingRecoveryDecision) {
      setLatestNoteGenerationUndo(recoveryDecision.pendingRecoveryChoice === 'authored'
        ? { ...recoveryDecision, before: next }
        : { ...recoveryDecision, generated: next, pendingRecoveryChoice: 'generated' })
    } else {
      setLatestNoteGenerationUndo(null)
    }
    setNoteBody(next)
  }
  const recordActions = useRecordActions({
    session: sessionWorkspace,
    records: recordWorkspace,
    feedback,
    navigation,
    deletion,
    saveNoteNow: sessionActions.saveNoteNow,
    registerRecordEditIntent: sessionActions.registerRecordEditIntent,
    handleDeleteSession: sessionActions.handleDeleteSession,
    materializeInlineImages: attachmentActions.materializeInlineImages,
    cleanupMaterializedAttachments: attachmentActions.cleanupMaterializedAttachments,
    invalidateDraftLoads,
    invalidateFindingLoads,
    loaders: {
      loadDraftsForSession,
      loadFindingsForSession,
    },
  })
  const generationActions = useGenerationActions({
    session: sessionWorkspace,
    records: recordWorkspace,
    generation: coordinatedGenerationWorkspace, latestNoteGenerationUndoRef, summaryRecovery,
    selection,
    feedback,
    navigation,
    saveNoteNow: sessionActions.saveNoteNow,
    saveNoteBody: sessionActions.saveBody,
    adoptCanonicalNoteBody: sessionActions.adoptCanonicalNoteBody,
    canonicalizeGeneratedDraft: recordActions.canonicalizeGeneratedDraft,
    canonicalizeGeneratedFinding: recordActions.canonicalizeGeneratedFinding,
  })
  const copyActions = useCopyActions({ source: sessionWorkspace, feedback, copy: copyFeedback })
  const {
    applyNavigationRoute, cancelPendingNavigation, closeSettings, discardPendingNavigationChanges,
    hasPendingCompensations, openLibraryRecord, openSessionInCurrentView, openSettingsSection,
    requestActiveView, requestNewSession, requestOpenSession, saveAllPendingChanges,
    savePendingNavigationChanges,
  } = useAppControllerNavigation({
    activeSession, activeView, attachmentActions, dirtyDraftIdsRef, dirtyFindingIdsRef,
    discardSettingsDraft, focusedRecordId, pendingNavigationContinuationRef, pendingNavigationEpochRef,
    pendingNavigationView, pendingRecoveredSummaryDecision, recordActions, savedTitleRef, saveSettingsDraft,
    sessionActions, sessions, sessionTitle, sessionWorkspace, settingsDirty, settingsReturnViewRef, settingsSection,
    setActiveView, setError, setFocusedRecordId, setPendingNavigationView, setPendingSettingsSection, setSettingsSection,
  })

  useEffect(() => {
    registerImportedAttachmentRef.current = (owner, attachmentId) => {
      if (owner.kind === 'note') sessionActions.registerImportedNoteAttachment(owner.id, attachmentId)
      else recordActions.registerImportedRecordAttachment({ kind: owner.kind, id: owner.id }, attachmentId)
    }
    saveDirtyRecordsNowRef.current = recordActions.saveDirtyRecordsNow
    retryPendingRecordCompensationsRef.current = recordActions.retryPendingRecordCompensations
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
    pendingRecoveredSummaryDecision,
    dirtyDraftIdsRef,
    dirtyFindingIdsRef,
    settingsDirty,
    hasPendingCompensations,
    savePendingChanges: saveAllPendingChanges,
  })

  const { bootedRef, handleLoadSessionLibrary, handleRefreshProviderStatus, handleSaveSettings } = useAppStartup({
    loadSettings,
    openSession: sessionActions.openSession, captureActiveJobs: generationActions.captureActiveJobs,
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
    if (!trimmedTitle || sessionTitle === savedTitleRef.current) return

    const timeout = window.setTimeout(() => {
      if (suppressAmbientNoteSaveRef.current) return
      void sessionActions.saveTitle(sessionTitle)
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [activeSession, sessionTitle]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to Session identity and title

  useEffect(() => {
    if (!noteEntry || !bootedRef.current) return
    const nextBody = serializeRichEditorDocument(noteBody)
    if (nextBody === savedBodyRef.current) return
    // Recovery conflicts require an explicit save/discard choice. Ambient
    // autosave must not silently choose the authored side of that decision.
    if (pendingRecoveredSummaryDecision) return

    const timeout = window.setTimeout(() => {
      if (suppressAmbientNoteSaveRef.current) return
      void sessionActions.saveNoteNow()
    }, 850)
    return () => window.clearTimeout(timeout)
  }, [noteEntry, noteBody, pendingRecoveredSummaryDecision]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity, body, and recovery decision

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
    sessionTitleValidationError,
    sessionSaveState,
    noteWordCount,
    closeSettings,
    openSettingsSection,
    openSessionInCurrentView,
    openSession: requestOpenSession,
    handleNewSession: requestNewSession,
    openLibraryRecord,
    openGenerationPreflight,
    notice,
    pendingAiActions,
    pendingGenerationAction,
    pendingNavigationView,
    pendingRecoveredSummaryDecision,
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
    setNoteBody: setEditedNoteBody,
    setSessionTitle: setEditedSessionTitle,
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
