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
import type { ReactNode } from 'react'
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

  return (
    <div className="session-workspace">
      <header className="document-topline">
        <p className="document-mode"><FileText size={16} /> Session note</p>
        <div className="document-actions">
          {onSetSessionMode ? <ActionButton variant="secondary" className="ask-ai-trigger" icon={Sparkles}
            aria-expanded={sessionMode === 'chat'} aria-controls="notes-ask-ai"
            onClick={() => { onSetSessionMode('chat'); document.querySelector<HTMLTextAreaElement>('#notes-ask-ai textarea:not(:disabled)')?.focus({ preventScroll: true }) }}>Ask AI</ActionButton> : null}
          <ActionButton variant="secondary" type="button" aria-describedby={!activeProviderAvailable ? "note-summary-unavailable" : undefined} disabled={isBusy || summaryPending || !noteIsReady || !activeProviderAvailable} onClick={() => void onAiAction('summary')}>
            {busyAction === 'ai-summary' || summaryPending ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            {summaryPending ? 'Summarizing notes' : 'Summarize with AI'}
          </ActionButton>
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
            copyState={copyState} onCopy={onCopy} disabled={isBusy} label="Note" screenshotCount={noteScreenshotCount} />
          <ActionButton variant="destructive-quiet" iconOnly icon={Trash2} aria-label="Delete Session" title="Delete Session" loading={deletingSession} disabled={isBusy} onClick={() => void onDeleteSession()} />
        </div>
      {!activeProviderAvailable ? <p className="field-description" id="note-summary-unavailable">
        AI summary unavailable. {activeProviderReason ?? 'Configure an available provider in Settings. You can keep writing and create records without AI.'}
      </p> : null}
      </header>

      <section key={activeSession.id} className="editor-card" aria-label="Session editor">
        {!noteReadOnly ? <FormatToolbar editorId={editorId} onUploadImage={onUploadImage} /> : null}
        <div className="document-body">
          <input
            className="session-title-input"
            value={sessionTitle}
            onChange={(event) => onSetSessionTitle(event.target.value)}
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

        </div>
      </footer>
    </div>
  )
}
