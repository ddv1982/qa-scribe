import type { ChatImage, ChatState, Entry, GenerationJobStatus } from '../bindings'
import type { ChatImageFailure } from './sessionChat.types'

export type ChatActivity = {
  chat: ChatState | null
  job: GenerationJobStatus | null
  loading: boolean
  saving: boolean
  working: boolean
  recoveryPending?: boolean
  permissionWorking?: boolean
  permissionRecoveryPending?: boolean
  inputRecoveryPending?: boolean
}

export function chatIsBusy(state: ChatActivity): boolean {
  return state.loading || state.saving || state.working
    || Boolean(state.job && ['starting', 'running', 'cancelling'].includes(state.job.state))
    || Boolean(state.chat?.messages.some(message => message.status === 'running'))
}

export type ChatHandoffPresentation = {
  hydrationPending: boolean
  reviewAvailable: boolean
} & (
  | { kind: 'recover'; reason: string; disabled: boolean }
  | { kind: 'settling'; reason: string }
  | { kind: 'conversation'; reason: string; disabled: boolean }
  | { kind: 'added' }
)

export function deriveChatHandoff(state: ChatActivity & {
  sessionId: string | null
  noteEntry: Pick<Entry, 'id' | 'sessionId'> | null
  composer: string
  composerImages?: ChatImage[]
  imageFailures?: readonly ChatImageFailure[]
}): ChatHandoffPresentation {
  const { chat, job, sessionId, noteEntry, composer } = state
  const current = Boolean(sessionId && chat?.sessionId === sessionId && chat.owner.kind === 'notes')
  const ownJob = job?.chat?.reference.sessionId === sessionId && job.chat.reference.draftId === chat?.draftId ? job : null
  const busy = chatIsBusy({ ...state, job: ownJob })
  const hydrationPending = Boolean(current && ownJob?.sessionId === sessionId && ownJob.action === 'chat'
    && ownJob.state === 'completed' && (!ownJob.aiRunId || !chat?.messages.some(message =>
      message.role === 'assistant' && message.status === 'completed' && message.aiRunId === ownJob.aiRunId)))
  const unsettled = chatIsBusy({ ...state, job: ownJob, saving: false }) || Boolean(state.permissionWorking || state.permissionRecoveryPending || state.inputRecoveryPending) || hydrationPending
  const completed = Boolean(current && chat?.messages.length && chat.messages.every(message => message.status === 'completed'))
  const reviewAvailable = completed && !unsettled && !state.recoveryPending
  const facts = { hydrationPending, reviewAvailable }
  if (chat?.archived) return { ...facts, kind: 'settling', reason: 'Archived conversation is read-only.' }
  if (state.recoveryPending) return { ...facts, kind: 'recover', disabled: busy,
    reason: chat?.submission
      ? 'The conversation was saved, but the Session Note could not be refreshed. The stale Note is write-protected until recovery completes. Recovery reloads the saved Note without adding again.'
      : 'The submission outcome is uncertain. The Session Note is write-protected until recovery checks its saved state. Recovery does not add again.' }
  if (!current || unsettled) return { ...facts, kind: 'settling',
    reason: hydrationPending ? 'Waiting for the completed response to appear in saved conversation history.'
      : 'Wait until the conversation is ready to add.' }
  if (chat?.submission) {
    if (chat.submission.draftId === chat.draftId && noteEntry?.sessionId === sessionId
      && chat.submission.noteId === noteEntry.id) return { ...facts, kind: 'added' }
    return { ...facts, reviewAvailable: false, kind: 'settling', reason: 'Waiting for the updated Session Note.' }
  }
  return { ...facts, kind: 'conversation', disabled: busy, reason: !completed && chat?.messages.length
    ? 'Resolve unfinished turns before adding the conversation.'
    : chat?.proposals?.some(proposal => proposal.state.kind === 'staged') ? 'Save, Undo, or Discard the local refinement before adding the conversation.'
    : state.imageFailures?.length ? 'Retry or remove failed images before adding the conversation.'
    : (state.composerImages ?? chat?.composerImages ?? []).length ? 'Send or clear the unsent message and images before adding the conversation.'
    : composer !== '' ? 'Send or clear the unsent message before adding the conversation.'
    : !chat?.messages.length ? 'Complete a conversation before adding it to the note.' : '' }
}

export function handoffDuringRecordWrites(handoff: ChatHandoffPresentation, pending: boolean): ChatHandoffPresentation {
  return pending && handoff.kind !== 'recover' ? { ...handoff, kind: 'settling', reason: 'Wait for pending record writes before adding the conversation.' } : handoff
}
