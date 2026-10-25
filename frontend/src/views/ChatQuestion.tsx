import { useId } from 'react'
import type { ChatMessage } from '../bindings'
import type { ChatContextPresentation } from '../app/sessionChat.context'
import { questionReason, questionSource } from '../app/sessionChat.questions'
import { ActionButton } from '../components/ActionButton'
import { ChatContextLabel } from './ChatContextCard'

export type QuestionControls = {
  target: ChatContextPresentation
  blockedReason: string
  onAnswer?: (assistantMessageId: string, text: string) => Promise<void>
  onPrepareAction?: (assistantMessageId: string) => Promise<void>
}
export function ChatQuestion({ message, messages, controls }: { message: ChatMessage; messages: readonly ChatMessage[]; controls?: QuestionControls }) {
  const id = useId()
  const response = message.response
  if (!response || response.warning) return null
  const source = questionSource(messages, message)
  const question = response.question
  const reason = controls ? questionReason(messages, message, controls.target) || controls.blockedReason : 'Saved question. Read-only.'
  if (!question) return response.purpose.kind === 'jira_drafting' ? <section className="chat-jira-review" aria-label="Jira draft review">
    <p>Agent-reported Jira draft. Review the content and choices above before requesting an action.</p>
    {source?.context ? <ChatContextLabel context={source.context} /> : null}
    {controls?.onPrepareAction ? <>
      <ActionButton variant="secondary" type="button" disabled={Boolean(reason)} aria-describedby={`${id}-reason`}
        onClick={() => { if (!reason) void controls.onPrepareAction?.(message.id) }}>Prepare action message</ActionButton>
      <p className="chat-help" id={`${id}-reason`}>{reason || 'Fills an editable message. Review it and use Send to request the action with your existing tool permissions.'}</p>
    </> : null}
  </section> : null
  return <section className="chat-question" aria-label="Assistant question">
    {source?.context ? <ChatContextLabel context={source.context} /> : null}
    <p className="chat-question-prompt">{question.prompt}</p>
    <p className="chat-help">Agent-suggested replies. You can also type your own answer.</p>
    <div className="chat-question-choices">
      {question.choices.map(choice => <div className="chat-question-choice" key={choice}>
        <ActionButton variant="secondary" type="button" disabled={Boolean(reason) || !controls?.onAnswer} aria-describedby={`${id}-reason`}
          onClick={() => { if (!reason) void controls?.onAnswer?.(message.id, choice) }}>{choice}</ActionButton>
        {choice === 'Finding subtask' && source?.context?.kind === 'finding' ? <span className="chat-choice-recommendation">Recommended</span> : null}
      </div>)}
    </div>
    <p className="chat-help" id={`${id}-reason`}>{reason || 'A choice sends exactly its displayed text as a chat reply.'}</p>
  </section>
}
