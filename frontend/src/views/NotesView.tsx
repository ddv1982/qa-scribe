import { Box, CheckCircle2, ChevronDown, FileText, Flag, Loader2, Plus, Sparkles } from 'lucide-react'
import { FormatToolbar, RichTextEditor } from '../editor/RichTextEditor'
import type { GenerateAiActionKind, Session } from '../tauri'
import { StatusPill } from '../components/Common'
import type { BusyAction } from '../ui/types'

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
  onAiAction,
  onNewNote,
  onOpenNote,
  onSetNoteBody,
  onSetNoteTitle,
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
  onAiAction: (action: GenerateAiActionKind) => Promise<void>
  onNewNote: () => Promise<void>
  onOpenNote: (session: Session) => Promise<void>
  onSetNoteBody: (value: string) => void
  onSetNoteTitle: (value: string) => void
}) {
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
        <div className="document-status">
          <CheckCircle2 size={15} />
          <span>{busyAction === 'save-title' || busyAction === 'save-body' ? 'Saving...' : 'Autosaved'}</span>
        </div>
      </header>

      <section className="editor-card" aria-label="Note editor">
        <FormatToolbar />
        <div className="document-body">
          <input
            className="note-title-input"
            value={noteTitle}
            onChange={(event) => onSetNoteTitle(event.target.value)}
            placeholder="Untitled note"
            aria-label="Note title"
          />
          <RichTextEditor value={noteBody} onChange={onSetNoteBody} />
        </div>
        <footer className="editor-footer">
          <StatusPill notice={notice} error={error} busyAction={busyAction} />
          <span>{noteWordCount} words</span>
        </footer>
      </section>

      <footer className="bottom-command-bar" aria-label="AI note actions">
        <button className="secondary-button" type="button" disabled={isBusy || !noteIsReady || !activeProviderAvailable} onClick={() => void onAiAction('testware')}>
          {busyAction === 'ai-testware' ? <Loader2 className="spin" size={16} /> : <Box size={16} />}
          Generate test cases
        </button>
        <button className="secondary-button" type="button" disabled={isBusy || !noteIsReady || !activeProviderAvailable} onClick={() => void onAiAction('finding')}>
          {busyAction === 'ai-finding' ? <Loader2 className="spin" size={16} /> : <Flag size={16} />}
          Create finding
        </button>
        <button className="primary-button" type="button" disabled={isBusy || !noteIsReady || !activeProviderAvailable} onClick={() => void onAiAction('summary')}>
          {busyAction === 'ai-summary' ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
          Summarize notes
        </button>
      </footer>
    </div>
  )
}
