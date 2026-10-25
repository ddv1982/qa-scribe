import { ChatQuestion, type QuestionControls } from './ChatQuestion'
import { ChatProposalReview } from './ChatProposalReview'
import type { ProposalControls } from '../app/sessionChat.proposals'
import type { ChatState } from '../bindings'
import { ChatContextLabel } from './ChatContextCard'
import { MarkdownContent } from '../content/MarkdownContent'
import { RunModelEvidence } from '../components/RunModelEvidence'
import { ChatImages } from './ChatImages'

export function ChatMessageList({ messages, aiRuns, proposals = [], proposalControls, questionControls, presentation = 'notes' }: {
  presentation?: 'notes' | 'record'
  messages: Readonly<ChatState['messages']>
  aiRuns: Readonly<ChatState['aiRuns']>
  proposals?: ChatState['proposals']
  proposalControls?: ProposalControls
  questionControls?: QuestionControls
}) {
  return (
    <ol className="chat-messages">
      {messages.map((message) => (
        <li key={message.id} className={`chat-message chat-message-${message.role}`}>
          <header>
            <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
            {message.status !== 'completed' ? <span className="chat-turn-status">{message.status[0].toUpperCase() + message.status.slice(1)}</span> : null}
          </header>
          {presentation === 'notes' && message.role === 'user' && message.context && message.context.kind !== 'session' ? <ChatContextLabel context={message.context} /> : null}
          {message.text ? message.role === 'assistant'
            ? <MarkdownContent text={message.text} />
            : <p className="chat-message-text">{message.text}</p> : null}
          {proposals.filter(proposal => proposal.assistantMessageId === message.id).map(proposal => <ChatProposalReview key={proposal.id} proposal={proposal} controls={proposalControls} presentation={presentation} />)}
          {message.response?.warning ? <p className="chat-help" role="status">{message.response.warning}</p> : null}
          {presentation === 'notes' ? <ChatQuestion message={message} messages={messages} controls={questionControls} /> : message.response?.question && !message.response.warning ? <div className="chat-follow-up">
            <p className="chat-message-text">{message.response.question.prompt}</p>
            <p className="chat-message-text">{message.response.question.choices.join(' · ')}</p>
          </div> : null}
          {presentation === 'notes' && message.answer ? <p className="chat-help">Reply to the question above</p> : null}
          <ChatImages images={message.images ?? []} />
          {presentation === 'notes' && message.aiRunId && (message.role === 'assistant' || message.status !== 'completed')
            ? <RunModelEvidence run={aiRuns.find((run) => run.id === message.aiRunId)} /> : null}
          {message.errorMessage ? <p className="chat-error">{message.errorMessage}</p> : null}
        </li>
      ))}
    </ol>
  )
}
