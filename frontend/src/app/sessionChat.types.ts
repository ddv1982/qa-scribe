import type { ChatRequestIntent, ChatTarget, ChatImage, ChatMode, ChatPermissionDecision, ChatState, GenerationJobStatus, ProviderDescriptor } from '../bindings'
import type { Dispatch, SetStateAction } from 'react'
import type { AiSelection, GenerationWorkspace, SessionWorkspace, WorkflowFeedback } from './types'
import type { useSessionActions } from './sessionActions'
import type { NoteEligibility } from './noteEligibility'
import type { ChatNoteRecovery } from './useChatNoteRecovery'
import type { ChatHandoffPresentation } from './sessionChat.presentation'

export type ChatImageRecovery = { kind: 'refresh_pending' | 'verification_pending'; images: ChatImage[] }
export type ChatImageFailure = { id: string; filename: string; message: string; recovery?: ChatImageRecovery }

export interface SessionChatViewState {
  responseStarting?: ChatRequestIntent
  recordWritesPending?: boolean
  onRefine?: () => Promise<void>
  onDraftJira?: () => Promise<void>
  onAnswerQuestion?: (assistantMessageId: string, text: string) => Promise<void>
  onPrepareAction?: (assistantMessageId: string) => Promise<void>
  onRefresh?: () => Promise<void>
  proposalControls?: import('./sessionChat.proposals').ProposalControls
  handoff: ChatHandoffPresentation
  chat: ChatState | null
  composer: string
  composerImages: ChatImage[]
  imageFailures: ChatImageFailure[]
  inputRecoveryPending: boolean
  job: GenerationJobStatus | null
  loading: boolean
  saving: boolean
  working: boolean
  error: string | null
  dirty: boolean
  recoveryPending?: boolean
  permissionWorking?: boolean
  permissionRecoveryPending?: boolean
  onDecidePermission?: (requestId: string, decision: ChatPermissionDecision) => Promise<void>
  onRecheck?: () => Promise<void>
  onSetComposer: (text: string) => void
  onAttachImages: (files: File[]) => Promise<void>
  onPasteNativeImage: () => Promise<void>
  onRemoveImage: (attachmentId: string) => void
  onRetryImage: (id: string) => Promise<void>
  onDismissImageFailure: (id: string) => Promise<void>
  onSend: () => Promise<void>
  onRetry: () => Promise<void>
  onCancel: () => Promise<void>
  onSubmit: () => Promise<void>
  captureRestart?: () => (() => Promise<void>) | null
  onRestart: () => Promise<void>
}

export type ChatSnapshot = Pick<SessionChatViewState, 'chat' | 'composer' | 'composerImages' | 'imageFailures' | 'inputRecoveryPending' | 'job' | 'loading' | 'saving' | 'working' | 'error' | 'dirty' | 'permissionWorking' | 'permissionRecoveryPending' | 'responseStarting'> & {
  sessionId: string | null
  mode: ChatMode
}

export const emptyChatSnapshot: ChatSnapshot = {
  sessionId: null, chat: null, composer: '', composerImages: [], imageFailures: [], inputRecoveryPending: false, job: null, loading: false,
  saving: false, working: false, permissionWorking: false, permissionRecoveryPending: false, error: null, dirty: false, mode: 'write_note',
}

export type SessionChatContext = {
  recordWritesPending?: () => boolean
  noteRecovery: ChatNoteRecovery
  noteEligibility: NoteEligibility
  session: SessionWorkspace
  sessionActions: ReturnType<typeof useSessionActions>
  generation: GenerationWorkspace
  selection: AiSelection
  provider: ProviderDescriptor | null
  providerWarning: string | null
  refreshProviderStatus?: () => Promise<void>
  captureContext?: (sessionId: string) => ChatTarget
  feedback: WorkflowFeedback
  publish: Dispatch<SetStateAction<ChatSnapshot>>
}

export type ChatWorkspace = {
  retired: boolean
  retirement: Promise<void>
  resolveRetirement: () => void
  recovery: Promise<boolean> | null
  sessionId: string
  chat: ChatState | null
  composer: string
  composerImages: ChatImage[]
  imageFailures: ChatImageFailure[]
  pendingStart: { state: 'starting' | 'uncertain'; intent: ChatRequestIntent } | null
  mode: ChatMode
  inputVersion: number
  modeVersion: number
  refreshEpoch: number
  loading: boolean
  error: string | null
  job: GenerationJobStatus | null
  hydration: Promise<void> | null
  save: Promise<boolean> | null
  operation: Promise<void> | null
  operationKind: string | null
  permissionOperation?: Promise<void> | null
  autosaveTimer: ReturnType<typeof setTimeout> | null
}

export function chatIsWorking(job: GenerationJobStatus | null): boolean {
  return Boolean(job && ['starting', 'running', 'cancelling'].includes(job.state))
}

export function chatIsDirty(workspace: ChatWorkspace): boolean {
  if (workspace.retired) return false
  if (workspace.chat?.submission) return false
  if (!workspace.chat) return workspace.inputVersion > 0 || workspace.modeVersion > 0
  return chatInputIsDirty(workspace) || workspace.mode !== workspace.chat.mode
}

export function chatInputIsDirty(workspace: ChatWorkspace): boolean {
  return workspace.composer !== workspace.chat?.composer
    || JSON.stringify(workspace.composerImages.map(image => image.attachmentId))
      !== JSON.stringify((workspace.chat?.composerImages ?? []).map(image => image.attachmentId))
}

export function chatScope(chat: ChatState) {
  return { sessionId: chat.sessionId, draftId: chat.draftId, expectedRevision: chat.revision }
}

export function unresolvedChatReason(chat: ChatState, retry: boolean): string | null {
  const unresolved = chat.messages.filter((message) => message.status !== 'completed')
  if (!unresolved.length) return retry ? 'There is no failed turn to retry.' : null
  const latestTurn = chat.messages.at(-1)?.turnId
  if (unresolved.some((message) => message.turnId !== latestTurn)) {
    return 'An earlier turn did not complete. Start a new conversation to continue.'
  }
  if (unresolved.some((message) => message.status === 'running')) return 'Wait for the active turn or cancel it.'
  return retry ? null : 'The latest turn did not complete. Retry that turn explicitly before sending a new message.'
}
