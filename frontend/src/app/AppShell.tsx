import type { KeyboardEvent } from 'react'
import { Box, FileText, Flag, Loader2, PencilLine, Plus, Search, Settings } from 'lucide-react'
import { RailItem } from '../components/Common'
import { ThemeToggle } from '../components/ThemeToggle'
import { formatSessionDate } from '../ui/format'
import { FindingsView } from '../views/FindingsView'
import { SessionEditorView } from '../views/SessionEditorView'
import { SettingsView } from '../views/SettingsView'
import { TestwareView } from '../views/TestwareView'
import { GenerationPreflight } from '../workflows/generationPreflight'
import { useModalDialog } from '../hooks/useModalDialog'
import type { AppController } from './useAppController'

export function AppShell(c: AppController) {
  const topAction =
    c.activeView === 'notes'
      ? { label: 'New note', busy: 'new-note' as const, run: () => void c.handleNewSession() }
      : c.activeView === 'testware'
        ? { label: 'New testware', busy: 'manual-testware' as const, run: () => void c.handleManualTestware() }
        : c.activeView === 'findings'
          ? { label: 'New finding', busy: 'manual-finding' as const, run: () => void c.handleManualFinding() }
          : null
  const visibleSessions = c.filteredSessions.slice(0, 8)

  function handleNoteOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    focusListboxOption(event)
  }

  return (
    <main className="app-shell" onPaste={c.handlePaste}>
      <header className="top-bar">
        <div className="brand-cluster">
          <span className="brand-mark">
            <PencilLine size={21} strokeWidth={2.4} />
          </span>
          <strong>QA Scribe</strong>
        </div>

        <label className="global-search">
          <Search size={17} />
          <span className="sr-only">Search notes</span>
          <input value={c.searchQuery} onChange={(event) => c.setSearchQuery(event.target.value)} placeholder="Search notes..." />
        </label>

        <div className="top-actions">
          <ThemeToggle theme={c.theme} onThemeChange={c.setTheme} />
          {topAction ? (
            <button className="primary-button top-new-button" type="button" disabled={c.isBusy} onClick={topAction.run}>
              {c.busyAction === topAction.busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
              {topAction.label}
            </button>
          ) : null}
        </div>
      </header>

      <aside className="left-rail" aria-label="Workspace navigation">
        <nav className="section-nav" aria-label="Primary">
          <RailItem icon={FileText} label="Notes" count={c.sessions.length} active={c.activeView === 'notes'} onClick={() => c.setActiveView('notes')} />
          <RailItem icon={Box} label="Testware" count={c.testwareDraftCount} active={c.activeView === 'testware'} onClick={() => c.setActiveView('testware')} />
          <RailItem icon={Flag} label="Findings" count={c.findingCount} active={c.activeView === 'findings'} onClick={() => c.setActiveView('findings')} />
        </nav>

        <section className="note-picker" aria-label="Choose note">
          <p className="rail-heading">Choose note</p>
          <div className="note-picker-list" role="listbox" aria-label="Notes">
            {visibleSessions.map((session) => (
              <button
                key={session.id}
                className={c.activeSession?.id === session.id ? 'note-picker-item active' : 'note-picker-item'}
                type="button"
                role="option"
                aria-selected={c.activeSession?.id === session.id}
                disabled={c.isBusy && c.activeSession?.id !== session.id}
                onClick={() => void c.openSession(session)}
                onKeyDown={handleNoteOptionKeyDown}
              >
                <span>{session.title}</span>
                <small>{formatSessionDate(session.updatedAt)}</small>
              </button>
            ))}
            {c.filteredSessions.length === 0 ? <p className="note-picker-empty">No matching notes</p> : null}
          </div>
          {c.filteredSessions.length > 8 ? <p className="note-picker-more">Showing 8 of {c.filteredSessions.length}. Search to narrow.</p> : null}
          {!c.sessionLibraryComplete ? (
            <button className="secondary-button" type="button" disabled={c.isBusy} onClick={() => void c.handleLoadSessionLibrary()}>
              {c.busyAction === 'load-session-library' ? <Loader2 className="spin" size={16} /> : null}
              Load all notes
            </button>
          ) : null}
        </section>

        <button className={c.activeView === 'settings' ? 'settings-link active' : 'settings-link'} type="button" aria-current={c.activeView === 'settings' ? 'page' : undefined} onClick={() => c.setActiveView('settings')}>
          <Settings size={17} />
          Settings
        </button>
      </aside>

      <section className="center-workspace" aria-label="Workspace">
        {c.activeView === 'notes' ? (
          <SessionEditorView
            activeProviderAvailable={Boolean(c.activeProvider?.available)}
            activeSession={c.activeSession}
            busyAction={c.busyAction}
            canUndoLatestGeneration={Boolean(c.latestNoteGenerationUndo && c.noteEntry?.id === c.latestNoteGenerationUndo.entryId)}
            copySucceeded={Boolean(c.activeSession && c.copiedTarget?.kind === 'note' && c.copiedTarget.id === c.activeSession.id && c.copiedTarget.action === 'jira-text')}
            screenshotCopySucceeded={Boolean(c.activeSession && c.copiedTarget?.kind === 'note' && c.copiedTarget.id === c.activeSession.id && c.copiedTarget.action === 'screenshot')}
            filteredSessions={c.filteredSessions}
            isBusy={c.isBusy}
            noteBody={c.noteBody}
            noteIsReady={c.noteIsReady}
            noteTitle={c.noteTitle}
            noteScreenshotCount={c.noteScreenshotCount}
            noteWordCount={c.noteWordCount}
            notice={c.notice}
            error={c.error}
            pendingAiActions={c.pendingAiActions}
            selectedProvider={c.selectedProvider}
            selectedModel={c.selectedModel}
            activeProvider={c.activeProvider}
            onUndoLatestGeneration={c.handleUndoLatestNoteGeneration}
            onAiAction={(action) => {
              c.setPendingGenerationAction(action)
              return Promise.resolve()
            }}
            onCopyNote={c.handleCopyNoteForJira}
            onCopyNoteScreenshot={c.handleCopyNoteScreenshotForJira}
            onDeleteSession={c.requestDeleteSession}
            onOpenSession={c.openSession}
            onSetNoteBody={(value) => {
              c.setLatestNoteGenerationUndo(null)
              c.setNoteBody(value)
            }}
            onSetNoteTitle={c.setNoteTitle}
            onUploadImage={(input) => {
              if (!c.noteEntry) {
                c.setError('Open an editable note before uploading note images.')
                return
              }
              return c.uploadEditorImage(input, c.noteEntry.id)
            }}
          />
        ) : null}

        {c.activeView === 'testware' ? (
          <TestwareView
            busyAction={c.busyAction}
            copiedDraftId={c.copiedTarget?.kind === 'draft' && c.copiedTarget.action === 'jira-text' ? c.copiedTarget.id : null}
            copiedDraftScreenshotId={c.copiedTarget?.kind === 'draft' && c.copiedTarget.action === 'screenshot' ? c.copiedTarget.id : null}
            draftScreenshotCounts={c.draftScreenshotCounts}
            drafts={c.testwareDrafts}
            notice={c.notice}
            error={c.error}
            isBusy={c.isBusy}
            activeGenerationJob={c.activeTestwareJob}
            onCancelGenerationJob={c.handleCancelGenerationJob}
            onCopyDraft={c.handleCopyDraftForJira}
            onCopyDraftScreenshot={c.handleCopyDraftScreenshotForJira}
            onDeleteDraft={c.requestDeleteDraft}
            onPrefillFromNote={c.handlePrefillTestwareFromNote}
            onSaveDraft={c.handleSaveDraft}
            onUploadImage={(input) => c.uploadEditorImage(input, null)}
            updateLocalDraft={c.updateLocalDraft}
          />
        ) : null}

        {c.activeView === 'findings' ? (
          <FindingsView
            busyAction={c.busyAction}
            copiedFindingId={c.copiedTarget?.kind === 'finding' && c.copiedTarget.action === 'jira-text' ? c.copiedTarget.id : null}
            copiedFindingScreenshotId={c.copiedTarget?.kind === 'finding' && c.copiedTarget.action === 'screenshot' ? c.copiedTarget.id : null}
            findingScreenshotCounts={c.findingScreenshotCounts}
            findings={c.findings}
            notice={c.notice}
            error={c.error}
            isBusy={c.isBusy}
            activeGenerationJob={c.activeFindingJob}
            onCancelGenerationJob={c.handleCancelGenerationJob}
            onCopyFinding={c.handleCopyFindingForJira}
            onCopyFindingScreenshot={c.handleCopyFindingScreenshotForJira}
            onDeleteFinding={c.requestDeleteFinding}
            onPrefillFromNote={c.handlePrefillFindingFromNote}
            onSaveFinding={c.handleSaveFinding}
            onUploadImage={(input) => c.uploadEditorImage(input, null)}
            updateLocalFinding={c.updateLocalFinding}
          />
        ) : null}

        {c.activeView === 'settings' ? (
          <SettingsView
            busyAction={c.busyAction}
            providerStatus={c.providerStatus}
            settingsDraft={c.settingsDraft}
            settingsSaveState={c.settingsSaveState}
            theme={c.theme}
            updateSettingsDraft={c.updateSettingsDraft}
            setTheme={c.setTheme}
            onSaveSettings={c.handleSaveSettings}
            onRefreshProviderStatus={c.handleRefreshProviderStatus}
          />
        ) : null}
      </section>

      {c.deleteConfirmation && c.deleteCopy ? (
        <DeleteConfirmationDialog
          copy={c.deleteCopy}
          isBusy={c.isBusy}
          onCancel={() => c.setDeleteConfirmation(null)}
          onConfirm={() => void c.confirmDelete()}
        />
      ) : null}

      {c.pendingGenerationAction ? (
        <GenerationPreflight
          action={c.pendingGenerationAction}
          isBusy={c.isBusy}
          noteTitle={c.noteTitle}
          noteWordCount={c.noteWordCount}
          noteScreenshotCount={c.noteScreenshotCount}
          activeProviderLabel={c.activeProvider?.label ?? c.selectedProvider}
          activeProviderAvailable={Boolean(c.activeProvider?.available)}
          selectedModel={c.effectiveAiSelection.model}
          selectedReasoning={c.effectiveAiSelection.reasoning}
          selectionWarning={c.effectiveAiSelection.warning ?? c.activeProvider?.defaultSnapshot.warnings.join(' ') ?? null}
          onCancel={() => c.setPendingGenerationAction(null)}
          onConfirm={(testwarePreferences) => {
            const action = c.pendingGenerationAction
            if (!action) return
            c.setPendingGenerationAction(null)
            void c.handleAiAction(action, testwarePreferences)
          }}
        />
      ) : null}
    </main>
  )
}

