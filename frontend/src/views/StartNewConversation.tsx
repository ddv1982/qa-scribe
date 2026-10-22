import type { SessionChatViewState } from '../app/sessionChat.types'
import { chatIsBusy } from '../app/sessionChat.presentation'

export type ChatRestartState = Pick<SessionChatViewState,
  'chat' | 'composer' | 'job' | 'loading' | 'saving' | 'working' | 'recoveryPending'
  | 'permissionWorking' | 'permissionRecoveryPending' | 'onRestart'>

export function StartNewConversation({ state }: { state: ChatRestartState }) {
  const disabled = !state.chat || chatIsBusy(state) || Boolean(state.recoveryPending
    || state.permissionWorking || state.permissionRecoveryPending)
  function restart() {
    if (disabled || !state.chat) return
    if ((state.composer !== '' || state.chat.messages.length > 0) && !window.confirm(
      state.chat.submission
        ? 'Start a new conversation? Submitted history remains saved. Any unsent message will be discarded.'
        : 'Start a new conversation? This replaces the current conversation and discards any unsent message. Submit completed messages to the Session Note first if you want to keep them.',
    )) return
    void state.onRestart()
  }
  return <button className="secondary-button compact-button" type="button" disabled={disabled} onClick={restart}>
    Start new conversation
  </button>
}
