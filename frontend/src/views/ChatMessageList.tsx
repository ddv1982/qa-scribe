import type { ChatState } from '../bindings'
import { MarkdownContent } from '../content/MarkdownContent'
import { RunModelEvidence } from '../components/RunModelEvidence'

export function ChatMessageList({ messages, aiRuns }: {
  messages: Readonly<ChatState['messages']>
  aiRuns: Readonly<ChatState['aiRuns']>
}) {
  return (
    <ol className="chat-messages">
      {messages.map((message) => (
        <li key={message.id} className={`chat-message chat-message-${message.role}`}>
          <header>
            <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
            {message.status !== 'completed' ? <span className="chat-turn-status">{message.status[0].toUpperCase() + message.status.slice(1)}</span> : null}
          </header>
          {message.text ? message.role === 'assistant'
            ? <MarkdownContent text={message.text} />
            : <p className="chat-message-text">{message.text}</p> : null}
          {message.aiRunId && (message.role === 'assistant' || message.status !== 'completed')
            ? <RunModelEvidence run={aiRuns.find((run) => run.id === message.aiRunId)} /> : null}
          {message.errorMessage ? <p className="chat-error">{message.errorMessage}</p> : null}
        </li>
      ))}
    </ol>
  )
}
