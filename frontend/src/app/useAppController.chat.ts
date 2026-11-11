import type { Dispatch, SetStateAction } from 'react'
import type { Session } from '../tauri'
import type { MainView } from '../ui/types'
import type { AppNavigationRoute } from './navigationRoute'
import type { useRecordActions } from './recordActions'
import type { useRecordPersistence } from './recordPersistence'
import type { useSessionActions } from './sessionActions'
import { handoffDuringRecordWrites, recoveredSummaryChoiceReason, savedNoteTurns } from './sessionChat.presentation'
import { useRefinementController } from './sessionChat.proposals'
import type { SessionChatViewState } from './sessionChat.types'
import type { CreatedRecordEditTarget, SessionWorkspace, WorkflowFeedback } from './types'
import type { useAppControllerRecords } from './useAppController.records'
import { useAskAiContext } from './useAskAiContext'
import { useConversationSnapshot } from './useConversationSnapshot'
import type { useSessionChat } from './useSessionChat'

type SessionChatHook = ReturnType<typeof useSessionChat>

type AppControllerChatContext = {
  activeSession: Session | null
  activeView: MainView
  records: ReturnType<typeof useAppControllerRecords>
  conversations: SessionChatHook['conversations']
  baseSessionChat: SessionChatHook['sessionChat']
  setSessionMode: SessionChatHook['setSessionMode']
  initialNavigationRoute: AppNavigationRoute | null
  // Called at reveal time: navigation is created after this hook and reads its output.
  revealOwner: Parameters<typeof useAskAiContext>[3]['revealOwner']
  session: SessionWorkspace
  sessionActions: ReturnType<typeof useSessionActions>
  recordActions: ReturnType<typeof useRecordActions>
  recordPersistence: ReturnType<typeof useRecordPersistence>
  openEditor: Dispatch<SetStateAction<CreatedRecordEditTarget | null>>
  feedback: WorkflowFeedback
  setError: Dispatch<SetStateAction<string | null>>
  pendingRecoveredSummaryDecision: boolean
  sessionHasPendingChanges: boolean
}

export function useAppControllerChat({
  activeSession,
  activeView,
  records,
  conversations,
  baseSessionChat,
  setSessionMode,
  initialNavigationRoute,
  revealOwner,
  session,
  sessionActions,
  recordActions,
  recordPersistence,
  openEditor,
  feedback,
  setError,
  pendingRecoveredSummaryDecision,
  sessionHasPendingChanges,
}: AppControllerChatContext) {
  const { recordWorkspace, findingLoadState, draftLoadState, findingLoadError, draftLoadError, findingSourceIds, draftSourceIds, loadFindingsForSession, loadDraftsForSession } = records
  const askAi = useAskAiContext(activeSession?.id ?? null, activeView, recordWorkspace, {
    conversations, findingLoadState, draftLoadState, findingLoadError, draftLoadError, findingSourceIds, draftSourceIds,
    retrySource: record => { if (activeSession) void (record.kind === 'finding' ? loadFindingsForSession(activeSession.id, { force: true }) : loadDraftsForSession(activeSession.id, { force: true })).catch(() => undefined) },
    revealOwner,
    openNotes: () => setSessionMode('chat'),
    restoredReference: initialNavigationRoute?.kind === 'session' ? initialNavigationRoute.conversation ?? null : null,
  })
  const recordChat = useConversationSnapshot(conversations, askAi.reference)
  const proposalChat = askAi.visible && recordChat.chat ? recordChat : baseSessionChat
  const refinement = useRefinementController({ conversations, chat: proposalChat, askAi, records: recordWorkspace, actions: recordActions, persistence: recordPersistence, session, openEditor, feedback })
  const sessionChat: SessionChatViewState = { ...baseSessionChat, ...refinement, ...savedNoteTurns(baseSessionChat, async () => pendingRecoveredSummaryDecision ? (setError(recoveredSummaryChoiceReason), false) : !sessionHasPendingChanges || sessionActions.savePendingSessionEdits(), reason => setError(current => current ?? reason)), handoff: handoffDuringRecordWrites(baseSessionChat.handoff, refinement.recordWritesPending) }
  return { askAi, recordChat, refinement, sessionChat }
}