function focusListboxOption(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const listbox = event.currentTarget.closest('[role="listbox"]')
  const options = Array.from(listbox?.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)') ?? [])
  if (options.length === 0) return

  const currentIndex = Math.max(0, options.indexOf(event.currentTarget))
  const nextIndex = optionIndexForKey(event.key, currentIndex, options.length)
  event.preventDefault()
  options[nextIndex]?.focus()
}

function optionIndexForKey(key: string, currentIndex: number, optionCount: number): number {
  if (key === 'Home') return 0
  if (key === 'End') return optionCount - 1
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1)
  return Math.min(optionCount - 1, currentIndex + 1)
}

export function DeleteConfirmationDialog({
  copy,
  isBusy,
  onCancel,
  onConfirm,
}: {
  copy: { title: string; body: string; confirmLabel: string }
  isBusy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useModalDialog(onCancel)
  return (
    <dialog ref={dialogRef} className="confirmation-dialog" aria-labelledby="delete-dialog-title">
      <div>
        <p className="eyebrow">Confirm delete</p>
        <h2 id="delete-dialog-title">{copy.title}</h2>
        <p>{copy.body}</p>
      </div>
      <div className="confirmation-actions">
        <button className="secondary-button" type="button" disabled={isBusy} onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button danger-button" type="button" disabled={isBusy} onClick={onConfirm}>
          {copy.confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
