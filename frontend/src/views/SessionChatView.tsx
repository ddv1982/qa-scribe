import { useId, useState } from 'react'
import '../styles/chat-permissions.css'
import type { AiProvider, ChatPermissionDecision, ChatState, GenerationJobStatus } from '../bindings'
import { MarkdownContent } from '../content/MarkdownContent'

export type SessionChatViewProps = {
  chat: ChatState | null
  composer: string
  job: GenerationJobStatus | null
  loading: boolean
  saving: boolean
  dirty?: boolean
  recoveryPending?: boolean
  working: boolean
  permissionWorking?: boolean
  permissionRecoveryPending?: boolean
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
  onDecidePermission?: (requestId: string, decision: ChatPermissionDecision) => Promise<void>
  onRecheck?: () => Promise<void>
}

const messageLimit = 16 * 1024
const transcriptLimit = 128 * 1024
const maxMessages = 128
const permissionPreviewLimit = 4096
const permissionProviderLabels: Record<AiProvider, string> = {
  claude_code: 'Claude Code',
  codex_cli: 'Codex',
  copilot_cli: 'GitHub Copilot',
}
const byteLength = (text: string) => new TextEncoder().encode(text).length

export function SessionChatView({
  chat, composer, job, loading, saving, working, error, dirty = false, recoveryPending = false,
  permissionWorking = false, permissionRecoveryPending = false,
  providerLabel, modelLabel, providerAvailable, providerReason,
  onSetComposer, onSend, onRetry, onCancel, onSubmit, onRestart, onConfigureAi,
  onDecidePermission, onRecheck,
}: SessionChatViewProps) {
  const id = useId()
  const [expandedPermissionKey, setExpandedPermissionKey] = useState<string | null>(null)
  const messages = chat?.messages ?? []
  const latest = messages.at(-1)
  const submitted = Boolean(chat?.submission)
  const recovering = recoveryPending
  const activeJob = job?.state === 'starting' || job?.state === 'running' || job?.state === 'cancelling'
  const running = messages.some((message) => message.status === 'running')
  const busy = loading || saving || working || activeJob || running
  const recheckDisabled = loading || saving || permissionWorking || recoveryPending
    || job?.state === 'cancelling' || (working && !activeJob)
  const pendingPermission = chat && job?.sessionId === chat.sessionId
    && job.action === 'chat' && job.state === 'running' ? job.pendingPermission : null
  const permissionDisabled = permissionWorking || !onDecidePermission
  const approvalUnavailable = pendingPermission?.canApprove === false
  const permissionKey = pendingPermission && job
    ? JSON.stringify([job.sessionId, job.jobId, pendingPermission.requestId]) : null
  const permissionExpanded = permissionKey !== null && expandedPermissionKey === permissionKey
  const permissionInput = pendingPermission?.inputJson
  const permissionPreview = permissionExpanded ? permissionInput : permissionInput?.slice(0, permissionPreviewLimit)
  const permissionTruncated = !permissionExpanded && Boolean(permissionInput && permissionInput.length > permissionPreviewLimit)
  const needsProviderRecovery = permissionRecoveryPending || !providerAvailable || Boolean(error || job?.errorMessage)
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
    : permissionRecoveryPending ? 'Permission status recovery required'
    : dirty && error ? 'Save failed' : dirty ? 'Unsaved changes'
    : job?.state === 'cancelling' ? 'Cancelling response…'
    : pendingPermission ? 'Waiting for tool permission'
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
      {needsProviderRecovery ? (
        <div className="chat-provider-recovery">
          <p className="chat-help">
            {permissionRecoveryPending
              ? 'The permission decision could not be confirmed. Recheck status to recover its current state without repeating the decision.'
              : 'Configure AI to review provider setup or sign-in. Rechecking status does not send a message or retry a response.'}
          </p>
          {onRecheck ? <button className="secondary-button compact-button" type="button" disabled={recheckDisabled} onClick={() => { if (!recheckDisabled) void onRecheck() }}>Recheck status</button> : null}
        </div>
      ) : null}

      {pendingPermission ? (
        <section className="chat-permission" aria-label="Tool permission" aria-describedby={`${id}-permission-scope`}>
          <h3>Tool permission</h3>
          <p className="chat-help">{permissionProviderLabels[pendingPermission.provider]} is waiting for your decision.</p>
          <div className="chat-permission-details">
            <p className="chat-help">{pendingPermission.toolName == null ? 'Provider description' : 'Request'}</p>
            <p className="chat-message-text">{pendingPermission.title}</p>
            {pendingPermission.serverName != null ? <>
              <p className="chat-help">Server</p>
              <p className="chat-message-text">{pendingPermission.serverName}</p>
            </> : null}
            {pendingPermission.toolName != null ? <>
              <p className="chat-help">Tool</p>
              <p className="chat-message-text">{pendingPermission.toolName}</p>
            </> : <p className="chat-help">The provider did not supply a named tool identity.</p>}
            {permissionInput != null ? <>
              <p className="chat-help">{permissionExpanded ? 'Complete arguments' : 'Arguments preview'}</p>
              <p id={`${id}-permission-input`} className="chat-message-text chat-permission-input" tabIndex={0} aria-label={permissionExpanded ? 'Complete arguments' : 'Arguments preview'}>{permissionPreview}</p>
              {permissionTruncated ? <>
                <p className="chat-help">Arguments preview truncated to the first {permissionPreviewLimit.toLocaleString('en-US')} characters.</p>
                <button className="secondary-button compact-button" type="button" aria-controls={`${id}-permission-input`} onClick={() => setExpandedPermissionKey(permissionKey)}>Show complete arguments</button>
              </> : null}
            </> : null}
          </div>
          <p className="chat-help" id={`${id}-permission-scope`}>Approve once applies to this tool call only. Approve all for this response approves this and remaining supported tool requests, including future tool requests in this response. Does not change saved permissions.</p>
          {approvalUnavailable ? <p className="chat-help" id={`${id}-permission-approval-reason`}>The provider does not offer one-time approval.</p> : null}
          <div className="chat-buttons">
            <button className="primary-button" type="button" disabled={permissionDisabled || approvalUnavailable} aria-describedby={approvalUnavailable ? `${id}-permission-approval-reason` : undefined} onClick={() => { if (!permissionDisabled && !approvalUnavailable) void onDecidePermission?.(pendingPermission.requestId, 'approve') }}>Approve once</button>
            <button className="secondary-button" type="button" disabled={permissionDisabled || approvalUnavailable} aria-describedby={approvalUnavailable ? `${id}-permission-approval-reason` : undefined} onClick={() => { if (!permissionDisabled && !approvalUnavailable) void onDecidePermission?.(pendingPermission.requestId, 'approveAll') }}>Approve all for this response</button>
            <button className="secondary-button" type="button" disabled={permissionDisabled} onClick={() => { if (!permissionDisabled) void onDecidePermission?.(pendingPermission.requestId, 'deny') }}>Deny</button>
          </div>
          {permissionWorking ? <p className="chat-help">Sending permission decision… You can still cancel the response.</p>
            : !onDecidePermission ? <p className="chat-help">Permission decisions are unavailable. You can cancel the response.</p> : null}
        </section>
      ) : null}

      <section className="chat-transcript" aria-label="Conversation transcript" tabIndex={0}>
        {messages.length === 0 ? <p className="chat-help">{loading ? 'Loading saved messages…' : 'No messages yet. Describe what you are testing or ask a question.'}</p> : (
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
                {message.errorMessage ? <p className="chat-error">{message.errorMessage}</p> : null}
              </li>
            ))}
          </ol>
        )}
        {job?.partialText && !completedResponseSaved ? (
          <section className="chat-partial" aria-label={responseLabel}>
            <h3>{responseLabel}</h3>
            <p className="chat-help">{job.state === 'completed' ? 'Waiting for the saved transcript to refresh.' : 'Not a completed transcript message.'}</p>
            <MarkdownContent text={job.partialText} />
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
