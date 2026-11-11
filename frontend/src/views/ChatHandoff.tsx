import { ActionButton } from '../components/ActionButton'
import { useId } from 'react'
import type { SessionChatViewState } from '../app/sessionChat.types'
import { StartNewConversation, type ChatRestartState } from './StartNewConversation'

type HandoffState = ChatRestartState & Pick<SessionChatViewState, 'handoff'>

export function ChatAddedToNote({ state }: { state: HandoffState }) {
  if (state.handoff.kind !== 'added') return null
  return <div className="chat-added" aria-label="Conversation added">
    <p className="chat-help">Conversation added to note</p>
    <StartNewConversation state={state} />
  </div>
}

export function ChatHandoff({ state, onSubmit, onOpenNote }: {
  state: HandoffState
  onSubmit: () => Promise<void>
  onOpenNote: () => void
}) {
  const id = useId()
  const { handoff } = state
  const reason = handoff.kind === 'added' ? '' : handoff.reason
  const canAdd = handoff.kind === 'conversation' && !handoff.disabled && !reason
  const unsent = state.composer !== '' || Boolean((state.composerImages ?? state.chat?.composerImages ?? []).length)
  return <footer className="chat-handoff">
    {handoff.kind === 'added' ? <p className="chat-help">Conversation added to note</p> : null}
    {reason ? <p className="chat-help" id={`${id}-reason`}>{reason}</p> : null}
    {handoff.kind !== 'added' ? <p className="sr-only" id={`${id}-about`}>Appends the saved conversation to the end of your note. Your existing note stays intact.{unsent ? ' Your unsent message is excluded.' : ''}</p> : null}
    <div className="chat-buttons">
      {handoff.kind === 'added' ? <>
        <ActionButton variant="secondary" type="button" onClick={onOpenNote}>Open updated Note</ActionButton>
        <StartNewConversation state={state} />
      </> : <ActionButton variant="secondary" type="button"
          disabled={handoff.kind === 'recover' ? handoff.disabled : !canAdd}
          aria-describedby={[reason ? `${id}-reason` : '', `${id}-about`].filter(Boolean).join(' ')}
          onClick={() => { if (canAdd || (handoff.kind === 'recover' && !handoff.disabled)) void onSubmit() }}>
          {handoff.kind === 'recover' ? 'Recover Session Note' : 'Add conversation to note'}
        </ActionButton>}
    </div>
  </footer>
}
