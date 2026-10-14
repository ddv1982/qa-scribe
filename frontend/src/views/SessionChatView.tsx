import { useId } from 'react'
import type { ChatState, GenerationJobStatus } from '../bindings'

export type SessionChatViewProps = {
  chat: ChatState | null
  composer: string
  job: GenerationJobStatus | null
  loading: boolean
  saving: boolean
  dirty?: boolean
  recoveryPending?: boolean
  working: boolean
  error: string | null
  providerLabel: string
  modelLabel: string
  providerAvailable: boolean
  providerReason: string
  onSetComposer: (text: string) => void
  onSend: () => Promise<void>
  onRetry: () => Promise<void>
  onCancel: () => Promise<void>
  onSubmit: () => Promise<void>
  onRestart: () => Promise<void>
  onConfigureAi: () => void
}

const messageLimit = 16 * 1024
const transcriptLimit = 128 * 1024
const maxMessages = 128
const byteLength = (text: string) => new TextEncoder().encode(text).length

export function SessionChatView({
  chat, composer, job, loading, saving, working, error, dirty = false, recoveryPending = false,
  providerLabel, modelLabel, providerAvailable, providerReason,
  onSetComposer, onSend, onRetry, onCancel, onSubmit, onRestart, onConfigureAi,
}: SessionChatViewProps) {
  const id = useId()
  const messages = chat?.messages ?? []
  const latest = messages.at(-1)
  const submitted = Boolean(chat?.submission)
  const recovering = recoveryPending
  const activeJob = job?.state === 'starting' || job?.state === 'running' || job?.state === 'cancelling'
  const running = messages.some((message) => message.status === 'running')
  const busy = loading || saving || working || activeJob || running
  const locked = !chat || busy || submitted || recovering
  const unresolved = messages.filter((message) => message.status !== 'completed')
  const retryable = latest?.role === 'user'
    && ['failed', 'cancelled', 'interrupted'].includes(latest.status)
    && unresolved.length === 1
  const mixedHistory = unresolved.length > 0 && !retryable && !running && !activeJob
  const composerBytes = byteLength(composer)
  const transcriptBytes = messages.reduce((total, message) => total + byteLength(message.text), 0)
  const atLimit = messages.length + 2 > maxMessages || transcriptBytes + composerBytes > transcriptLimit
  const completedResponseSaved = job?.state === 'completed' && Boolean(job.aiRunId)
    && messages.some((message) => message.role === 'assistant' && message.status === 'completed' && message.aiRunId === job.aiRunId)
  const responseLabel = job?.state === 'completed' ? 'Final response pending save' : 'Partial response'
  const sendReason = !chat ? 'Conversation is not ready.'
    : loading ? 'Loading conversation…'
    : saving ? 'Saving conversation…'
    : busy ? 'Wait for the current operation to finish.'
    : recovering ? 'Recover the Session Note before starting a new conversation.'
    : submitted ? 'Start a new conversation to send another message.'
    : mixedHistory ? 'An earlier turn is unresolved. Start a new conversation to continue.'
    : retryable ? 'Retry the previous response before sending another message.'
    : !providerAvailable ? providerReason || 'Configure an available AI provider to send.'
    : composerBytes > messageLimit ? 'Message exceeds the 16 KiB limit. Shorten it before sending.'
    : atLimit ? 'Conversation limit reached. Submit completed messages or start a new conversation.'
    : !composer.trim() ? 'Write a message to send.' : ''
  const retryReason = locked ? 'Wait until the conversation is ready.'
    : !providerAvailable ? providerReason || 'Configure an available AI provider to retry.'
    : composer !== '' ? 'Clear the unsent message before retrying. Your text is kept until you clear it.' : ''
  const submitReason = recovering ? (submitted
    ? 'The transcript was saved, but the Session Note could not be refreshed. The stale Note is write-protected until recovery completes. Recovery reloads the saved Note without submitting again.'
    : 'The submission outcome is uncertain. The Session Note is write-protected until recovery checks its saved state. Recovery does not submit again.')
    : submitted ? 'Submitted to Session Note. History is preserved; start a new conversation when ready.'
    : !chat || busy ? 'Wait until the conversation is ready to submit.'
    : unresolved.length > 0 ? 'Resolve unfinished turns before submitting.'
    : composer !== '' ? 'Send or clear the unsent message before submitting.'
    : messages.length === 0 ? 'Complete a conversation before submitting.' : ''
  const status = loading ? 'Loading conversation…' : saving ? 'Saving conversation…'
    : recovering ? 'Session Note recovery required'
    : dirty && error ? 'Save failed' : dirty ? 'Unsaved changes'
    : job?.state === 'cancelling' ? 'Cancelling response…'
    : activeJob ? job?.progressMessage || 'Waiting for a response…'
    : working || running ? 'Working…' : !chat ? 'Conversation unavailable' : 'Conversation saved'

  function restart() {
    if (!chat || busy || recoveryPending) return
    if ((composer !== '' || messages.length > 0) && !window.confirm(
      submitted
        ? 'Start a new conversation? Submitted history remains saved. Any unsent message will be discarded.'
        : 'Start a new conversation? This replaces the current conversation and discards any unsent message. Submit completed messages to the Session Note first if you want to keep them.',
    )) return
    void onRestart()
  }

  return (
    <section className="session-chat" aria-label="Session chat">
      <header className="chat-topline">
        <div>
          <h2>Conversation</h2>
          <p className="chat-help">Gather testing information, then submit it to your Session Note.</p>
        </div>
        <button className="secondary-button compact-button" type="button" disabled={!chat || busy || recoveryPending} aria-describedby={recovering ? `${id}-submit-reason` : undefined} onClick={restart}>
          New conversation
        </button>
      </header>

      <div className="chat-meta">
        <span>{providerLabel} · {modelLabel}</span>
        <span role="status" aria-live="polite">{status}</span>
        <button className="secondary-button compact-button" type="button" onClick={onConfigureAi} disabled={busy}>
          Configure AI
        </button>
      </div>
      {error || job?.errorMessage ? <p className="chat-error" role="alert">{error || job?.errorMessage}</p> : null}

      <section className="chat-transcript" aria-label="Conversation transcript" tabIndex={0}>
        {messages.length === 0 ? <p className="chat-help">{loading ? 'Loading saved messages…' : 'No messages yet. Describe what you are testing or ask a question.'}</p> : (
          <ol className="chat-messages">
            {messages.map((message) => (
              <li key={message.id} className={`chat-message chat-message-${message.role}`}>
                <header>
                  <strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
                  {message.status !== 'completed' ? <span className="chat-turn-status">{message.status[0].toUpperCase() + message.status.slice(1)}</span> : null}
                </header>
                {message.text ? <p className="chat-message-text">{message.text}</p> : null}
                {message.errorMessage ? <p className="chat-error">{message.errorMessage}</p> : null}
              </li>
            ))}
          </ol>
        )}
        {job?.partialText && !completedResponseSaved ? (
          <section className="chat-partial" aria-label={responseLabel}>
            <h3>{responseLabel}</h3>
            <p className="chat-help">{job.state === 'completed' ? 'Waiting for the saved transcript to refresh.' : 'Not a completed transcript message.'}</p>
            <p className="chat-message-text">{job.partialText}</p>
          </section>
        ) : null}
      </section>

      <p className="chat-counts">{messages.length} / 128 messages · {(transcriptBytes / 1024).toFixed(1)} / 128 KiB transcript</p>
      <div className="chat-composer">
        <label htmlFor={`${id}-message`}>Message</label>
        <textarea
          id={`${id}-message`} rows={3} value={composer} disabled={!chat || loading || submitted || recovering}
          aria-describedby={`${id}-shortcut ${id}-send-reason`}
          onChange={(event) => onSetComposer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (!sendReason && !event.repeat) void onSend()
            }
          }}
          placeholder="Describe your testing context or ask a question"
        />
        <div className="chat-compose-actions">
          <span id={`${id}-shortcut`} className="chat-help">Enter for a new line. Ctrl/Cmd + Enter to send.</span>
          <div className="chat-buttons">
            {activeJob ? <button className="secondary-button" type="button" disabled={job?.state === 'cancelling'} onClick={() => void onCancel()}>Cancel response</button> : null}
            {retryable && !submitted ? <button className="secondary-button" type="button" disabled={Boolean(retryReason)} aria-describedby={`${id}-retry-reason`} onClick={() => { if (!retryReason) void onRetry() }}>Retry response</button> : null}
            <button className="primary-button" type="button" disabled={Boolean(sendReason)} aria-describedby={`${id}-send-reason`} onClick={() => { if (!sendReason) void onSend() }}>Send</button>
          </div>
        </div>
        <p className="chat-help" id={`${id}-send-reason`}>{sendReason || 'Send this message to the selected AI provider.'}</p>
        {retryable && !submitted ? <p className="chat-help" id={`${id}-retry-reason`}>{retryReason || 'Retry sends the previous message again and may incur another AI usage charge.'}</p> : null}
      </div>

      <footer className="chat-handoff">
        <div>
          <p className="chat-help">Submission appends the role-labelled transcript to your editable Session Note. It does not generate Testware.</p>
          {submitReason ? <p className="chat-help" id={`${id}-submit-reason`}>{submitReason}</p> : null}
        </div>
        <button className="secondary-button" type="button" disabled={recovering ? busy : Boolean(submitReason)} aria-describedby={submitReason ? `${id}-submit-reason` : undefined} onClick={() => { if (recovering ? !busy : !submitReason) void onSubmit() }}>
          {recovering ? 'Recover Session Note' : 'Submit to Session Note'}
        </button>
      </footer>
    </section>
  )
}
