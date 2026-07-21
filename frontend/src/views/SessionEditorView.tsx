import { AlertCircle, Box, CheckCircle2, Copy, FileText, Flag, Image as ImageIcon, Loader2, Settings2, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { ProviderGlyph } from '../components/ModelSelector'
import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from '../editor/RichTextEditor'
import type { AiProvider, GenerateAiActionKind, ProviderStatus, Session } from '../tauri'
import type { RichEditorDocument } from '../editor/editorDocument'
import { StatusPill } from '../components/Common'
import type { BusyAction } from '../ui/types'
import type { PendingAiActions } from '../ui/types'
import { statusLabel } from '../ui/format'
import { originSummary, type EffectiveAiSelection } from '../settings/defaults'

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
  sessionTitle,
  sessionTitleValidationError = null,
  sessionSaveState = 'saved',
  noteWordCount,
  notice,
  error,
  pendingAiActions,
  selectedProvider,
  selectedModel,
  effectiveSelection,
  activeProvider,
  onConfigureAi,
  onAiAction,
  onUndoLatestGeneration,
  onCopyNote,
  onCopyNoteScreenshot,
  onDeleteSession,
  onOpenSession,
  onSetNoteBody,
  onSetSessionTitle,
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
  sessionTitle: string
  sessionTitleValidationError?: string | null
  sessionSaveState?: 'invalid' | 'saving' | 'unsaved' | 'saved'
  noteWordCount: number
  notice: string | null
  error: string | null
  pendingAiActions: PendingAiActions
  selectedProvider: AiProvider
  selectedModel: string
  effectiveSelection?: EffectiveAiSelection | null
  activeProvider: ProviderStatus['providers'][number] | null
  onConfigureAi?: () => void
  onAiAction: (action: GenerateAiActionKind) => Promise<void>
  onUndoLatestGeneration: () => Promise<void>
  onCopyNote: () => Promise<void>
  onCopyNoteScreenshot: () => Promise<void>
  onDeleteSession: () => void
  onOpenSession: (session: Session) => Promise<void>
  onSetNoteBody: (value: RichEditorDocument) => void
  onSetSessionTitle: (value: string) => void
  onUploadImage: (input: RichEditorImageUpload) => void | Promise<void>
}) {
  const deletingSession = busyAction === 'delete-session'
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
  const effectiveModelLabel = effectiveSelection?.model ?? selectedModelLabel
  const effectiveReasoningLabel = effectiveSelection?.reasoning ?? 'CLI default'
  const effectiveOrigin = originSummary(effectiveSelection?.modelOrigin ?? null)
  const selectionModeLabel = effectiveSelection?.delegatesModel === false ? 'QA Scribe override' : 'CLI default'
  const providerSummaryLabel = `AI execution: ${selectedProviderLabel}, ${selectionModeLabel} ${effectiveModelLabel}, reasoning ${effectiveReasoningLabel}${effectiveOrigin ? ` from ${effectiveOrigin}` : ''}, ${providerReadinessLabel}`
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
        <h1>No Session selected</h1>
        <p>Create a Session or open an existing one to start writing QA notes.</p>
        {filteredSessions.length > 0 ? (
          <div className="empty-session-actions">
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
    <div className="session-workspace">
      <header className="document-topline">
        <p className="document-mode"><FileText size={16} /> Session note</p>
        <div className="document-actions">
          {canUndoLatestGeneration ? (
            <button className="secondary-button compact-button" type="button" disabled={isBusy} onClick={() => void onUndoLatestGeneration()}>
              {undoingGeneration ? <Loader2 className="spin" size={16} /> : <Undo2 size={16} />}
              Undo generation
            </button>
          ) : null}
          <div className="document-status" role="status">
            {sessionSaveState === 'invalid' || sessionSaveState === 'unsaved'
              ? <AlertCircle size={15} />
              : <CheckCircle2 size={15} />}
            <span>{saveStatusLabel}</span>
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
          <button className="icon-button danger" type="button" aria-label="Delete Session" title="Delete Session" disabled={isBusy} onClick={() => void onDeleteSession()}>
            {deletingSession ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
          </button>
        </div>
      </header>

      <section className="editor-card" aria-label="Session editor">
        <FormatToolbar editorId={editorId} onUploadImage={onUploadImage} />
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
            <p id="session-title-error">{sessionTitleValidationError}</p>
          ) : null}
          <RichTextEditor editorId={editorId} value={noteBody} onChange={onSetNoteBody} className="note-rich-editor" />
        </div>
        <footer className="editor-footer">
          <StatusPill notice={notice} error={sessionTitleValidationError ?? error} busyAction={busyAction} />
          <span>{noteWordCount} words</span>
        </footer>
      </section>

      <footer className="bottom-command-bar" aria-label="AI note actions">
        <div className={activeProvider?.available ? 'ai-provider-summary ready' : 'ai-provider-summary'} aria-label={providerSummaryLabel} title={providerSummaryLabel}>
          <span className="ai-provider-icon"><ProviderGlyph provider={selectedProvider} /></span>
          <div className="ai-provider-selection">
            <div className="ai-provider-value">
              <strong>{effectiveModelLabel}</strong>
              <span className="ai-selection-mode">{selectionModeLabel}</span>
              <span className={activeProvider?.available ? 'ai-provider-state ready' : 'ai-provider-state'}>
                <span className={activeProvider?.available ? 'status-dot ready' : 'status-dot unavailable'} />
                {providerReadinessLabel}
              </span>
            </div>
            <div className="ai-provider-meta">
              <span>{selectedProviderLabel}</span>
              <span>Reasoning {effectiveReasoningLabel}</span>
            </div>
            {!activeProvider?.available ? <p>{activeProvider ? activeProvider.reason : 'Loading provider status'}</p> : null}
          </div>
          {onConfigureAi ? (
            <button className="ai-configure-button" type="button" aria-label="Configure AI execution" title="Configure AI execution" onClick={onConfigureAi}>
              <Settings2 size={15} />
            </button>
          ) : null}
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
