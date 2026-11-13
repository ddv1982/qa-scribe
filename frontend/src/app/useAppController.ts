import { useCreationWorkspace } from './useCreationWorkspace'
import { useRef, useState } from 'react'
import type { MainView } from '../ui/types'
import { deleteConfirmationCopy } from '../workflows/deleteConfirmation'
import { useCopyActions } from './copyActions'
import { useGenerationActions } from './generationActions'
import { useRecordActions } from './recordActions'
import type { CreatedRecordEditTarget, WorkflowNavigation } from './types'
import { useAppStartup } from './useAppStartup'
import { usePendingChangeProtection } from './usePendingChangeProtection'
import { useSessionWorkspace } from './useSessionWorkspace'
import { useWorkflowFeedback } from './useWorkflowFeedback'
import { useDeletionWorkspace } from './useDeletionWorkspace'
import { useOutputLibraries } from './useOutputLibraries'
import { parseNavigationRoute } from './navigationRoute'
import { createOpenGenerationPreflight } from './generationPreflightAction'
import {
  deriveSessionSaveState,
  useAppControllerGenerationState,
  useAppControllerPresentationState,
} from './useAppController.derivedState'
import { useSessionAutosave } from './useAppController.autosave'
import { useAppControllerChat } from './useAppController.chat'
import { createNoteEditors, useCoordinatedGenerationWorkspace } from './useAppController.noteEditing'
import { useAppControllerPersistence } from './useAppController.persistence'
import { useAppControllerRecords } from './useAppController.records'
import { useNavigationRouteSync } from './useAppController.routeSync'
import { useAppControllerSettings } from './useAppController.settings'
import { useSettingsSectionFocus } from './useAppController.settingsFocus'
import { useAppSettlement } from './appSettlement'
import { useAppControllerNavigation } from './useAppController.navigation'
import { useAttachmentCleanup } from './useAttachmentCleanup'
import { useSummaryRecovery } from './useSummaryRecovery'
import { captureAvailableRecordContext } from './conversationPresentation'
import { useSessionChat } from './useSessionChat'
import { prefilledFindingFromTestCase } from '../workflows/prefillTemplates'
import type { TestRunCase } from '../tauri'
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
    setSessions,
    setSessionLibraryComplete,
    workspace: sessionWorkspace,
  } = useSessionWorkspace()
  const { busyAction, notice, error, setBusyAction, setNotice, setError, feedback } = useWorkflowFeedback()
  const {
    generationJobs,
    pendingGenerationAction,
    latestNoteGenerationUndo,
    latestNoteGenerationUndoRef,
    setPendingGenerationAction,
    setLatestNoteGenerationUndo,
    coordinatedGenerationWorkspace,
  } = useCoordinatedGenerationWorkspace()
  const { deleteConfirmation, setDeleteConfirmation, workspace: deletion } = useDeletionWorkspace()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<MainView>('sessions')
  const [pendingNavigationView, setPendingNavigationView] = useState<MainView | null>(null)
  const pendingNavigationContinuationRef = useRef<(() => void | Promise<void>) | null>(null)
  const pendingNavigationEpochRef = useRef(0)
  const [settingsSection, setSettingsSection] = useState<string | null>(null)
  const [focusedRecordId, setFocusedRecordId] = useState<string | null>(null)
  const [createdRecordEditTarget, setCreatedRecordEditTarget] = useState<CreatedRecordEditTarget | null>(null)
  const [initialNavigationRoute] = useState(() => parseNavigationRoute(window.location.hash))
  const settingsReturnViewRef = useRef<MainView>('sessions')
  const outputLibraries = useOutputLibraries(activeView)
  const summaryRecovery = useSummaryRecovery()
  const {
    activeProvider,
    captureSettingsCheckpoint,
    modelWritePending,
    discoverProviderDefaults,
    discardSettingsDraft,
    effectiveAiSelection,
    loadProviderStatus,
    loadSettings,
    refreshProviderStatus,
    settingsDirty,
    handleSaveSettings: saveSettingsDraft,
    selection,
    settingsView,
  } = useAppControllerSettings({ setError, setNotice })
  const records = useAppControllerRecords({ activeSessionId: activeSession?.id ?? null, activeView })
  const {
    drafts,
    findings,
    draftSourceIds, findingSourceIds,
    draftLoadState,
    findingLoadState,
    dirtyDraftIdsRef,
    dirtyFindingIdsRef,
    invalidateDraftLoads,
    invalidateFindingLoads,
    loadDraftsForSession,
    loadFindingsForSession, adoptPersistedDraftSource, adoptPersistedFindingSource,
    recordWorkspace,
    recordsView,
  } = records
  const presentationState = useAppControllerPresentationState({
    drafts, findings, noteBody, noteBodyHtml, searchQuery, sessionTitle, sessions,
  })
  const openGenerationPreflight = createOpenGenerationPreflight(
    activeProvider, refreshProviderStatus, setBusyAction, setPendingGenerationAction,
  )
  const {
    noteIsReady, sessionTitleValidationError, pendingRecoveredSummaryDecision, sessionHasPendingChanges, sessionSaveState,
  } = deriveSessionSaveState({
    activeSession, noteEntry, sessionTitle, noteBody, latestNoteGenerationUndo, busyAction,
    /* oxlint-disable react-hooks/refs -- these write-through refs are the authoritative retry baselines; every mutation is paired with state that schedules a render. */
    savedTitle: savedTitleRef.current,
    savedBody: savedBodyRef.current,
    /* oxlint-enable react-hooks/refs */
  })
  const isBusy = busyAction !== null
  // A Session open is superseded by the next Session choice, so it never blocks choosing another one.
  const canSwitchSession = busyAction === null || busyAction === 'open-session'
  const attachmentCleanup = useAttachmentCleanup(isBusy)
  const deleteCopy = deleteConfirmation ? deleteConfirmationCopy(deleteConfirmation) : null
  const generationState = useAppControllerGenerationState({
    activeSession, generationJobs,
  })
  const navigation: WorkflowNavigation = {
    setActiveView: (view) => { setCreatedRecordEditTarget(null); setActiveView(view) },
  }
  const { importedAttachments, attachmentActions, recordPersistence, noteRecovery, noteEligibility, sessionActions } = useAppControllerPersistence({
    session: sessionWorkspace, records, generation: coordinatedGenerationWorkspace, latestNoteGenerationUndoRef, summaryRecovery,
    feedback, navigation, deletion, attachmentCleanup,
  })
  const { sessionChat: baseSessionChat, sessionMode, setSessionMode, noteReadOnly, ...chatProtection } = useSessionChat({
    session: sessionWorkspace, noteRecovery, noteEligibility, sessionActions, generation: coordinatedGenerationWorkspace,
    selection, provider: activeProvider, providerWarning: effectiveAiSelection?.warning ?? null,
    feedback, jobs: generationJobs, refreshProviderStatus, captureContext: (sessionId, owner) => {
      if (sessionId !== sessionWorkspace.activeSessionIdRef.current) throw new Error('The active Session changed before sending.')
      return owner?.kind === 'record' ? captureAvailableRecordContext(sessionId, owner.record, recordWorkspace, owner.record.kind === 'finding' ? { state: findingLoadState, ids: findingSourceIds } : { state: draftLoadState, ids: draftSourceIds }) : activeView === 'sessions' ? { kind: 'session' } : askAi.captureNotesContext(sessionId)
    }, recordWritesPending: recordPersistence.coordination.hasPendingRecordCompensations,
  })
  const { setEditedSessionTitle, setEditedNoteBody } = createNoteEditors({
    session: sessionWorkspace, sessionActions, latestNoteGenerationUndoRef, setLatestNoteGenerationUndo,
  })
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
  const { askAi, recordChat, refinement, sessionChat } = useAppControllerChat({
    activeSession, activeView, records, conversations: chatProtection.conversations, baseSessionChat, setSessionMode, initialNavigationRoute,
    revealOwner: (owner, reveal, recoverInput, preserveEditor) => requestRevealConversationOwner(owner, reveal, recoverInput, preserveEditor),
    session: sessionWorkspace, sessionActions, recordActions, recordPersistence, openEditor: setCreatedRecordEditTarget, feedback,
    setError, pendingRecoveredSummaryDecision, sessionHasPendingChanges,
  })
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
    canonicalizeGeneratedDraft: (draft, storedBase) => { adoptPersistedDraftSource(storedBase); return recordActions.canonicalizeGeneratedDraft(draft, storedBase) },
    canonicalizeGeneratedFinding: (finding, storedBase) => { adoptPersistedFindingSource(storedBase); return recordActions.canonicalizeGeneratedFinding(finding, storedBase) },
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
  const setPendingSettingsSection = useSettingsSectionFocus(activeView, activeProvider, discoverProviderDefaults)
  const {
    applyNavigationRoute, cancelPendingNavigation, closeSettings, discardPendingNavigationChanges,
    openLibraryRecord, openSessionInCurrentView, openSettingsSection,
    requestActiveView, requestNewSession, requestOpenSession,
    savePendingNavigationChanges,
    beginSessionNavigation, consumeCreatedRecordEditTarget, requestCreation, requestRevealConversationOwner,
  } = useAppControllerNavigation({
    creation, chat: chatProtection, onNavigationIntent: askAi.invalidateNavigation,
    activeSession, activeSessionIdRef: sessionWorkspace.activeSessionIdRef, activeView, settlement, dirtyDraftIdsRef, dirtyFindingIdsRef,
    discardSettingsDraft, focusedRecordId, pendingNavigationContinuationRef, pendingNavigationEpochRef,
    pendingNavigationView, recordActions,
    sessionActions, sessions, settingsDirty, settingsReturnViewRef, settingsSection,
    setActiveView, setError, setFocusedRecordId, setCreatedRecordEditTarget, setPendingNavigationView, setPendingSettingsSection, setSettingsSection,
  })
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
  useNavigationRouteSync({
    initialNavigationRoute, bootedRef, busyAction, activeSession, applyNavigationRoute,
    activeView, focusedRecordId, settingsSection, conversation: askAi.reference,
  })
  useSessionAutosave({ session: sessionWorkspace, sessionActions, bootedRef, pendingRecoveredSummaryDecision })
  return {
    conversations: chatProtection.conversations, sessionChat, recordChat, selectedConversation: chatProtection.selectedSnapshot, proposalControls: refinement.proposalControls, sessionMode, setSessionMode, saveAllPendingChanges: settlement.flush, noteReadOnly,
    creation, creationIntent, creationDecision,
    createdRecordEditTarget, consumeCreatedRecordEditTarget: consumeSelectedRecord,
    attachmentCleanup, ...attachmentActions,
    ...copyActions,
    ...generationActions,
    handleCancelGenerationJob: (jobId: string) => creation.ownsGeneration(jobId) ? creation.cancelGeneration() : generationActions.handleCancelGenerationJob(jobId),
    ...recordActions,
    handleManualFinding: () => requestCreation('findings', (epoch) => creation.open('finding', () => sessionActions.sessionNavigationIsCurrent(epoch))),
    handleManualTestware: () => requestCreation('testware', (epoch) => creation.open('testware', () => sessionActions.sessionNavigationIsCurrent(epoch))),
    handleFindingFromTestCase: (testCase: TestRunCase) => requestCreation('findings', (epoch) => creation.open('finding', () => sessionActions.sessionNavigationIsCurrent(epoch), false,
      { title: testCase.title, document: prefilledFindingFromTestCase(testCase), testCaseId: testCase.id })),
    openSessionFinding: (findingId: string) => applyNavigationRoute({ kind: 'session', sessionId: activeSession?.id ?? null, view: 'findings', recordId: findingId }),
    ...sessionActions,
    ...outputLibraries,
    // These parts follow every action spread, so their keys win exactly as the former inline keys did.
    ...presentationState,
    ...generationState,
    ...settingsView,
    ...recordsView,
    activeSession, activeView, askAi,
    busyAction, deleteConfirmation,
    deleteCopy,
    error,
    focusedRecordId,
    isBusy, canSwitchSession,
    latestNoteGenerationUndo,
    noteBody, noteBodyHtml,
    noteEntry,
    noteIsReady,
    sessionTitle,
    sessionTitleValidationError,
    sessionSaveState,
    closeSettings,
    openSettingsSection,
    openSessionInCurrentView,
    openSession: requestOpenSession,
    handleNewSession: requestNewSession,
    openLibraryRecord,
    openGenerationPreflight: (action: Parameters<typeof openGenerationPreflight>[0]) => action === 'summary' ? openGenerationPreflight(action)
      : requestCreation(action === 'finding' ? 'findings' : 'testware', (epoch) => creation.open(action, () => sessionActions.sessionNavigationIsCurrent(epoch), true)),
    notice,
    pendingGenerationAction,
    pendingNavigationView,
    pendingRecoveredSummaryDecision,
    searchQuery,
    sessionLibraryComplete, sessions,
    setActiveView: requestActiveView,
    setDeleteConfirmation,
    setError,
    setLatestNoteGenerationUndo,
    setNoteBody: setEditedNoteBody,
    setSessionTitle: setEditedSessionTitle,
    setPendingGenerationAction,
    setSearchQuery,
    savePendingNavigationChanges,
    discardPendingNavigationChanges,
    cancelPendingNavigation,
    uploadEditorImage: attachmentActions.uploadEditorImage,
    handleLoadSessionLibrary,
    handleRefreshProviderStatus,
    handleSaveSettings,
  }
}
export type AppController = ReturnType<typeof useAppController>
