import { ActionButton } from '../components/ActionButton'
import { useId, useState } from 'react'
import type { SessionChatViewState } from '../app/sessionChat.types'
import type { ChatState } from '../bindings'
import { ChatMessageList } from './ChatMessageList'
import { StartNewConversation, type ChatRestartState } from './StartNewConversation'

type HandoffState = ChatRestartState & Pick<SessionChatViewState, 'handoff'>

function SavedConversationReview({ chat, unsent }: { chat: ChatState; unsent: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return <section className="chat-review" aria-label="Saved conversation review">
    <ActionButton variant="secondary" size="compact" type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>
      Review saved conversation
    </ActionButton>
    <p className="chat-help">Read-only saved messages. {unsent ? 'Your unsent message is excluded from what is added to the note.' : 'This is the conversation that is appended to the note.'}</p>
    {expanded ? <div id={id} role="region" aria-label="Saved conversation">
      <ChatMessageList messages={chat.messages} aiRuns={chat.aiRuns} proposals={chat.proposals} />
    </div> : null}
  </section>
}

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
  const { handoff, chat } = state
  const reason = handoff.kind === 'added' ? '' : handoff.reason
  const canAdd = handoff.kind === 'conversation' && !handoff.disabled && !reason
  return <>
    {handoff.kind !== 'added' && handoff.reviewAvailable && chat ? <SavedConversationReview
      key={JSON.stringify([chat.sessionId, chat.draftId])} chat={chat}
      unsent={state.composer !== '' || Boolean((state.composerImages ?? chat.composerImages ?? []).length)} /> : null}
    <footer className="chat-handoff">
      <div>
        {handoff.kind !== 'added' ? <p className="chat-help">Your existing Note stays intact. The saved, role-labelled conversation is appended to your Session Note. This does not generate test cases.</p> : null}
        {reason ? <p className="chat-help" id={`${id}-reason`}>{reason}</p> : null}
        {handoff.kind === 'added' ? <p className="chat-help">Conversation added to note</p> : null}
      </div>
      <div className="chat-buttons">
        {handoff.kind === 'added' ? <>
          <ActionButton variant="secondary" size="compact" type="button" onClick={onOpenNote}>Open updated Note</ActionButton>
          <StartNewConversation state={state} />
        </> : <ActionButton variant="secondary" size="compact" type="button"
          disabled={handoff.kind === 'recover' ? handoff.disabled : !canAdd}
          aria-describedby={reason ? `${id}-reason` : undefined}
          onClick={() => { if (canAdd || (handoff.kind === 'recover' && !handoff.disabled)) void onSubmit() }}>
          {handoff.kind === 'recover' ? 'Recover Session Note' : 'Add conversation to note'}
        </ActionButton>}
      </div>
    </footer>
  </>
}
