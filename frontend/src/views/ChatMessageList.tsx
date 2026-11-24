import { ChatQuestion, type QuestionControls } from './ChatQuestion'
import { ChatProposalReview } from './ChatProposalReview'
import type { ProposalControls } from '../app/sessionChat.proposals'
import type { ChatRef, ChatState } from '../bindings'
import { ChatContextLabel } from './ChatContextCard'
import { MarkdownContent } from '../content/MarkdownContent'
import { RunModelEvidence } from '../components/RunModelEvidence'
import { ActionButton } from '../components/ActionButton'
import { ChatImages } from './ChatImages'
import { TestRunSuggestions } from './TestRunSuggestions'
import type { ShownTestRun } from '../app/conversationPresentation'

export function ChatMessageList({ messages, aiRuns, proposals = [], proposalControls, questionControls, onSuggestEdit, reference, testRunSuggestions, shownTestRun, presentation = 'notes', userContextLabel }: {
  reference?: ChatRef
  testRunSuggestions?: ChatState['testRunSuggestions']
  shownTestRun?: ShownTestRun | null
  presentation?: 'notes' | 'record'
  /** Names what every message of the tester was sent with, when the conversation has one fixed source. */
  userContextLabel?: string
  messages: Readonly<ChatState['messages']>
  aiRuns: Readonly<ChatState['aiRuns']>
  proposals?: ChatState['proposals']
  proposalControls?: ProposalControls
  questionControls?: QuestionControls
  onSuggestEdit?: (assistantMessageId: string) => Promise<void>
}) {
  return (
    <ol className="chat-messages">
      {messages.map((message) => (
        <li key={message.id} className={`chat-message chat-message-${message.role}`}>
          <header>
            <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
            {message.status !== 'completed' ? <span className="chat-turn-status">{message.status[0].toUpperCase() + message.status.slice(1)}</span> : null}
          </header>
          {message.role === 'user' && userContextLabel ? <p className="chat-context-label">{userContextLabel}</p> : null}
          {presentation === 'notes' && message.role === 'user' && message.context && message.context.kind !== 'session' ? <ChatContextLabel context={message.context} /> : null}
          {message.response?.warning ? <p className="chat-help" role="status">{message.response.warning}</p> : null}
          {message.text ? message.role === 'assistant'
            ? <MarkdownContent text={message.text} />
            : <p className="chat-message-text">{message.text}</p> : null}
          {onSuggestEdit && message === messages.at(-1) && message.response?.purpose.kind === 'refinement'
            && !message.response.question && !proposals.some(proposal => proposal.assistantMessageId === message.id)
            ? <ActionButton className="chat-suggestion-recovery" variant="secondary" type="button" onClick={() => void onSuggestEdit(message.id)}>Generate editable suggestion</ActionButton> : null}
          {proposals.filter(proposal => proposal.assistantMessageId === message.id).map(proposal => <ChatProposalReview key={proposal.id} proposal={proposal} reference={reference} controls={proposalControls} presentation={presentation}
            noteSourceNeedsRefresh={message.response?.noteSourceNeedsRefresh}
            onRegenerate={onSuggestEdit && message.response?.noteSourceNeedsRefresh ? () => onSuggestEdit(message.id) : undefined} />)}
          {reference && shownTestRun?.cases && testRunSuggestions && message.role === 'assistant' ?
            <TestRunSuggestions reference={reference} assistantMessageId={message.id} runId={shownTestRun.runId}
              cases={shownTestRun.cases} editsBlocked={shownTestRun.editsBlocked}
              rows={testRunSuggestions.filter(row => row.assistantMessageId === message.id)} /> : null}
          {presentation === 'notes' || message.response?.localEdit ? <ChatQuestion message={message} messages={messages} controls={questionControls} /> : message.response?.question && !message.response.warning ? <div className="chat-follow-up">
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
