import { useEffect, useState, type KeyboardEvent } from 'react'
import { BookOpen, Box, ChevronRight, Command as CommandIcon, FileText, Flag, Loader2, PencilLine, Plus, Search, Settings } from 'lucide-react'
import { RailItem } from '../components/Common'
import { formatSessionDate } from '../ui/format'
import { FindingsView } from '../views/FindingsView'
import { SessionEditorView } from '../views/SessionEditorView'
import { SettingsView } from '../views/SettingsView'
import { TestwareView } from '../views/TestwareView'
import { OutputLibraryView } from '../views/OutputLibraryView'
import { GenerationPreflight } from '../workflows/generationPreflight'
import type { AppController } from './useAppController'
import { createCommandRegistry, type AppCommandId } from './commandRegistry'
import { CommandPalette, DeleteConfirmationDialog, PendingChangesDialog } from './AppOverlays'
import { primaryModifierPressed, primaryShortcutLabel } from './platformShortcuts'

export { DeleteConfirmationDialog } from './AppOverlays'

export function AppShell(c: AppController) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [librarySidebarTarget, setLibrarySidebarTarget] = useState<HTMLDivElement | null>(null)
  const commands = createCommandRegistry(c)
  const commandById = (id: AppCommandId) => commands.find((command) => command.id === id)
  const runCommand = (id: AppCommandId) => commandById(id)?.run()
  const topAction = c.activeView === 'sessions'
    ? { command: commandById('session.new'), busy: 'new-session' as const }
    : c.activeView === 'testware'
      ? { command: commandById('testware.new'), busy: 'manual-testware' as const }
      : c.activeView === 'findings'
        ? { command: commandById('finding.new'), busy: 'manual-finding' as const }
        : null
  const visibleSessions = c.filteredSessions.slice(0, 8)
  const tabbableSessionId = visibleSessions.some((session) => session.id === c.activeSession?.id) ? c.activeSession?.id : visibleSessions[0]?.id
  const sessionScopedView = c.activeView === 'sessions' || c.activeView === 'testware' || c.activeView === 'findings'
  const libraryView = c.activeView === 'testware-library' || c.activeView === 'findings-library'

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (!primaryModifierPressed(event)) return
      if (event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen(true)
        return
      }
      const matched = commands.find((command) => command.shortcut?.key === event.key.toLocaleLowerCase())
      if (!matched?.available) return
      event.preventDefault()
      matched.run()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [commands])

  function handleSessionOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
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

        {c.activeView === 'sessions' ? (
          <label className="global-search">
            <Search size={17} />
            <span className="sr-only">Search Sessions</span>
            <input value={c.searchQuery} onChange={(event) => c.setSearchQuery(event.target.value)} placeholder="Search Sessions…" />
          </label>
        ) : c.activeView === 'testware' || c.activeView === 'findings' ? (
          <div className="top-context-label" aria-label="Current search scope">
            <span>{c.activeSession?.title}</span>
            <ChevronRight size={14} />
            <strong>{c.activeView === 'testware' ? 'Testware' : 'Findings'}</strong>
          </div>
        ) : c.activeView === 'testware-library' || c.activeView === 'findings-library' ? (
          <div className="top-context-label" aria-label="Current search scope"><strong>{c.activeView === 'testware-library' ? 'Testware library' : 'Findings library'}</strong></div>
        ) : <div className="top-context-label"><strong>Settings</strong></div>}

        <div className="top-actions">
          <button className="secondary-button command-palette-trigger" type="button" aria-label="Open command palette" onClick={() => setCommandPaletteOpen(true)}>
            <CommandIcon size={16} />
            Commands
            <kbd>{primaryShortcutLabel('k')}</kbd>
          </button>
          {topAction?.command ? (
            <button className="primary-button top-new-button" type="button" disabled={!topAction.command.available} onClick={topAction.command.run}>
              {c.busyAction === topAction.busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
              {topAction.command.label}
            </button>
          ) : null}
        </div>
      </header>

      <aside className="left-rail" aria-label="Workspace navigation">
        <nav className="workspace-nav" aria-label="Workspace sections">
          <RailItem icon={FileText} label="Sessions" count={c.sessions.length} active={sessionScopedView} onClick={() => runCommand('view.note')} />
          <RailItem icon={BookOpen} label="Testware library" active={c.activeView === 'testware-library'} onClick={() => runCommand('library.testware')} />
          <RailItem icon={Flag} label="Findings library" active={c.activeView === 'findings-library'} onClick={() => runCommand('library.findings')} />
        </nav>

        {sessionScopedView ? <section className="session-picker contextual-rail" aria-label="Sessions">
          <p className="rail-heading">Recent sessions</p>
          <div className="session-picker-list" role="listbox" aria-label="Sessions">
            {visibleSessions.map((session) => (
              <button
                key={session.id}
                className={c.activeSession?.id === session.id ? 'session-picker-item active' : 'session-picker-item'}
                type="button"
                role="option"
                aria-selected={c.activeSession?.id === session.id}
                tabIndex={tabbableSessionId === session.id ? 0 : -1}
                disabled={c.isBusy && c.activeSession?.id !== session.id}
                onClick={() => void c.openSessionInCurrentView(session)}
                onKeyDown={handleSessionOptionKeyDown}
              >
                <span className="session-picker-title" title={session.title}>{session.title}</span>
                <small className="session-picker-date">{formatSessionDate(session.updatedAt)}</small>
              </button>
            ))}
            {c.filteredSessions.length === 0 ? <p className="session-picker-empty">No matching sessions</p> : null}
          </div>
          {c.filteredSessions.length > 8 ? <p className="session-picker-more">Showing 8 of {c.filteredSessions.length}. Search to narrow.</p> : null}
          {!c.sessionLibraryComplete ? (
            <button className="secondary-button" type="button" disabled={!commandById('sessions.load-all')?.available} onClick={() => runCommand('sessions.load-all')}>
              {c.busyAction === 'load-session-library' ? <Loader2 className="spin" size={16} /> : null}
              {commandById('sessions.load-all')?.label}
            </button>
          ) : null}
        </section> : null}

        {libraryView ? (
          <section className="library-sidebar contextual-rail" aria-label={c.activeView === 'testware-library' ? 'Testware library records' : 'Findings library records'}>
            <p className="rail-heading">{c.activeView === 'testware-library' ? 'Testware' : 'Findings'}</p>
            <div className="library-sidebar-slot" ref={setLibrarySidebarTarget} />
          </section>
        ) : null}

        {sessionScopedView ? <label className="compact-session-select">
          <span>Session</span>
          <select
            value={c.activeSession?.id ?? ''}
            disabled={c.isBusy || c.sessions.length === 0}
            onChange={(event) => {
              const session = c.sessions.find((candidate) => candidate.id === event.target.value)
              if (session) void c.openSessionInCurrentView(session)
            }}
          >
            {c.sessions.length === 0 ? <option value="">No Sessions yet</option> : null}
            {c.sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
          </select>
        </label> : null}

        <button className={c.activeView === 'settings' ? 'settings-link active' : 'settings-link'} type="button" aria-current={c.activeView === 'settings' ? 'page' : undefined} onClick={() => runCommand('settings.open')}>
          <Settings size={17} />
          Settings
        </button>
      </aside>

      <section className="center-workspace" aria-label="Workspace">
        {c.activeSession && ['sessions', 'testware', 'findings'].includes(c.activeView) ? (
          <header className="session-context-header">
            <div className="session-breadcrumb" aria-label="Breadcrumb">
              <button type="button" onClick={() => runCommand('view.note')}>Sessions</button>
              <ChevronRight size={14} />
              <strong>{c.activeSession.title}</strong>
            </div>
            <nav className="session-workspace-tabs" role="tablist" aria-label={`${c.activeSession.title} workspace`}>
              <button type="button" role="tab" className={c.activeView === 'sessions' ? 'active' : ''} aria-selected={c.activeView === 'sessions'} onClick={() => runCommand('view.note')} onKeyDown={activateAdjacentTab}>
                <FileText size={16} /> Note
              </button>
              <button type="button" role="tab" className={c.activeView === 'testware' ? 'active' : ''} aria-selected={c.activeView === 'testware'} onClick={() => runCommand('view.testware')} onKeyDown={activateAdjacentTab}>
                <Box size={16} /> Testware <span>{c.testwareDraftCount}</span>
              </button>
              <button type="button" role="tab" className={c.activeView === 'findings' ? 'active' : ''} aria-selected={c.activeView === 'findings'} onClick={() => runCommand('view.findings')} onKeyDown={activateAdjacentTab}>
                <Flag size={16} /> Findings <span>{c.findingCount}</span>
              </button>
            </nav>
          </header>
        ) : null}
        {c.activeView === 'sessions' ? (
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
            sessionTitle={c.sessionTitle}
            noteScreenshotCount={c.noteScreenshotCount}
            noteWordCount={c.noteWordCount}
            notice={c.notice}
            error={c.error}
            pendingAiActions={c.pendingAiActions}
            selectedProvider={c.selectedProvider}
            selectedModel={c.selectedModel}
            effectiveSelection={c.effectiveAiSelection}
            activeProvider={c.activeProvider}
            onConfigureAi={() => runCommand('ai.configure')}
            onUndoLatestGeneration={c.handleUndoLatestNoteGeneration}
            onAiAction={c.openGenerationPreflight}
            onCopyNote={c.handleCopyNoteForJira}
            onCopyNoteScreenshot={c.handleCopyNoteScreenshotForJira}
            onDeleteSession={c.requestDeleteSession}
            onOpenSession={c.openSession}
            onSetNoteBody={(value) => {
              c.setLatestNoteGenerationUndo(null)
              c.setNoteBody(value)
            }}
            onSetSessionTitle={c.setSessionTitle}
            onUploadImage={(input) => {
              if (!c.noteEntry) {
                c.setError('Open a Session with an editable Note Entry before uploading images.')
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
            sessionTitle={c.activeSession?.title ?? null}
            notice={c.notice}
            error={c.error}
            isBusy={c.isBusy}
            activeGenerationJob={c.activeTestwareJob}
            initialSelectedRecordId={c.focusedRecordId}
            loadState={c.draftLoadState}
            loadError={c.draftLoadError}
            onRetryLoad={() => {
              if (c.activeSession) void c.loadDraftsForSession(c.activeSession.id, { force: true }).catch(() => undefined)
            }}
            onCancelGenerationJob={c.handleCancelGenerationJob}
            onCopyDraft={c.handleCopyDraftForJira}
            onCopyDraftScreenshot={c.handleCopyDraftScreenshotForJira}
            onDeleteDraft={c.requestDeleteDraft}
            onPrefillFromNote={c.handlePrefillTestwareFromNote}
            onSaveDraft={c.handleSaveDraft}
            onDiscardDraft={c.discardLocalDraft}
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
            sessionTitle={c.activeSession?.title ?? null}
            notice={c.notice}
            error={c.error}
            isBusy={c.isBusy}
            activeGenerationJob={c.activeFindingJob}
            initialSelectedRecordId={c.focusedRecordId}
            loadState={c.findingLoadState}
            loadError={c.findingLoadError}
            onRetryLoad={() => {
              if (c.activeSession) void c.loadFindingsForSession(c.activeSession.id, { force: true }).catch(() => undefined)
            }}
            onCancelGenerationJob={c.handleCancelGenerationJob}
            onCopyFinding={c.handleCopyFindingForJira}
            onCopyFindingScreenshot={c.handleCopyFindingScreenshotForJira}
            onDeleteFinding={c.requestDeleteFinding}
            onPrefillFromNote={c.handlePrefillFindingFromNote}
            onSaveFinding={c.handleSaveFinding}
            onDiscardFinding={c.discardLocalFinding}
            onUploadImage={(input) => c.uploadEditorImage(input, null)}
            updateLocalFinding={c.updateLocalFinding}
          />
        ) : null}

        {c.activeView === 'testware-library' ? (
          <OutputLibraryView
            kind="testware"
            draftItems={c.draftLibrary}
            loadState={c.draftLibraryState}
            loadError={c.draftLibraryError}
            onRetry={() => void c.loadDraftLibrary()}
            onOpenRecord={(sessionId, recordId) => void c.openLibraryRecord(sessionId, 'testware', recordId)}
            sidebarTarget={librarySidebarTarget}
          />
        ) : null}

        {c.activeView === 'findings-library' ? (
          <OutputLibraryView
            kind="findings"
            findingItems={c.findingLibrary}
            loadState={c.findingLibraryState}
            loadError={c.findingLibraryError}
            onRetry={() => void c.loadFindingLibrary()}
            onOpenRecord={(sessionId, recordId) => void c.openLibraryRecord(sessionId, 'findings', recordId)}
            sidebarTarget={librarySidebarTarget}
          />
        ) : null}

        {c.activeView === 'settings' ? (
          <SettingsView
            busyAction={c.busyAction}
            providerStatus={c.providerStatus}
            providerDiscoveryState={c.providerDiscoveryState}
            settingsDraft={c.settingsDraft}
            settingsDirty={c.settingsDirty}
            settingsSaveState={c.settingsSaveState}
            theme={c.theme}
            updateSettingsDraft={c.updateSettingsDraft}
            setTheme={c.setTheme}
            onSaveSettings={c.handleSaveSettings}
            onDiscardSettings={c.discardSettingsDraft}
            onRefreshProviderStatus={c.handleRefreshProviderStatus}
            onBack={c.closeSettings}
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

      {c.pendingNavigationView ? (
        <PendingChangesDialog
          isBusy={c.isBusy}
          onCancel={c.cancelPendingNavigation}
          onDiscard={c.discardPendingNavigationChanges}
          onSave={() => void c.savePendingNavigationChanges()}
        />
      ) : null}

      {commandPaletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setCommandPaletteOpen(false)} />
      ) : null}

      {c.pendingGenerationAction ? (
        <GenerationPreflight
          action={c.pendingGenerationAction}
          isBusy={c.isBusy}
          sessionTitle={c.sessionTitle}
          noteWordCount={c.noteWordCount}
          noteScreenshotCount={c.noteScreenshotCount}
          activeProviderLabel={c.activeProvider?.label ?? c.selectedProvider}
          activeProviderAvailable={Boolean(c.activeProvider?.available)}
          selectedModel={c.effectiveAiSelection?.model ?? 'CLI resolves at run time'}
          selectedReasoning={c.effectiveAiSelection?.reasoning ?? null}
          modelOrigin={c.effectiveAiSelection?.modelOrigin ?? null}
          reasoningOrigin={c.effectiveAiSelection?.reasoningOrigin ?? null}
          delegatesModel={c.effectiveAiSelection?.delegatesModel ?? true}
          delegatesReasoning={c.effectiveAiSelection?.delegatesReasoning ?? true}
          executionSummary={c.effectiveAiSelection?.runtimeSummary}
          checkedAt={c.effectiveAiSelection?.checkedAt ?? null}
          selectionWarning={c.effectiveAiSelection?.warning ?? c.activeProvider?.defaultSnapshot.warnings.find((warning) => warning.severity === 'blocking')?.message ?? null}
          selectionAdvisories={c.effectiveAiSelection?.advisories.map((warning) => warning.message) ?? []}
          onConfigureAi={() => {
            c.setPendingGenerationAction(null)
            runCommand('ai.configure')
          }}
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

function activateAdjacentTab(event: KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)') ?? [])
  if (tabs.length === 0) return
  const currentIndex = Math.max(0, tabs.indexOf(event.currentTarget))
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : event.key === 'ArrowLeft'
        ? (currentIndex - 1 + tabs.length) % tabs.length
        : (currentIndex + 1) % tabs.length
  event.preventDefault()
  tabs[nextIndex]?.focus()
  tabs[nextIndex]?.click()
}
