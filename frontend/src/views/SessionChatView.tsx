import { ActionButton } from '../components/ActionButton'
import { Paperclip } from 'lucide-react'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ChatMessageList } from './ChatMessageList'
import { ChatImages, ChatImageFailures } from './ChatImages'
import type { ChatImageFailure } from '../app/sessionChat.types'
import { imageFileFromClipboardData, shouldReadNativeClipboardImage } from '../app/attachmentActions'
import { ChatHandoff } from './ChatHandoff'
import { StartNewConversation } from './StartNewConversation'
import { chatIsBusy, type ChatHandoffPresentation } from '../app/sessionChat.presentation'
import '../styles/chat-permissions.css'
import type { AiProvider, ChatImage, ChatPermissionDecision, ChatState, GenerationJobStatus } from '../bindings'
import { MarkdownContent } from '../content/MarkdownContent'
import { useChatTranscriptScroll } from './useChatTranscriptScroll'

export type SessionChatViewProps = {
  handoff: ChatHandoffPresentation
  onOpenNote: () => void
  chat: ChatState | null
  composer: string
  composerImages?: ChatImage[]
  imageFailures?: ChatImageFailure[]
  inputRecoveryPending?: boolean
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
  modelSelectionControl?: ReactNode
  modelSelectionPending?: boolean
  providerAvailable: boolean
  providerReason: string
  onSetComposer: (text: string) => void
  onAttachImages?: (files: File[]) => Promise<void>
  onPasteNativeImage?: () => Promise<void>
  onRemoveImage?: (attachmentId: string) => void
  onRetryImage?: (id: string) => Promise<void>
  onDismissImageFailure?: (id: string) => Promise<void>
  onSend: () => Promise<void>
  onRetry: () => Promise<void>
  onCancel: () => Promise<void>
  onSubmit: () => Promise<void>
  captureRestart?: () => (() => Promise<void>) | null
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

export function SessionChatView(props: SessionChatViewProps) {
  const {
    chat, composer, job, loading, saving, working, error, dirty = false, recoveryPending = false, handoff, onOpenNote,
    permissionWorking = false, permissionRecoveryPending = false,
    providerLabel, modelLabel, providerAvailable, providerReason, modelSelectionControl, modelSelectionPending = false,
    onSetComposer, onAttachImages, onPasteNativeImage, onRemoveImage, onSend, onRetry, onCancel, onSubmit, onConfigureAi,
    onDecidePermission, onRecheck,
  } = props
  const id = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const composerImages = props.composerImages ?? chat?.composerImages ?? []
  const imageFailures = props.imageFailures ?? []
  const inputRecoveryPending = props.inputRecoveryPending ?? false
  const [expandedPermissionKey, setExpandedPermissionKey] = useState<string | null>(null)
  const attentionRef = useRef<HTMLElement>(null)
  const permissionContextRef = useRef<HTMLDivElement>(null)
  const permissionHeadingRef = useRef<HTMLHeadingElement>(null)
  const messages = chat?.messages ?? []
  const latest = messages.at(-1)
  const submitted = Boolean(chat?.submission)
  const recovering = recoveryPending
  const activeJob = job?.state === 'starting' || job?.state === 'running' || job?.state === 'cancelling'
  const running = messages.some((message) => message.status === 'running')
  const busy = chatIsBusy(props)
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
  const permissionAttention = Boolean(pendingPermission || permissionRecoveryPending)
  const { viewportRef, transcriptRef } = useChatTranscriptScroll({ conversationId: chat?.draftId ?? null,
    userTurnId: latest?.role === 'user' ? latest.turnId : null, messageId: latest?.id ?? null,
    partialText: job?.partialText ?? null, paused: permissionAttention || inputRecoveryPending })
  const needsProviderRecovery = inputRecoveryPending || permissionRecoveryPending || !providerAvailable || Boolean(error || job?.errorMessage)
  const locked = !chat || busy || submitted || recovering
  const attachmentsLocked = locked || inputRecoveryPending || composerImages.length >= 4 || !onAttachImages
  const unresolved = messages.filter((message) => message.status !== 'completed')
  const retryable = latest?.role === 'user'
    && ['failed', 'cancelled', 'interrupted'].includes(latest.status)
    && unresolved.length === 1
  const mixedHistory = unresolved.length > 0 && !retryable && !running && !activeJob
  const composerBytes = byteLength(composer)
  const transcriptBytes = messages.reduce((total, message) => total + byteLength(message.text), 0)
  const atLimit = messages.length + 2 > maxMessages || transcriptBytes + composerBytes > transcriptLimit
  const responseLabel = job?.state === 'completed' ? 'Final response pending save' : 'Partial response'
  const sendReason = modelSelectionPending ? 'Wait for the model preference to finish saving.' : !chat ? 'Conversation is not ready.'
    : loading ? 'Loading conversation…'
    : saving ? 'Saving conversation…'
    : busy ? 'Wait for the current operation to finish.'
    : recovering ? 'Recover the Session Note before starting a new conversation.'
    : submitted ? 'Start a new conversation to send another message.'
    : inputRecoveryPending ? 'Recheck status to recover the previous send before continuing.'
    : mixedHistory ? 'An earlier turn is unresolved. Start a new conversation to continue.'
    : retryable ? 'Retry the previous response before sending another message.'
    : !providerAvailable ? providerReason || 'Configure an available AI provider to send.'
    : imageFailures.length ? 'Retry or remove failed images before sending.'
    : composerBytes > messageLimit ? 'Message exceeds the 16 KiB limit. Shorten it before sending.'
    : atLimit ? 'Conversation limit reached. Submit completed messages or start a new conversation.'
    : !composer.trim() && !composerImages.length ? 'Write a message or attach an image to send.' : ''
  const retryReason = modelSelectionPending ? 'Wait for the model preference to finish saving.' : locked ? 'Wait until the conversation is ready.'
    : !providerAvailable ? providerReason || 'Configure an available AI provider to retry.'
    : inputRecoveryPending ? 'Recheck status to recover the previous send before continuing.'
    : imageFailures.length ? 'Retry or remove failed images before retrying the response.'
    : composerImages.length ? 'Clear the unsent message and images before retrying. Your content is kept until you clear it.'
    : composer !== '' ? 'Clear the unsent message before retrying. Your text is kept until you clear it.' : ''
  const status = loading ? 'Loading conversation…' : saving ? 'Saving conversation…'
    : recovering ? 'Session Note recovery required'
    : inputRecoveryPending ? 'Response status recovery required'
    : permissionRecoveryPending ? 'Permission status recovery required'
    : dirty && error ? 'Save failed' : dirty ? 'Unsaved changes'
    : job?.state === 'cancelling' ? 'Cancelling response…'
    : pendingPermission ? 'Waiting for tool permission'
    : activeJob ? job?.progressMessage || 'Waiting for a response…'
    : working || running ? 'Working…' : !chat ? 'Conversation unavailable' : 'Conversation saved'

  function revealPermission() {
    const panel = attentionRef.current
    if (!panel) return
    const bounds = panel.getBoundingClientRect()
    let top = 0
    let bottom = window.innerHeight
    for (let parent = panel.parentElement; parent; parent = parent.parentElement) {
      if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue
      const rect = parent.getBoundingClientRect()
      top = Math.max(top, rect.top + parent.clientTop)
      bottom = Math.min(bottom, rect.top + parent.clientTop + parent.clientHeight)
    }
    if (bounds.top < top || bounds.bottom > bottom) panel.scrollIntoView({ block: 'start', inline: 'nearest' })
  }

  useLayoutEffect(() => {
    if (permissionContextRef.current) permissionContextRef.current.scrollTop = 0
    revealPermission()
  }, [permissionKey, permissionRecoveryPending])

  return (
    <section className="session-chat" aria-label="Session chat">
      {permissionAttention ? (
        <section ref={attentionRef} className="chat-permission" aria-label={pendingPermission ? 'Tool permission' : 'Permission status recovery'} aria-describedby={pendingPermission ? `${id}-permission-scope` : undefined}>
          <header className="chat-permission-identity">
            <h3 ref={permissionHeadingRef} tabIndex={-1}>{permissionRecoveryPending ? 'Permission status recovery' : 'Tool permission'}</h3>
            {pendingPermission ? <p className="chat-help" aria-live="polite">{permissionProviderLabels[pendingPermission.provider]} is waiting for your decision.{pendingPermission.toolName ? ` · ${pendingPermission.toolName}` : ''}</p> : null}
          </header>
          <div ref={permissionContextRef} className="chat-permission-context" role="region" aria-label="Permission context" tabIndex={0}>
            {error || job?.errorMessage ? <p className="chat-error" role="alert">{error || job?.errorMessage}</p> : null}
            {needsProviderRecovery ? (
              <div className="chat-provider-recovery">
                <p className="chat-help">
                  {permissionRecoveryPending
                    ? 'The permission decision could not be confirmed. Recheck status to recover its current state without repeating the decision.'
                    : 'Configure AI to review provider setup or sign-in. Rechecking status does not send a message or retry a response.'}
                </p>
              </div>
            ) : null}
            {pendingPermission ? <>
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
                    <ActionButton variant="secondary" size="compact" type="button" aria-controls={`${id}-permission-input`} onClick={() => setExpandedPermissionKey(permissionKey)}>Show complete arguments</ActionButton>
                  </> : null}
                </> : null}
              </div>
              <p className="chat-help" id={`${id}-permission-scope`}>Approve once applies to this tool call only. Approve all for this response approves this and remaining supported tool requests, including future tool requests in this response. Does not change saved permissions.</p>
              {approvalUnavailable ? <p className="chat-help" id={`${id}-permission-approval-reason`}>The provider does not offer one-time approval.</p> : null}
              {permissionWorking ? <p className="chat-help">Sending permission decision… You can still cancel the response.</p>
                : !onDecidePermission ? <p className="chat-help">Permission decisions are unavailable. You can cancel the response.</p> : null}
            </> : null}
          </div>
          <footer className="chat-permission-decisions">
            {pendingPermission ? (
              <div className="chat-buttons" key={permissionKey}>
                <ActionButton variant="primary" type="button" disabled={permissionDisabled || approvalUnavailable} aria-describedby={approvalUnavailable ? `${id}-permission-approval-reason` : undefined} onClick={() => { if (!permissionDisabled && !approvalUnavailable) void onDecidePermission?.(pendingPermission.requestId, 'approve') }}>Approve once</ActionButton>
                <ActionButton variant="secondary" type="button" disabled={permissionDisabled || approvalUnavailable} aria-describedby={approvalUnavailable ? `${id}-permission-approval-reason` : undefined} onClick={() => { if (!permissionDisabled && !approvalUnavailable) void onDecidePermission?.(pendingPermission.requestId, 'approveAll') }}>Approve all for this response</ActionButton>
                <ActionButton variant="secondary" type="button" disabled={permissionDisabled} onClick={() => { if (!permissionDisabled) void onDecidePermission?.(pendingPermission.requestId, 'deny') }}>Deny</ActionButton>
              </div>
            ) : null}
            <div className="chat-buttons">
              {needsProviderRecovery && onRecheck ? <ActionButton variant="secondary" size="compact" type="button" disabled={recheckDisabled} onClick={() => { if (!recheckDisabled) void onRecheck() }}>Recheck status</ActionButton> : null}
              {activeJob ? <ActionButton variant="secondary" type="button" disabled={job?.state === 'cancelling'} onClick={() => void onCancel()}>Cancel response</ActionButton> : null}
            </div>
          </footer>
        </section>
      ) : null}
      <div ref={viewportRef} className="chat-scroll-region" role="region" aria-label="Conversation and actions" tabIndex={0}>
        <header className="chat-topline">
          <div>
            <h2>Conversation</h2>
            <p className="chat-help">Gather testing information, then add the saved conversation to your Session Note.</p>
          </div>
          {handoff.kind !== 'added' ? <StartNewConversation state={props} /> : null}
        </header>

        <div className="chat-meta">
          <span>Next invocation · {providerLabel} · {modelLabel}</span>
          <span role="status" aria-live="polite">{status}</span>
          <ActionButton variant="secondary" size="compact" type="button" onClick={onConfigureAi} disabled={busy}>
            Configure AI
          </ActionButton>
        </div>
        {!permissionAttention && (error || job?.errorMessage) ? <p className="chat-error" role="alert">{error || job?.errorMessage}</p> : null}
        {needsProviderRecovery && !permissionAttention ? (
          <div className="chat-provider-recovery">
            <p className="chat-help">
              {permissionRecoveryPending
                ? 'The permission decision could not be confirmed. Recheck status to recover its current state without repeating the decision.'
                : 'Configure AI to review provider setup or sign-in. Rechecking status does not send a message or retry a response.'}
            </p>
            {onRecheck ? <ActionButton variant="secondary" size="compact" type="button" disabled={recheckDisabled} onClick={() => { if (!recheckDisabled) void onRecheck() }}>Recheck status</ActionButton> : null}
          </div>
        ) : null}

        <section ref={transcriptRef} className="chat-transcript" aria-label="Conversation transcript" tabIndex={0}>
          {messages.length === 0 ? <p className="chat-help">{loading ? 'Loading saved messages…' : 'No messages yet. Describe what you are testing or ask a question.'}</p> : (
            <ChatMessageList messages={messages} aiRuns={chat?.aiRuns ?? []} />
          )}
          {job && (handoff.hydrationPending || (job.partialText && job.state !== 'completed')) ? (
            <section className="chat-partial" aria-label={responseLabel}>
              <h3>{responseLabel}</h3>
              <p className="chat-help">{job.state === 'completed' ? 'Waiting for the saved transcript to refresh.' : 'Not a completed transcript message.'}</p>
              {job.partialText ? <MarkdownContent text={job.partialText} /> : null}
            </section>
          ) : null}
        </section>

        <p className="chat-counts">{messages.length} / 128 messages · {(transcriptBytes / 1024).toFixed(1)} / 128 KiB transcript</p>
        {modelSelectionControl}
        <ChatHandoff state={props} onOpenNote={onOpenNote} onSubmit={onSubmit} />
      </div>
      <div className="chat-composer">
        <label htmlFor={`${id}-message`}>Message</label>
        <ChatImages images={composerImages} disabled={locked || inputRecoveryPending} onRemove={onRemoveImage} />
        <ChatImageFailures failures={imageFailures} disabled={locked} onRetry={props.onRetryImage} onRemove={props.onDismissImageFailure} />
        <textarea
          id={`${id}-message`} rows={3} value={composer} disabled={!chat || loading || submitted || recovering}
          aria-describedby={`${id}-shortcut ${id}-send-reason`}
          onChange={(event) => onSetComposer(event.target.value)}
          onPaste={(event) => {
            if (!onAttachImages || locked || inputRecoveryPending) return
            const file = imageFileFromClipboardData(event.clipboardData)
            if (file) {
              event.preventDefault()
              void onAttachImages([file])
            } else if (onPasteNativeImage && shouldReadNativeClipboardImage(event.clipboardData)) {
              event.preventDefault()
              void onPasteNativeImage()
            }
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              if (!sendReason && !event.repeat) void onSend()
            }
          }}
          placeholder="Describe your testing context or ask a question"
        />
        <input ref={fileInput} className="chat-image-input" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif"
          aria-label="Choose chat images" tabIndex={-1} onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (!attachmentsLocked && files.length) void onAttachImages?.(files)
          }} />
        <div className="chat-compose-actions">
          <span id={`${id}-shortcut`} className="chat-help">Enter for a new line. Ctrl/Cmd + Enter to send. Paste images with Ctrl/Cmd + V.</span>
          <div className="chat-buttons">
            {permissionAttention ? <ActionButton variant="secondary" type="button" onClick={() => { revealPermission(); permissionHeadingRef.current?.focus({ preventScroll: true }) }}>Review permission</ActionButton> : activeJob ? <ActionButton variant="secondary" type="button" disabled={job?.state === 'cancelling'} onClick={() => void onCancel()}>Cancel response</ActionButton> : null}
            {retryable && !submitted ? <ActionButton variant="secondary" type="button" disabled={Boolean(retryReason)} aria-describedby={`${id}-retry-reason`} onClick={() => { if (!retryReason) void onRetry() }}>Retry response</ActionButton> : null}
            <div className="chat-send-buttons">
            <ActionButton variant="secondary" type="button" iconOnly icon={Paperclip} aria-label="Attach images"
              title="Attach up to 4 images, 10 MiB each" disabled={attachmentsLocked} onClick={() => fileInput.current?.click()} />
            <ActionButton variant="primary" type="button" disabled={Boolean(sendReason)} aria-describedby={`${id}-send-reason`} onClick={() => { if (!sendReason) void onSend() }}>Send</ActionButton>
            </div>
          </div>
        </div>
        <p className="chat-help" id={`${id}-send-reason`}>{sendReason || 'Send this message to the selected AI provider.'}</p>
        {retryable && !submitted ? <p className="chat-help" id={`${id}-retry-reason`}>{retryReason || 'Retry sends the previous message again and may incur another AI usage charge.'}</p> : null}
      </div>
    </section>
  )
}
