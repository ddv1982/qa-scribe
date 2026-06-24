import { Box, CheckCircle2, ChevronDown, Copy, FileText, Flag, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import type { GenerateAiActionKind, Session } from '../tauri'
import { StatusPill } from '../components/Common'
import type { BusyAction } from '../ui/types'
import type { PendingAiActions } from '../ui/types'

export function NotesView({
  activeProviderAvailable,
  activeSession,
  busyAction,
  filteredSessions,
  isBusy,
  noteBody,
  noteIsReady,
  noteTitle,
  noteWordCount,
  notice,
  error,
  pendingAiActions,
  onAiAction,
  onCopyNote,
  onDeleteNote,
  onNewNote,
  onOpenNote,
  onSetNoteBody,
  onSetNoteTitle,
  onUploadImage,
}: {
  activeProviderAvailable: boolean
  activeSession: Session | null
  busyAction: BusyAction | null
  filteredSessions: Session[]
  isBusy: boolean
  noteBody: string
  noteIsReady: boolean
  noteTitle: string
  noteWordCount: number
  notice: string | null
  error: string | null
  pendingAiActions: PendingAiActions
  onAiAction: (action: GenerateAiActionKind) => Promise<void>
  onCopyNote: () => Promise<void>
  onDeleteNote: () => void
  onNewNote: () => Promise<void>
  onOpenNote: (session: Session) => Promise<void>
  onSetNoteBody: (value: string) => void
  onSetNoteTitle: (value: string) => void
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  const deletingNote = busyAction === 'delete-note'
  const copyingNote = busyAction === 'copy-note'
  const testwarePending = Boolean(pendingAiActions.testware)
  const findingPending = Boolean(pendingAiActions.finding)
  const summaryPending = Boolean(pendingAiActions.summary)
  const editorId = 'note-body-editor'

  if (!activeSession) {
    return (
      <section className="workspace-empty">
        <FileText size={34} />
        <h1>No note selected</h1>
        <p>Create a note or open an existing one to start writing QA notes.</p>
        <div className="empty-note-actions">
          <button className="primary-button" type="button" disabled={isBusy} onClick={() => void onNewNote()}>
            <Plus size={17} />
            New note
          </button>
          {filteredSessions.slice(0, 3).map((session) => (
            <button className="secondary-button" key={session.id} type="button" disabled={isBusy} onClick={() => void onOpenNote(session)}>
              {session.title}
            </button>
          ))}
        </div>
      </section>
    )
  }

  return (
    <div className="note-workspace">
      <header className="document-topline">
        <div className="breadcrumb">
          <FileText size={18} />
          <span>All notes</span>
          <ChevronDown size={14} />
          <strong>{activeSession.title}</strong>
        </div>
        <div className="document-actions">
          <div className="document-status">
            <CheckCircle2 size={15} />
            <span>{busyAction === 'save-title' || busyAction === 'save-body' ? 'Saving...' : 'Autosaved'}</span>
          </div>
          <button className="icon-button" type="button" aria-label="Copy note for Jira" title="Copy note for Jira" disabled={isBusy} onClick={() => void onCopyNote()}>
            {copyingNote ? <Loader2 className="spin" size={16} /> : <Copy size={16} />}
          </button>
          <button className="icon-button danger" type="button" aria-label="Delete note" title="Delete note" disabled={isBusy} onClick={() => void onDeleteNote()}>
            {deletingNote ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
          </button>
        </div>
      </header>

      <section className="editor-card" aria-label="Note editor">
        <FormatToolbar editorId={editorId} onUploadImage={onUploadImage} />
        <div className="document-body">
          <input
            className="note-title-input"
            value={noteTitle}
            onChange={(event) => onSetNoteTitle(event.target.value)}
            placeholder="Untitled note"
            aria-label="Note title"
          />
          <RichTextEditor editorId={editorId} value={noteBody} onChange={onSetNoteBody} className="note-rich-editor" />
        </div>
        <footer className="editor-footer">
          <StatusPill notice={notice} error={error} busyAction={busyAction} />
          <span>{noteWordCount} words</span>
        </footer>
      </section>

      <footer className="bottom-command-bar" aria-label="AI note actions">
        <button className="secondary-button" type="button" disabled={isBusy || testwarePending || !noteIsReady || !activeProviderAvailable} onClick={() => void onAiAction('testware')}>
          {busyAction === 'ai-testware' || testwarePending ? <Loader2 className="spin" size={16} /> : <Box size={16} />}
          {testwarePending ? 'Generating test cases' : 'Generate test cases'}
        </button>
        <button className="secondary-button" type="button" disabled={isBusy || findingPending || !noteIsReady || !activeProviderAvailable} onClick={() => void onAiAction('finding')}>
          {busyAction === 'ai-finding' || findingPending ? <Loader2 className="spin" size={16} /> : <Flag size={16} />}
          {findingPending ? 'Creating finding' : 'Create finding'}
        </button>
        <button className="primary-button" type="button" disabled={isBusy || summaryPending || !noteIsReady || !activeProviderAvailable} onClick={() => void onAiAction('summary')}>
          {busyAction === 'ai-summary' || summaryPending ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
          {summaryPending ? 'Summarizing notes' : 'Summarize notes'}
        </button>
      </footer>
    </div>
  )
}
