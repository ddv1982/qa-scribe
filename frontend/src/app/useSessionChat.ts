import { useEffect, useState } from 'react'
import type { GenerationJobStatus } from '../tauri'
import { useStableCapability } from './useStableCapability'
import { createSessionChatActions } from './sessionChat.actions'
import { deriveChatHandoff } from './sessionChat.presentation'
import { emptyChatSnapshot, type SessionChatContext, type SessionChatViewState } from './sessionChat.types'

export type { SessionChatViewState } from './sessionChat.types'

export function useSessionChat(context: Omit<SessionChatContext, 'publish'> & {
  jobs: Record<string, GenerationJobStatus>
}) {
  const [snapshot, publish] = useState(emptyChatSnapshot)
  const actions = useStableCapability({ ...context, publish }, createSessionChatActions)
  const sessionId = context.session.activeSession?.id ?? null
  const bindRetirement = context.noteRecovery.bindRetirement
  useEffect(() => bindRetirement(actions.retire), [actions, bindRetirement])
  useEffect(() => { actions.activate(sessionId) }, [actions, sessionId])
  useEffect(() => {
    for (const job of Object.values(context.jobs)) if (job.action === 'chat') actions.observeJob(job)
  }, [actions, context.jobs])
  useEffect(() => () => actions.dispose(), [actions])
  const current = snapshot.sessionId === sessionId ? snapshot : { ...emptyChatSnapshot, loading: Boolean(sessionId) }
  const noteReadOnly = Boolean(sessionId && context.noteRecovery.pendingSessionIds.includes(sessionId))
  const permissionJobId = current.job?.jobId ?? null
  const permissionProvider = context.selection.selectedProvider
  const sessionChat: SessionChatViewState = {
    handoff: deriveChatHandoff({ ...current, sessionId, noteEntry: context.session.noteEntry, recoveryPending: noteReadOnly }),
    chat: current.chat, composer: current.composer, job: current.job,
    loading: current.loading, saving: current.saving, working: current.working, error: current.error,
    dirty: current.dirty, recoveryPending: noteReadOnly,
    permissionWorking: current.permissionWorking,
    permissionRecoveryPending: current.permissionRecoveryPending,
    onDecidePermission: (requestId, decision) => actions.isCurrentPermissionScope(sessionId, permissionJobId, permissionProvider)
      ? actions.onDecidePermission(requestId, decision) : Promise.resolve(),
    onRecheck: () => actions.isCurrentPermissionScope(sessionId, permissionJobId, permissionProvider)
      ? actions.onRecheck() : Promise.resolve(),
    onSetComposer: actions.onSetComposer, onSend: actions.onSend, onRetry: actions.onRetry,
    onCancel: actions.onCancel, onSubmit: actions.onSubmit, onRestart: actions.onRestart, captureRestart: actions.captureRestart,
  }
  return { sessionChat, sessionMode: current.mode, setSessionMode: actions.setMode, noteReadOnly,
    flush: actions.flush, hasPendingChanges: actions.hasPendingChanges, recoverSession: actions.recoverSession }
}
