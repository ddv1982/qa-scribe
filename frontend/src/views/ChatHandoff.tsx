import { ActionButton } from '../components/ActionButton'
import { useId, useState } from 'react'
import type { SessionChatViewState } from '../app/sessionChat.types'
import { ChatMessageList } from './ChatMessageList'
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
  const { handoff, chat } = state
  const reason = handoff.kind === 'added' ? '' : handoff.reason
  const canAdd = handoff.kind === 'conversation' && !handoff.disabled && !reason
  const reviewable = handoff.kind !== 'added' && handoff.reviewAvailable && chat ? chat : null
  // Review stays open across saves of the same conversation and closes for another one.
  const reviewKey = reviewable ? JSON.stringify([reviewable.sessionId, reviewable.draftId]) : null
  const [openReview, setOpenReview] = useState<string | null>(null)
  if (openReview !== null && openReview !== reviewKey) setOpenReview(null)
  const expanded = reviewKey !== null && openReview === reviewKey
  const unsent = state.composer !== '' || Boolean((state.composerImages ?? chat?.composerImages ?? []).length)
  return <footer className="chat-handoff">
    <div>
      {handoff.kind !== 'added' ? <p className="chat-help">Your existing Note stays intact. The saved, role-labelled conversation is appended to it. This does not generate test cases.{reviewable && unsent ? ' Your unsent message is excluded.' : ''}</p> : null}
      {reason ? <p className="chat-help" id={`${id}-reason`}>{reason}</p> : null}
      {handoff.kind === 'added' ? <p className="chat-help">Conversation added to note</p> : null}
    </div>
    <div className="chat-buttons">
      {handoff.kind === 'added' ? <>
        <ActionButton variant="secondary" type="button" onClick={onOpenNote}>Open updated Note</ActionButton>
        <StartNewConversation state={state} />
      </> : <>
        {reviewable ? <section className="chat-review" aria-label="Saved conversation review">
          <ActionButton variant="secondary" type="button" aria-expanded={expanded} aria-controls={`${id}-review`} onClick={() => setOpenReview(expanded ? null : reviewKey)}>
            Review saved conversation
          </ActionButton>
        </section> : null}
        <ActionButton variant="secondary" type="button"
          disabled={handoff.kind === 'recover' ? handoff.disabled : !canAdd}
          aria-describedby={reason ? `${id}-reason` : undefined}
          onClick={() => { if (canAdd || (handoff.kind === 'recover' && !handoff.disabled)) void onSubmit() }}>
          {handoff.kind === 'recover' ? 'Recover Session Note' : 'Add conversation to note'}
        </ActionButton>
      </>}
    </div>
    {expanded && reviewable ? <div id={`${id}-review`} className="chat-review-transcript" role="region" aria-label="Saved conversation">
      <ChatMessageList messages={reviewable.messages} aiRuns={reviewable.aiRuns} proposals={reviewable.proposals} />
    </div> : null}
  </footer>
}
