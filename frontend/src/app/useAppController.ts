import { useCreationWorkspace } from './useCreationWorkspace'
import { useEffect, useRef, useState } from 'react'
import { serializeRichEditorDocument } from '../editor/editorDocument'
import type { MainView } from '../ui/types'
import { useSettingsController } from '../hooks/useSettingsController'
import { deleteConfirmationCopy } from '../workflows/deleteConfirmation'
import { useAttachmentActions } from './attachmentActions'
import { useCopyActions } from './copyActions'
import { useGenerationActions } from './generationActions'
import { useRecordPersistence } from './recordPersistence'
import { useRecordActions } from './recordActions'
import { useSessionActions } from './sessionActions'
import type { AiSelection, CreatedRecordEditTarget, RecordWorkspace, WorkflowNavigation } from './types'
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
import { useAppSettlement } from './appSettlement'
import { useAppControllerNavigation } from './useAppController.navigation'
import { useAttachmentCleanup } from './useAttachmentCleanup'
import { useSummaryRecovery } from './useSummaryRecovery'
import { useAskAiContext } from './useAskAiContext'
import { useSessionChat } from './useSessionChat'
import { useRefinementController } from './sessionChat.proposals'
import { useImportedAttachments } from './importedAttachments'
import { useStableCapability } from './useStableCapability'
import { createNoteEligibility } from './noteEligibility'
import { useChatNoteRecovery } from './useChatNoteRecovery'

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
  const { busyAction, notice, error, setBusyAction, setNotice, setError, feedback } = useWorkflowFeedback()
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
  const [createdRecordEditTarget, setCreatedRecordEditTarget] = useState<CreatedRecordEditTarget | null>(null)
  const initialNavigationRouteRef = useRef(parseNavigationRoute(window.location.hash))
  const navigationRouteHydratedRef = useRef(false)
  const settingsReturnViewRef = useRef<MainView>('sessions')
  const outputLibraries = useOutputLibraries(activeView)
  const summaryRecovery = useSummaryRecovery()
  const {
    activeProvider,
    captureSettingsCheckpoint,
    modelWritePending,
    persistModelChoice,
    settingsWritePending,
    settings,
    discoverProviderDefaults,
    discardSettingsDraft,
    effectiveAiSelection,
    loadProviderStatus,
    loadSettings,
    providerDiscoveryState,
    providerStatus,
    refreshProviderStatus,
    selectedModel, selectedProvider,
    selectedReasoningEffort,
    setTheme,
    settingsDraft,
    settingsDirty,
    settingsSaveState, settingsSaveError,
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
    latestNoteGenerationUndo?.kind === 'recovery-choice'
    && latestNoteGenerationUndo.entryId === noteEntry?.id,
  )
  /* oxlint-disable react-hooks/refs -- these write-through refs are the authoritative retry baselines; every mutation is paired with state that schedules a render. */
  const sessionHasPendingChanges = Boolean(
    pendingRecoveredSummaryDecision
    || (activeSession && sessionTitle !== savedTitleRef.current)
    || (noteEntry && serializeRichEditorDocument(noteBody) !== savedBodyRef.current),
  )
  /* oxlint-enable react-hooks/refs */
  const sessionSaveState = sessionTitleValidationError
    ? 'invalid' as const
    : busyAction === 'save-title' || busyAction === 'save-body'
      ? 'saving' as const
      : sessionHasPendingChanges
        ? 'unsaved' as const
        : 'saved' as const
  const isBusy = busyAction !== null
  const attachmentCleanup = useAttachmentCleanup(isBusy)
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
    modelWritePending,
    selectedProvider,
    selectedModel,
    selectedReasoningEffort,
  }
  const navigation: WorkflowNavigation = {
    setActiveView: (view) => { setCreatedRecordEditTarget(null); setActiveView(view) },
  }
  const importedAttachments = useImportedAttachments()
  const attachmentActions = useAttachmentActions({
    session: sessionWorkspace, feedback, registerImportedAttachment: importedAttachments.register,
  })
  const recordPersistence = useRecordPersistence({
    importedAttachments, session: sessionWorkspace, records: recordWorkspace, feedback,
    materializeInlineImages: attachmentActions.materializeInlineImages,
    cleanupMaterializedAttachments: attachmentActions.cleanupMaterializedAttachments,
  })
  const noteRecovery = useChatNoteRecovery()
  const noteEligibility = useStableCapability({ summary: summaryRecovery, chat: noteRecovery }, createNoteEligibility)
  const sessionActions = useSessionActions({
    session: sessionWorkspace, noteRecovery, noteEligibility, importedAttachments,
    records: recordWorkspace,
    generation: coordinatedGenerationWorkspace, latestNoteGenerationUndoRef, summaryRecovery,
    feedback,
    navigation,
    deletion,
    attachmentCleanup,
    materializeInlineImages: attachmentActions.materializeInlineImages,
    cleanupMaterializedAttachments: attachmentActions.cleanupMaterializedAttachments,
    suspendRecordLoads,
    restoreRecordLoads,
    resetRecordHydration,
    saveDirtyRecordsNow: recordPersistence.saveDirtyRecordsNow,
    retryPendingRecordCompensations: recordPersistence.retryPendingRecordCompensations,
  })
  const askAi = useAskAiContext(activeSession?.id ?? null, activeView, recordWorkspace)
  const { sessionChat: baseSessionChat, sessionMode, setSessionMode, noteReadOnly, ...chatProtection } = useSessionChat({
    session: sessionWorkspace, noteRecovery, noteEligibility, sessionActions, generation: coordinatedGenerationWorkspace,
    selection, provider: activeProvider, providerWarning: effectiveAiSelection?.warning ?? null,
    feedback, jobs: generationJobs, refreshProviderStatus, captureContext: askAi.capture, recordWritesPending: recordPersistence.coordination.hasPendingRecordCompensations,
  })
  function setEditedSessionTitle(value: Parameters<typeof setSessionTitle>[0]) {
    const next = typeof value === 'function' ? value(sessionWorkspace.sessionTitleRef.current) : value
    if (next === sessionWorkspace.sessionTitleRef.current) return
    sessionActions.registerTitleEditIntent()
    setSessionTitle(next)
  }
  function setEditedNoteBody(value: Parameters<typeof setNoteBody>[0]) {
    const next = typeof value === 'function' ? value(sessionWorkspace.noteBodyRef.current) : value
    if (!sessionActions.registerNoteEditIntent(next)) return
    const recoveryDecision = latestNoteGenerationUndoRef.current
    if (recoveryDecision?.kind === 'recovery-choice') {
      setLatestNoteGenerationUndo(recoveryDecision.choice === 'authored'
        ? { ...recoveryDecision, before: next }
        : { ...recoveryDecision, generated: next, choice: 'generated' })
    } else {
      setLatestNoteGenerationUndo(null)
    }
    setNoteBody(next)
  }
  const recordActions = useRecordActions({
    importedAttachments,
    session: sessionWorkspace,
    records: recordWorkspace,
    feedback,
    deletion,
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
  }, recordPersistence)
  const sessionChat = useRefinementController({ chat: baseSessionChat, askAi, records: recordWorkspace, actions: recordActions, persistence: recordPersistence, session: sessionWorkspace, openEditor: setCreatedRecordEditTarget, feedback })
  const generationActions = useGenerationActions({
    session: sessionWorkspace,
    records: recordWorkspace,
    generation: coordinatedGenerationWorkspace, latestNoteGenerationUndoRef, summaryRecovery,
    selection,
    feedback,
    navigation,
    saveNoteNow: sessionActions.saveNoteNow, noteEligibility,
    saveNoteBody: sessionActions.saveBody,
    adoptCanonicalNoteBody: sessionActions.adoptCanonicalNoteBody,
    canonicalizeGeneratedDraft: recordActions.canonicalizeGeneratedDraft,
    canonicalizeGeneratedFinding: recordActions.canonicalizeGeneratedFinding,
  })
  const { creation, creationIntent, creationDecision, consumeSelectedRecord } = useCreationWorkspace({
    sourceAllowed: !noteReadOnly, noteEntryIdRef: sessionWorkspace.noteEntryIdRef, navigationIsCurrent: sessionActions.sessionNavigationIsCurrent, publishJob: generationActions.storeGenerationStatus,
    activeSessionIdRef: sessionWorkspace.activeSessionIdRef, beginNavigation: () => beginSessionNavigation(),
    loadDraftsForSession, loadFindingsForSession, setActiveView, setError, setNotice, setCreatedRecordEditTarget,
    consumeCreatedRecordEditTarget: (target) => consumeCreatedRecordEditTarget(target),
  })
  const copyActions = useCopyActions()
  const settlement = useAppSettlement({
    creation, chat: chatProtection, sessionActions, recordActions, attachmentActions,
    dirtyDraftIdsRef, dirtyFindingIdsRef, settingsDirty, saveSettingsDraft, captureSettingsCheckpoint, modelWritePending,
  })
  const {
    applyNavigationRoute, cancelPendingNavigation, closeSettings, discardPendingNavigationChanges,
    openLibraryRecord, openSessionInCurrentView, openSettingsSection,
    requestActiveView, requestNewSession, requestOpenSession,
    savePendingNavigationChanges,
    beginSessionNavigation, consumeCreatedRecordEditTarget, requestCreation,
  } = useAppControllerNavigation({
    creation, chat: chatProtection,
    activeSession, activeSessionIdRef: sessionWorkspace.activeSessionIdRef, activeView, settlement, dirtyDraftIdsRef, dirtyFindingIdsRef,
    discardSettingsDraft, focusedRecordId, pendingNavigationContinuationRef, pendingNavigationEpochRef,
    pendingNavigationView, recordActions,
    sessionActions, sessions, settingsDirty, settingsReturnViewRef, settingsSection,
    setActiveView, setError, setFocusedRecordId, setCreatedRecordEditTarget, setPendingNavigationView, setPendingSettingsSection, setSettingsSection,
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
    hasPendingChanges: settlement.hasPendingChanges,
    savePendingChanges: () => creation.hasPendingChanges() ? creation.settle().then((settled) => settled ? settlement.flush() : false) : settlement.flush(),
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
  }, [activeSession, busyAction]) // oxlint-disable-line react-hooks/exhaustive-deps -- hydrate the immutable launch route once after startup

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
  }, [activeSession, sessionTitle]) // oxlint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to Session identity and title

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
  }, [noteEntry, noteBody, pendingRecoveredSummaryDecision]) // oxlint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity, body, and recovery decision

  return {
    sessionChat, sessionMode, setSessionMode, saveAllPendingChanges: settlement.flush, noteReadOnly,
    creation, creationIntent, creationDecision,
    createdRecordEditTarget, consumeCreatedRecordEditTarget: consumeSelectedRecord,
    attachmentCleanup, ...attachmentActions,
    ...copyActions,
    ...generationActions,
    handleCancelGenerationJob: (jobId: string) => creation.ownsGeneration(jobId) ? creation.cancelGeneration() : generationActions.handleCancelGenerationJob(jobId),
    ...recordActions,
    handleManualFinding: () => requestCreation('findings', (epoch) => creation.open('finding', () => sessionActions.sessionNavigationIsCurrent(epoch))),
    handleManualTestware: () => requestCreation('testware', (epoch) => creation.open('testware', () => sessionActions.sessionNavigationIsCurrent(epoch))),
    ...sessionActions,
    ...outputLibraries,
    activeFindingJob,
    activeProvider,
    discardSettingsDraft,
    effectiveAiSelection,
    activeTestwareJob,
    activeSession, activeView, askAi,
    busyAction, deleteConfirmation,
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
    noteBody, noteBodyHtml,
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
    openGenerationPreflight: (action: Parameters<typeof openGenerationPreflight>[0]) => action === 'summary' ? openGenerationPreflight(action)
      : requestCreation(action === 'finding' ? 'findings' : 'testware', (epoch) => creation.open(action, () => sessionActions.sessionNavigationIsCurrent(epoch), true)),
    notice,
    pendingAiActions,
    pendingGenerationAction,
    pendingNavigationView,
    pendingRecoveredSummaryDecision,
    providerDiscoveryState,
    providerStatus,
    searchQuery,
    selectedModel, selectedProvider,
    sessionLibraryComplete, sessions,
    settingsDraft,
    settingsDirty,
    settingsSaveState, settingsSaveError,
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
    persistModelChoice,
    settingsWritePending,
    selectedReasoningEffort,
    modelSelectionReady: Boolean(settings),
  }
}

export type AppController = ReturnType<typeof useAppController>
