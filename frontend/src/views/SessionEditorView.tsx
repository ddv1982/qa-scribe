import { AlertCircle, CheckCircle2, FileText, Loader2, Plus, Sparkles, Trash2, Undo2 } from 'lucide-react'
import type { ClipboardSnapshot, CopyState } from '../app/copyActions'
import { RecordCreationActions, type RecordCreationCommands } from './RecordCreationActions'
import { CopyControls } from './RichRecordView'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import type { GenerateAiActionKind, Session } from '../tauri'
import type { RichEditorDocument } from '../editor/editorDocument'
import { ActionButton } from '../components/ActionButton'
import { StatusPill } from '../components/Common'
import type { BusyAction } from '../ui/types'
import type { PendingAiActions } from '../ui/types'
import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ChatMode } from '../bindings'

export function SessionEditorView({
  creationCommands,
  activeProviderAvailable,
  activeProviderReason,
  activeSession,
  busyAction,
  copyState,
  canUndoLatestGeneration,
  filteredSessions,
  isBusy,
  noteBody, noteBodyHtml,
  noteReadOnly = false,
  onRecoverNote,
  noteIsReady,
  noteScreenshotCount,
  sessionTitle,
  sessionTitleValidationError = null,
  sessionSaveState = 'saved',
  noteWordCount,
  notice,
  error,
  pendingAiActions,
  onAiAction,
  onUndoLatestGeneration,
  onCopy,
  onCreateSession,
  canCreateSession,
  hasSavedSessions = false,
  onExploreExample,
  onDeleteSession,
  onOpenSession,
  onSetNoteBody,
  onSetSessionTitle,
  onUploadImage,
  sessionMode = 'write_note',
  onSetSessionMode,
  noteHandoffContent,
  headerActionsTarget,
}: {
  creationCommands: Record<'testware' | 'finding', RecordCreationCommands>
  activeProviderAvailable: boolean
  activeProviderReason?: string
  activeSession: Session | null
  busyAction: BusyAction | null
  canUndoLatestGeneration: boolean
  copyState: CopyState
  filteredSessions: Session[]
  isBusy: boolean
  noteBody: RichEditorDocument
  noteBodyHtml: string
  noteReadOnly?: boolean
  onRecoverNote?: () => Promise<void>
  noteIsReady: boolean
  noteScreenshotCount: number
  sessionTitle: string
  sessionTitleValidationError?: string | null
  sessionSaveState?: 'invalid' | 'saving' | 'unsaved' | 'saved'
  noteWordCount: number
  notice: string | null
  error: string | null
  pendingAiActions: PendingAiActions
  onAiAction: (action: GenerateAiActionKind) => Promise<void>
  onUndoLatestGeneration: () => Promise<void>
  onCopy: (snapshot: ClipboardSnapshot) => Promise<void>
  onCreateSession: () => void
  canCreateSession: boolean
  hasSavedSessions?: boolean
  onExploreExample?: () => void
  onDeleteSession: () => void
  onOpenSession: (session: Session) => Promise<void>
  onSetNoteBody: (value: RichEditorDocument) => void
  onSetSessionTitle: (value: string) => void
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
  sessionMode?: ChatMode
  onSetSessionMode?: (mode: ChatMode) => void
  noteHandoffContent?: ReactNode
  /** Host beside the Session tabs. `null` waits for the host; omit it to render the actions in place. */
  headerActionsTarget?: HTMLElement | null
}) {
  const deletingSession = busyAction === 'delete-session'
  const undoingGeneration = busyAction === 'undo-generation'
  const summaryPending = Boolean(pendingAiActions.summary)
  const editorId = 'note-body-editor'
  const saveStatusLabel = sessionSaveState === 'invalid'
    ? 'Title required'
    : sessionSaveState === 'saving'
      ? 'Saving...'
      : sessionSaveState === 'unsaved'
        ? 'Unsaved changes'
        : 'Autosaved'

  if (!activeSession) {
    return (
      <section className="workspace-empty">
        <div className="empty-icon">
          <FileText size={34} />
        </div>
        <h1>{busyAction === 'boot' ? 'Loading Sessions…' : hasSavedSessions ? 'No Session selected' : 'Turn testing evidence into useful output'}</h1>
        {busyAction !== 'boot' ? <p>{hasSavedSessions
          ? 'Open a Session to continue your work, or start another.'
          : 'Capture testing evidence, create a Finding or test cases, and copy useful output into your reporting tool. No AI account needed.'}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className="empty-session-actions">
          <ActionButton variant="primary" type="button" disabled={!canCreateSession} onClick={onCreateSession}>
            <Plus size={17} /> Start a Session
          </ActionButton>
          {onExploreExample ? <ActionButton variant="secondary" type="button" disabled={isBusy} onClick={onExploreExample}>Explore an example</ActionButton> : null}
        </div>
        {filteredSessions.length > 0 ? (
          <div className="empty-session-actions">
            {filteredSessions.slice(0, 3).map((session) => (
              <ActionButton variant="secondary" key={session.id} type="button" disabled={isBusy} onClick={() => void onOpenSession(session)}>
                {session.title}
              </ActionButton>
            ))}
          </div>
        ) : null}
      </section>
    )
  }

  const headerActions = (
    <div className="document-actions">
      {canUndoLatestGeneration ? (
        <ActionButton variant="secondary" size="compact" type="button" disabled={isBusy || noteReadOnly} onClick={() => void onUndoLatestGeneration()}>
          {undoingGeneration ? <Loader2 className="spin" size={16} /> : <Undo2 size={16} />}
          Undo generation
        </ActionButton>
      ) : null}
      <div className="document-status" role="status">
        {sessionSaveState === 'invalid' || sessionSaveState === 'unsaved'
          ? <AlertCircle size={15} />
          : sessionSaveState === 'saving' ? <Loader2 className="spin" size={15} /> : <CheckCircle2 size={15} />}
        <span>{saveStatusLabel}</span>
      </div>
      <CopyControls
        snapshot={{ target: { kind: 'note', sessionId: activeSession.id, action: 'jira-text' }, title: sessionTitle, bodyHtml: noteBodyHtml }}
        copyState={copyState} onCopy={onCopy} disabled={isBusy} label="Note" screenshotCount={noteScreenshotCount} size="compact" />
      <ActionButton variant="destructive-quiet" size="compact" iconOnly icon={Trash2} aria-label="Delete Session" title="Delete Session" loading={deletingSession} disabled={isBusy} onClick={() => void onDeleteSession()} />
    </div>
  )

  return (
    <div className="session-workspace">
      {/* The shell hosts these beside the Session tabs; without a host they render in place. */}
      {headerActionsTarget === undefined ? headerActions : headerActionsTarget ? createPortal(headerActions, headerActionsTarget) : null}

      <section key={activeSession.id} className="editor-card" aria-label="Session editor">
        {!noteReadOnly ? <FormatToolbar editorId={editorId} onUploadImage={onUploadImage} /> : null}
        <div className="document-body">
          <SessionTitleField
            value={sessionTitle}
            onChange={onSetSessionTitle}
            placeholder="Untitled session"
            aria-label="Session title"
            aria-invalid={sessionTitleValidationError ? true : undefined}
            aria-describedby={sessionTitleValidationError ? 'session-title-error' : undefined}
          />
          {sessionTitleValidationError ? (
            <p className="field-error" id="session-title-error">{sessionTitleValidationError}</p>
          ) : null}
          {noteReadOnly ? <div role="status">
            <p>Chat submission needs canonical Note recovery. The Note is read-only until recovery succeeds.</p>
            {onRecoverNote ? <ActionButton variant="secondary" type="button" disabled={isBusy} onClick={() => void onRecoverNote()}>Recover Session Note</ActionButton> : null}
          </div> : null}
          {sessionMode === 'write_note' && !noteReadOnly ? noteHandoffContent : null}
          <RichTextEditor editorId={editorId} value={noteBody} readOnly={noteReadOnly} onChange={onSetNoteBody} className="note-rich-editor" />
        </div>
        <footer className="editor-footer">
          <StatusPill notice={notice} error={sessionTitleValidationError ?? error} busyAction={busyAction} />
          <span>{noteWordCount} words</span>
        </footer>
      </section>

      <footer className="bottom-command-bar" aria-label="Note actions">
        <div className="ai-action-buttons">
          <RecordCreationActions commands={creationCommands.finding} secondary />
          <RecordCreationActions commands={creationCommands.testware} secondary />
          {onSetSessionMode ? <ActionButton variant="secondary" className="ask-ai-trigger" icon={Sparkles}
            aria-expanded={sessionMode === 'chat'} aria-controls="notes-ask-ai"
            onClick={() => { onSetSessionMode('chat'); document.querySelector<HTMLTextAreaElement>('#notes-ask-ai textarea:not(:disabled)')?.focus({ preventScroll: true }) }}>Ask AI</ActionButton> : null}
          <ActionButton variant="secondary" type="button" icon={Sparkles} loading={busyAction === 'ai-summary' || summaryPending}
            aria-describedby={!activeProviderAvailable ? "note-summary-unavailable" : undefined} disabled={isBusy || !noteIsReady || !activeProviderAvailable} onClick={() => void onAiAction('summary')}>
            {summaryPending ? 'Summarizing' : 'Summarize'}
          </ActionButton>
        </div>
        {!activeProviderAvailable ? <p className="field-description" id="note-summary-unavailable">
          AI summary unavailable. {activeProviderReason ?? 'Configure an available provider in Settings. You can keep writing and create records without AI.'}
        </p> : null}
      </footer>
    </div>
  )
}

/** A one-line title that wraps instead of clipping (F8). Newlines never enter the value. */
function SessionTitleField({ value, onChange, ...props }: Omit<ComponentProps<'textarea'>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const fit = () => { node.style.height = 'auto'; node.style.height = `${node.scrollHeight}px` }
    fit()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    observer?.observe(node)
    return () => observer?.disconnect()
  }, [value])
  return <textarea {...props} ref={ref} rows={1} className="session-title-input" value={value}
    onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }}
    onChange={(event) => onChange(event.target.value.replace(/\r?\n/g, ' '))} />
}

