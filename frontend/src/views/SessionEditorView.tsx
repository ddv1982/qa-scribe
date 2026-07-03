import { Box, CheckCircle2, ChevronDown, Copy, FileText, Flag, Image as ImageIcon, Loader2, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { ProviderGlyph } from '../components/ModelSelector'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import type { AiProvider, GenerateAiActionKind, ProviderStatus, Session } from '../tauri'
import type { RichEditorDocument } from '../editor/editorDocument'
import { StatusPill } from '../components/Common'
import type { BusyAction } from '../ui/types'
import type { PendingAiActions } from '../ui/types'
import { statusLabel } from '../ui/format'

export function SessionEditorView({
  activeProviderAvailable,
  activeSession,
  busyAction,
  copySucceeded,
  canUndoLatestGeneration,
  screenshotCopySucceeded,
  filteredSessions,
  isBusy,
  noteBody,
  noteIsReady,
  noteScreenshotCount,
  noteTitle,
  noteWordCount,
  notice,
  error,
  pendingAiActions,
  selectedProvider,
  selectedModel,
  activeProvider,
  onAiAction,
  onUndoLatestGeneration,
  onCopyNote,
  onCopyNoteScreenshot,
  onDeleteSession,
  onOpenSession,
  onSetNoteBody,
  onSetNoteTitle,
  onUploadImage,
}: {
  activeProviderAvailable: boolean
  activeSession: Session | null
  busyAction: BusyAction | null
  canUndoLatestGeneration: boolean
  copySucceeded: boolean
  screenshotCopySucceeded: boolean
  filteredSessions: Session[]
  isBusy: boolean
  noteBody: RichEditorDocument
  noteIsReady: boolean
  noteScreenshotCount: number
  noteTitle: string
  noteWordCount: number
  notice: string | null
  error: string | null
  pendingAiActions: PendingAiActions
  selectedProvider: AiProvider
  selectedModel: string
  activeProvider: ProviderStatus['providers'][number] | null
  onAiAction: (action: GenerateAiActionKind) => Promise<void>
  onUndoLatestGeneration: () => Promise<void>
  onCopyNote: () => Promise<void>
  onCopyNoteScreenshot: () => Promise<void>
  onDeleteSession: () => void
  onOpenSession: (session: Session) => Promise<void>
  onSetNoteBody: (value: RichEditorDocument) => void
  onSetNoteTitle: (value: string) => void
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  const deletingSession = busyAction === 'delete-note'
  const copyingNote = busyAction === 'copy-note'
  const copyingNoteScreenshot = busyAction === 'copy-note-screenshot'
  const undoingGeneration = busyAction === 'undo-generation'
  const copyNoteLabel = copySucceeded ? 'Note copied for Jira' : 'Copy note for Jira'
  const copyNoteScreenshotLabel = screenshotCopySucceeded
    ? 'Note screenshot copied for Jira'
    : noteScreenshotCount > 1
      ? 'Copy first note screenshot for Jira'
      : 'Copy note screenshot for Jira'
  const testwarePending = Boolean(pendingAiActions.testware)
  const findingPending = Boolean(pendingAiActions.finding)
  const summaryPending = Boolean(pendingAiActions.summary)
  const editorId = 'note-body-editor'
  const selectedModelLabel = activeProvider?.models.find((model) => model.id === (selectedModel.trim() || 'default'))?.label ?? (selectedModel.trim() || 'Provider default')
  const selectedProviderLabel = activeProvider?.label ?? selectedProvider
  const providerReadinessLabel = activeProvider ? (activeProvider.available ? 'Ready' : statusLabel(activeProvider.status)) : 'Loading'
  const providerSummaryLabel = `AI default: ${selectedProviderLabel}, ${selectedModelLabel}, ${providerReadinessLabel}`

  if (!activeSession) {
    return (
      <section className="workspace-empty">
        <FileText size={34} />
        <h1>No note selected</h1>
        <p>Create a note or open an existing one to start writing QA notes.</p>
        {filteredSessions.length > 0 ? (
          <div className="empty-note-actions">
            {filteredSessions.slice(0, 3).map((session) => (
              <button className="secondary-button" key={session.id} type="button" disabled={isBusy} onClick={() => void onOpenSession(session)}>
                {session.title}
              </button>
            ))}
          </div>
        ) : null}
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
          {canUndoLatestGeneration ? (
            <button className="secondary-button compact-button" type="button" disabled={isBusy} onClick={() => void onUndoLatestGeneration()}>
              {undoingGeneration ? <Loader2 className="spin" size={16} /> : <Undo2 size={16} />}
              Undo generation
            </button>
          ) : null}
          <div className="document-status">
            <CheckCircle2 size={15} />
            <span>{busyAction === 'save-title' || busyAction === 'save-body' ? 'Saving...' : 'Autosaved'}</span>
          </div>
          <button
            className={copySucceeded ? 'icon-button success' : 'icon-button'}
            type="button"
            aria-label={copyNoteLabel}
            title={copySucceeded ? 'Copied' : 'Copy note for Jira'}
            disabled={isBusy}
            onClick={() => void onCopyNote()}
          >
            {copyingNote ? <Loader2 className="spin" size={16} /> : copySucceeded ? <CheckCircle2 size={16} /> : <Copy size={16} />}
          </button>
          {noteScreenshotCount > 0 ? (
            <button
              className={screenshotCopySucceeded ? 'icon-button success' : 'icon-button'}
              type="button"
              aria-label={copyNoteScreenshotLabel}
              title={screenshotCopySucceeded ? 'Screenshot copied' : noteScreenshotCount > 1 ? 'Copy first screenshot' : 'Copy screenshot'}
              disabled={isBusy}
              onClick={() => void onCopyNoteScreenshot()}
            >
              {copyingNoteScreenshot ? <Loader2 className="spin" size={16} /> : screenshotCopySucceeded ? <CheckCircle2 size={16} /> : <ImageIcon size={16} />}
            </button>
          ) : null}
          <button className="icon-button danger" type="button" aria-label="Delete note" title="Delete note" disabled={isBusy} onClick={() => void onDeleteSession()}>
            {deletingSession ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
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
        <div className={activeProvider?.available ? 'ai-provider-summary ready' : 'ai-provider-summary'} aria-label={providerSummaryLabel} title={activeProvider?.reason}>
          <ProviderGlyph provider={selectedProvider} />
          <div>
            <span>AI default</span>
            <strong>{selectedProviderLabel}</strong>
          </div>
          <span className="ai-provider-model">{selectedModelLabel}</span>
          <span className={activeProvider?.available ? 'ai-provider-state ready' : 'ai-provider-state'}>{providerReadinessLabel}</span>
          {!activeProvider?.available ? <p>{activeProvider ? activeProvider.reason : 'Loading provider status'}</p> : null}
        </div>
        <div className="ai-action-buttons">
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
        </div>
      </footer>
    </div>
  )
}
