import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { SessionChatViewState } from '../app/sessionChat.types'
import { chatIsBusy } from '../app/sessionChat.presentation'
import { ActionButton } from '../components/ActionButton'
import { useModalDialog } from '../hooks/useModalDialog'

export type ChatRestartState = Pick<SessionChatViewState,
  'chat' | 'composer' | 'job' | 'loading' | 'saving' | 'working' | 'recoveryPending'
  | 'permissionWorking' | 'permissionRecoveryPending' | 'onRestart' | 'captureRestart'> & Partial<Pick<SessionChatViewState, 'composerImages' | 'imageFailures' | 'inputRecoveryPending'>>

function restartDisabled(state: ChatRestartState) {
  return !state.chat || chatIsBusy(state) || Boolean(state.recoveryPending
    || state.permissionWorking || state.permissionRecoveryPending || state.inputRecoveryPending)
}

export function StartNewConversation({ state }: { state: ChatRestartState }) {
  const [confirmation, setConfirmation] = useState<null | { submitted: boolean; confirm: () => Promise<void> }>(null)
  const latest = useRef(state)
  useLayoutEffect(() => { latest.current = state })
  function restart() {
    if (restartDisabled(state) || !state.chat) return
    const captured = state
    const confirm = state.captureRestart ? state.captureRestart() : async () => {
      const current = latest.current
      if (restartDisabled(current) || current.chat !== captured.chat
        || current.composerImages !== captured.composerImages
        || current.imageFailures !== captured.imageFailures
        || current.composer !== captured.composer || current.job !== captured.job) return
      await current.onRestart()
    }
    if (!confirm) return
    if (state.composer === '' && !(state.composerImages ?? state.chat.composerImages ?? []).length && !state.imageFailures?.length && state.chat.messages.length === 0) { void confirm(); return }
    setConfirmation({ submitted: Boolean(state.chat.submission), confirm })
  }
  return <>
    <ActionButton variant="secondary" size="compact" disabled={restartDisabled(state)} onClick={restart}>
      Start new conversation
    </ActionButton>
    {confirmation ? <RestartDialog submitted={confirmation.submitted}
      onCancel={() => setConfirmation(null)} onConfirm={() => {
        setConfirmation(null)
        void confirmation.confirm()
      }} /> : null}
  </>
}

function RestartDialog({ submitted, onCancel, onConfirm }: {
  submitted: boolean; onCancel: () => void; onConfirm: () => void
}) {
  const id = useId()
  const ref = useModalDialog(onCancel)
  return <dialog ref={ref} className="confirmation-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
    <div>
      <h2 id={`${id}-title`}>Start a new conversation?</h2>
      <p id={`${id}-description`}>{submitted
        ? 'Submitted history remains saved. Any unsent message will be discarded.'
        : 'This replaces the current conversation and discards any unsent message. Submit completed messages to the Session Note first if you want to keep them.'}</p>
    </div>
    <footer className="confirmation-actions">
      <ActionButton variant="secondary" onClick={onCancel}>Cancel</ActionButton>
      <ActionButton variant="primary" onClick={onConfirm}>Start new conversation</ActionButton>
    </footer>
  </dialog>
}
