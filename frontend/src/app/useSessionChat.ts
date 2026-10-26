import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
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
  const activeSessionEpoch = useMemo(() => ({ sessionId }), [sessionId])
  const activeSessionEpochRef = useRef<typeof activeSessionEpoch | null>(null)
  useLayoutEffect(() => {
    activeSessionEpochRef.current = activeSessionEpoch
    return () => { activeSessionEpochRef.current = null }
  }, [activeSessionEpoch])
  const bindRetirement = context.noteRecovery.bindRetirement
  useEffect(() => bindRetirement(actions.retire), [actions, bindRetirement])
  useEffect(() => { void actions.activate(sessionId) }, [actions, sessionId])
  useEffect(() => {
    for (const job of Object.values(context.jobs)) if (job.action === 'chat') actions.observeJob(job)
  }, [actions, context.jobs])
  useEffect(() => () => actions.dispose(), [actions])
  const entry = useSyncExternalStore(actions.subscribeAttention, () => actions.notesSnapshot(sessionId))
  const current = entry.sessionId === sessionId ? entry : { ...emptyChatSnapshot, loading: Boolean(sessionId) }
  const notes = current.chat ? actions.bind({ sessionId: current.chat.sessionId, draftId: current.chat.draftId }) : null
  const noteReadOnly = Boolean(sessionId && context.noteRecovery.pendingSessionIds.includes(sessionId))
  const permissionJobId = current.job?.jobId ?? null
  const permissionProvider = current.job?.pendingPermission?.provider
    ?? current.chat?.aiRuns.find(run => run.id === current.job?.aiRunId)?.provider ?? null
  const sessionScopeIsCurrent = () => Boolean(sessionId && sessionId === context.session.activeSessionIdRef.current
    && activeSessionEpochRef.current === activeSessionEpoch)
  const permissionScopeIsCurrent = () => {
    const latest = actions.notesSnapshot(sessionId)
    const provider = latest?.job?.pendingPermission?.provider
      ?? latest?.chat?.aiRuns.find(run => run.id === latest.job?.aiRunId)?.provider ?? null
    return sessionScopeIsCurrent() && latest?.chat?.sessionId === sessionId && latest?.chat?.draftId === notes?.reference.draftId
      && (latest?.job?.jobId ?? null) === permissionJobId && provider === permissionProvider
  }
  const retryLoad = async () => {
    if (!sessionId || !sessionScopeIsCurrent()) return
    context.feedback.setError(error => error === current.error ? null : error)
    await actions.activate(sessionId)
  }
  const sessionChat: SessionChatViewState = {
    onAnswerQuestion: notes?.answer ?? (async () => {}), onPrepareAction: notes?.prepareAction ?? (async () => {}),
    onRefresh: async () => { if (sessionId && current.chat) await actions.refresh({ sessionId, draftId: current.chat.draftId }); else await retryLoad() },
    handoff: deriveChatHandoff({ ...current, sessionId, noteEntry: context.session.noteEntry, recoveryPending: noteReadOnly }),
    chat: current.chat, composer: current.composer, composerIntent: current.composerIntent, composerImages: current.composerImages, imageFailures: current.imageFailures, job: current.job,
    loading: current.loading, saving: current.saving, working: current.working, error: current.error,
    dirty: current.dirty, recoveryPending: noteReadOnly,
    inputRecoveryPending: current.inputRecoveryPending, responseStarting: current.responseStarting,
    permissionWorking: current.permissionWorking,
    permissionRecoveryPending: current.permissionRecoveryPending,
    onDecidePermission: (requestId, decision) => notes && permissionScopeIsCurrent()
      ? notes.decidePermission(requestId, decision) : Promise.resolve(),
    onRecheck: () => !current.chat && !current.loading ? retryLoad() : notes && permissionScopeIsCurrent()
      ? notes.recheck() : Promise.resolve(),
    onSetComposer: notes?.setComposer ?? (text => actions.setNotesInput(sessionId, { composer: text })), onAttachImages: notes?.attachImages ?? (async () => {}),
    onPasteNativeImage: notes?.pasteImage ?? (async () => {}), onRemoveImage: notes?.removeImage ?? (() => {}),
    onRetryImage: notes?.retryImage ?? (async () => {}), onDismissImageFailure: notes?.dismissImage ?? (async () => {}),
    onSend: notes?.send ?? (async () => {}), onRetry: notes?.retry ?? (async () => {}),
    onCancel: notes?.cancel ?? (async () => {}), onSubmit: notes?.submit ?? (async () => {}), onRestart: notes?.restart ?? (async () => {}), captureRestart: notes?.captureRestart ?? (() => null),
  }
  return { sessionChat, sessionMode: current.mode, setSessionMode: (mode: import('../bindings').ChatMode) => { actions.setNotesInput(sessionId, { mode }) }, noteReadOnly,
    selectedSnapshot: snapshot, conversations: actions, flush: actions.flush, hasPendingChanges: actions.hasPendingChanges, recoverSession: actions.recoverSession }
}
