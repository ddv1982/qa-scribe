import { ActionButton } from '../components/ActionButton'
import { CreationWorkspace } from '../views/CreationTools'
import { CreationNotePanel } from '../views/CreationNotePanel'
import { referenceLabel, useCreationReference } from './creationReference'
import { useCreationNoteVisible } from '../hooks/useCreationNoteVisible'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { catalogSelectorEnabled } from '../settings/catalog'
import { customModelCatalogAdvisory } from '../settings/modelAdvisories'
import { NextModelSelection } from '../components/NextModelSelection'
import { FindingsView } from '../views/FindingsView'
import { SessionEditorView } from '../views/SessionEditorView'
import { SessionSheetDialog } from '../views/SessionSheetDialog'
import { AppChat } from './AppChat'
import { ChatAddedToNote } from '../views/ChatHandoff'
import type { SessionChatViewState } from './useSessionChat'
import { SettingsView } from '../views/SettingsView'
import { TestwareView } from '../views/TestwareView'
import { OutputLibraryView } from '../views/OutputLibraryView'
import { GenerationPreflight } from '../workflows/generationPreflight'
import type { AppController } from './useAppController'
import type { AskAiOwner } from './conversationPresentation'
import { createCommandRegistry, type AppCommandId } from './commandRegistry'
import { CommandPalette, DeleteConfirmationDialog, PendingChangesDialog } from './AppOverlays'
import { primaryModifierPressed } from './platformShortcuts'
import { createSearchTargets } from './searchTargets'
import { listSessions, type Session } from '../tauri'
import { AppRail } from './AppRail'
import { FirstUseDialog } from '../onboarding/FirstUseDialog'
import { AttachmentCleanupWarning } from './AttachmentCleanupWarning'

export { DeleteConfirmationDialog } from './AppOverlays'

export function AppShell(c: AppController) {
  const chatState: SessionChatViewState = c.sessionChat
  const customModelAdvisory = customModelCatalogAdvisory(c.activeProvider?.models ?? [], c.selectedModel,
    catalogSelectorEnabled(c.activeProvider, c.providerStatus?.catalogRollout ?? null)
      && ['fresh', 'stale'].includes(c.activeProvider?.catalogSnapshot.state ?? ''))
  const modelSelectionProps = { provider: c.activeProvider, value: c.selectedModel,
    pending: c.settingsWritePending, disabled: !c.modelSelectionReady || !c.activeProvider,
    catalogEnabled: catalogSelectorEnabled(c.activeProvider, c.providerStatus?.catalogRollout ?? null),
    onChange: (model: string) => { void c.persistModelChoice(c.selectedProvider, model) } }
  const modelSelectionControl = <NextModelSelection {...modelSelectionProps} />
  const [overlay, setOverlay] = useState<'commands' | 'help' | 'example' | 'session-sheet' | null>(null)
  const [noteActionsTarget, setNoteActionsTarget] = useState<HTMLDivElement | null>(null)
  const commands = createCommandRegistry(c, () => setOverlay('help'), () => setOverlay('session-sheet'))
  const commandById = (id: AppCommandId) => commands.find((command) => command.id === id)
  const runCommand = (id: AppCommandId) => commandById(id)?.run()
  const creationCommands = (kind: 'testware' | 'finding') => ({
    create: commands.find((command) => command.id === `${kind}.new`)!,
  })
  const creationResultReady = c.creationIntent?.phase.state === 'saved'
    && c.creationIntent.phase.selection === 'ready'
  // The draft on screen, if any: its Note shows beside it in place of the record list and Ask AI.
  const shownDraft = c.creationIntent && !creationResultReady
    && c.activeView === (c.creationIntent.kind === 'finding' ? 'findings' : 'testware') ? c.creationIntent : null
  const contentRef = useRef<HTMLDivElement>(null)
  const [noteVisible, toggleNote] = useCreationNoteVisible(shownDraft?.id ?? null, contentRef)
  const [reference, setReference] = useCreationReference(shownDraft?.id ?? null)
  const referenceRecords = { testware: c.testwareDrafts, finding: c.findings }
  const askAiVisible = c.askAi.visible && !shownDraft
  const composer = c.creationIntent && !creationResultReady ? <CreationWorkspace c={c}
    showPanel={noteVisible ? undefined : { label: referenceLabel(reference, referenceRecords), onShow: toggleNote }} /> : null

  // The panel lists both kinds of saved record, and each kind loads with its own tab, so load the other one here.
  const { loadDraftsForSession, loadFindingsForSession } = c
  const referenceSessionId = shownDraft && noteVisible ? shownDraft.sessionId : null
  useEffect(() => {
    if (!referenceSessionId) return
    void loadDraftsForSession(referenceSessionId).catch(() => undefined)
    void loadFindingsForSession(referenceSessionId).catch(() => undefined)
  }, [referenceSessionId, loadDraftsForSession, loadFindingsForSession])

  const { loadDraftLibrary, loadFindingLibrary, sessionLibraryComplete } = c
  // Startup loads only recent Sessions; the palette searches every Session without changing the sidebar.
  const [paletteSessions, setPaletteSessions] = useState<Session[] | null>(null)
  useEffect(() => {
    // Ctrl+K also searches saved test cases and findings, so read them fresh each time it opens.
    if (overlay !== 'commands') return
    void loadDraftLibrary()
    void loadFindingLibrary()
    if (sessionLibraryComplete) return
    let current = true
    listSessions().then((sessions) => { if (current) setPaletteSessions(sessions) }, () => undefined)
    return () => { current = false }
  }, [overlay, loadDraftLibrary, loadFindingLibrary, sessionLibraryComplete])

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (overlay || document.querySelector('dialog[open]')) return
      if (!primaryModifierPressed(event)) return
      if (event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setOverlay('commands')
        return
      }
      const matched = commands.find((command) => command.available && command.shortcut?.key === event.key.toLocaleLowerCase())
      if (!matched?.available) return
      event.preventDefault()
      matched.run()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [commands, overlay])

  return (
    <main className="app-shell" onPaste={overlay ? undefined : c.handlePaste}>
      <AppRail c={c} commandById={commandById} onOpenCommands={() => setOverlay('commands')} />

      <section className="center-workspace" aria-label="Workspace">
        <AttachmentCleanupWarning cleanup={c.attachmentCleanup} />
        {c.activeSession && ['sessions', 'testware', 'findings'].includes(c.activeView) ? (
          <header className="session-context-header">
            <nav className="session-workspace-tabs" role="tablist" aria-label={`${c.activeSession.title} workspace`}>
              <button type="button" role="tab" className={c.activeView === 'sessions' ? 'active' : ''} aria-selected={c.activeView === 'sessions'} onClick={() => runCommand('view.note')} onKeyDown={activateAdjacentTab}>
                Note
              </button>
              <button type="button" role="tab" className={c.activeView === 'testware' ? 'active' : ''} aria-selected={c.activeView === 'testware'} onClick={() => runCommand('view.testware')} onKeyDown={activateAdjacentTab}>
                Test cases <span>{c.testwareDraftCount}</span>
              </button>
              <button type="button" role="tab" className={c.activeView === 'findings' ? 'active' : ''} aria-selected={c.activeView === 'findings'} onClick={() => runCommand('view.findings')} onKeyDown={activateAdjacentTab}>
                Findings <span>{c.findingCount}</span>
              </button>
            </nav>
            {c.activeView === 'sessions' ? <div className="session-header-actions" ref={setNoteActionsTarget} /> : null}
        {/* Ask AI is not offered beside a new draft, so neither is its recovery. */}
        {shownDraft ? null : c.askAi.recovery.filter(item => !askAiVisible || item.reference.draftId !== c.askAi.reference?.draftId || Boolean(item.origin && item.origin.stageId !== c.askAi.panel?.legacyOrigin?.stageId)).map(item =>
          <div className="chat-recovery-notice" key={item.origin?.stageId ?? item.reference.draftId}>
            <span>{item.reason}</span>
            <ActionButton variant="secondary" size="compact" data-recovery-draft={item.reference.draftId} onClick={() => void c.askAi.recover(item)}>Recover Ask AI · {recoveryTitle(c, item.owner)}</ActionButton>
          </div>)}
        {c.askAi.recoveryError ? <p className="chat-error" role="alert">{c.askAi.recoveryError}</p> : null}
          </header>
        ) : null}
        <div ref={contentRef} className={`session-content${askAiVisible || (shownDraft && noteVisible) ? ' session-content--side-panel' : ''}${c.activeView === 'sessions' && c.sessionMode === 'chat' ? ' session-content--notes-chat' : ''}`}>
        <div className="session-document-area">
        {c.activeView === 'sessions' ? (
          <SessionEditorView
            creationCommands={{ testware: creationCommands('testware'), finding: creationCommands('finding') }}
            headerActionsTarget={noteActionsTarget}
            noteReadOnly={c.noteReadOnly}
            onRecoverNote={c.sessionChat.onSubmit}
            sessionMode={c.sessionMode}
            onSetSessionMode={c.setSessionMode}
            noteHandoffContent={<ChatAddedToNote state={chatState} />}
            activeProviderReason={c.activeProvider?.reason ?? 'Loading provider status'}
            activeProviderAvailable={Boolean(c.activeProvider?.available)}
            activeSession={c.activeSession}
            busyAction={c.busyAction}
            canUndoLatestGeneration={Boolean(c.latestNoteGenerationUndo && c.noteEntry?.id === c.latestNoteGenerationUndo.entryId)}
            copyState={c.copyState}
            filteredSessions={c.filteredSessions}
            isBusy={c.isBusy}
            noteBody={c.noteBody}
            noteBodyHtml={c.noteBodyHtml}
            noteIsReady={c.noteIsReady && !c.noteReadOnly}
            sessionTitle={c.sessionTitle}
            sessionTitleValidationError={c.sessionTitleValidationError}
            sessionSaveState={c.sessionSaveState}
            noteScreenshotCount={c.noteScreenshotCount}
            noteWordCount={c.noteWordCount}
            notice={c.notice}
            error={c.error}
            pendingAiActions={c.pendingAiActions}
            onUndoLatestGeneration={c.handleUndoLatestNoteGeneration}
            onAiAction={c.openGenerationPreflight}
            onCopy={c.copy}
            onCreateSession={() => runCommand('session.new')}
            hasSavedSessions={c.sessions.length > 0}
            onExploreExample={() => setOverlay('example')}
            canCreateSession={Boolean(commandById('session.new')?.available)}
            onDeleteSession={c.requestDeleteSession}
            onOpenSessionSheet={() => runCommand('session.sheet')}
            onOpenSession={c.openSession}
            onSetNoteBody={c.setNoteBody}
            onSetSessionTitle={c.setSessionTitle}
            onUploadImage={(input) => {
              if (!c.noteEntry) {
                c.setError('Open a Session with an editable Note Entry before uploading images.')
                return
              }
              return c.uploadEditorImage(input, { kind: 'note', id: c.noteEntry.id })
            }}
          />
        ) : null}

        {c.activeView === 'testware' ? (
          <TestwareView recordChat={c.askAi} sessionId={c.activeSession?.id ?? null} acceptanceCriteria={c.activeSession?.acceptanceCriteria ?? null}
            onCreateFinding={(testCase) => void c.handleFindingFromTestCase(testCase)} onOpenFinding={(findingId) => void c.openSessionFinding(findingId)}
            composer={c.creationIntent?.kind === 'testware' ? composer : null}
            creationCommands={creationCommands('testware')}
            key={c.activeSession?.id ?? 'no-session'}
            busyAction={c.busyAction}
            copyState={c.copyState}
            draftScreenshotCounts={c.draftScreenshotCounts}
            drafts={c.testwareDrafts}
            notice={c.notice}
            error={c.error}
            isBusy={c.isBusy}
            activeGenerationJob={c.activeTestwareJob}
            initialSelectedRecordId={c.selectedRecordIds.testware}
            onSelectedRecordChange={c.selectRecord.testware}
            createdRecordEditTarget={c.createdRecordEditTarget?.sessionId === c.activeSession?.id && c.createdRecordEditTarget?.kind === 'testware' ? c.createdRecordEditTarget : null}
            onCreatedRecordEditTargetConsumed={c.consumeCreatedRecordEditTarget}
            loadState={c.draftLoadState}
            loadError={c.draftLoadError}
            onRetryLoad={() => {
              if (c.activeSession) void c.loadDraftsForSession(c.activeSession.id, { force: true }).catch(() => undefined)
            }}
            onCancelGenerationJob={c.handleCancelGenerationJob}
            onCopy={c.copy}
            onDeleteDraft={c.requestDeleteDraft}
            onSaveDraft={c.handleSaveDraft}
            onDiscardDraft={c.discardLocalDraft}
            onUploadImage={(input, recordId) => c.uploadEditorImage(input, { kind: 'draft', id: recordId })}
            updateLocalDraft={c.updateLocalDraft}
          />
        ) : null}

        {c.activeView === 'findings' ? (
          <FindingsView recordChat={c.askAi}
            composer={c.creationIntent?.kind === 'finding' ? composer : null}
            creationCommands={creationCommands('finding')}
            key={c.activeSession?.id ?? 'no-session'}
            busyAction={c.busyAction}
            copyState={c.copyState}
            findingScreenshotCounts={c.findingScreenshotCounts}
            findings={c.findings}
            notice={c.notice}
            error={c.error}
            isBusy={c.isBusy}
            activeGenerationJob={c.activeFindingJob}
            initialSelectedRecordId={c.selectedRecordIds.findings}
            onSelectedRecordChange={c.selectRecord.findings}
            createdRecordEditTarget={c.createdRecordEditTarget?.sessionId === c.activeSession?.id && c.createdRecordEditTarget?.kind === 'finding' ? c.createdRecordEditTarget : null}
            onCreatedRecordEditTargetConsumed={c.consumeCreatedRecordEditTarget}
            loadState={c.findingLoadState}
            loadError={c.findingLoadError}
            onRetryLoad={() => {
              if (c.activeSession) void c.loadFindingsForSession(c.activeSession.id, { force: true }).catch(() => undefined)
            }}
            onCancelGenerationJob={c.handleCancelGenerationJob}
            onCopy={c.copy}
            onDeleteFinding={c.requestDeleteFinding}
            onSaveFinding={c.handleSaveFinding}
            onDiscardFinding={c.discardLocalFinding}
            onUploadImage={(input, recordId) => c.uploadEditorImage(input, { kind: 'finding', id: recordId })}
            updateLocalFinding={c.updateLocalFinding}
          />
        ) : null}

        {c.activeView === 'testware-library' || c.activeView === 'findings-library' ? (() => {
          const kind = c.activeView === 'testware-library' ? 'testware' : 'findings'
          return (
            <OutputLibraryView
              key={kind}
              kind={kind}
              onSelectKind={(next) => runCommand(next === 'testware' ? 'library.testware' : 'library.findings')}
              draftItems={c.draftLibrary}
              findingItems={c.findingLibrary}
              loadState={kind === 'testware' ? c.draftLibraryState : c.findingLibraryState}
              loadError={kind === 'testware' ? c.draftLibraryError : c.findingLibraryError}
              onRetry={() => void (kind === 'testware' ? c.loadDraftLibrary() : c.loadFindingLibrary())}
              onOpenRecord={(sessionId, recordId) => void c.openLibraryRecord(sessionId, kind, recordId)}
              onCopy={c.copy} copyState={c.copyState} isBusy={c.isBusy}
            />
          )
        })() : null}

        {c.activeView === 'settings' ? (
          <SettingsView
            busyAction={c.busyAction}
            providerStatus={c.providerStatus}
            providerDiscoveryState={c.providerDiscoveryState}
            settingsDraft={c.settingsDraft}
            settingsDirty={c.settingsDirty}
            settingsSaveState={c.settingsSaveState}
            settingsSaveError={c.settingsSaveError}
            settingsWritePending={c.settingsWritePending}
            theme={c.theme}
            updateSettingsDraft={c.updateSettingsDraft}
            setTheme={c.setTheme}
            onSaveSettings={c.handleSaveSettings}
            onDiscardSettings={c.discardSettingsDraft}
            onRefreshProviderStatus={c.handleRefreshProviderStatus}
            onBack={c.closeSettings}
          />
        ) : null}
        </div>
        {shownDraft && noteVisible ? <CreationNotePanel intent={shownDraft} records={referenceRecords} reference={reference} onReferenceChange={setReference} noteReadOnly={c.noteReadOnly} onReadNote={() => void c.creation.reviewSource()} onClose={toggleNote} /> : null}
        <AppChat c={c} recordVisible={askAiVisible} modelSelectionControl={modelSelectionControl} onConfigureAi={() => runCommand('ai.configure')} />
        </div>
      </section>

      {c.deleteConfirmation && c.deleteCopy ? (
        <DeleteConfirmationDialog
          copy={c.deleteCopy}
          isBusy={c.isBusy}
          onCancel={() => c.setDeleteConfirmation(null)}
          onConfirm={() => void c.confirmDelete()}
        />
      ) : null}

      {c.creationDecision ? <PendingChangesDialog creationDraft errorMessage={c.error} generationPending={c.creationIntent?.phase.state === 'generating' || c.creationIntent?.phase.state === 'cancelling'} onCancelGeneration={() => void c.creation.cancelGeneration()} isBusy={c.creationIntent?.phase.state === 'saving' || c.creationIntent?.phase.state === 'discarding' || c.creationIntent?.phase.state === 'cancelling'} onCancel={() => void c.creation.decide('keep')} onDiscard={() => void c.creation.decide('discard')} onSave={() => void c.creation.decide('save')} /> : null}
      {c.pendingNavigationView ? (
        <PendingChangesDialog
          recoveredSummaryConflict={c.pendingRecoveredSummaryDecision}
          isBusy={c.isBusy}
          onCancel={c.cancelPendingNavigation}
          onDiscard={() => void c.discardPendingNavigationChanges()}
          onSave={() => void c.savePendingNavigationChanges()}
        />
      ) : null}

      {overlay === 'commands' ? (
        <CommandPalette commands={commands} onClose={() => setOverlay(null)}
          targets={createSearchTargets({ sessions: !c.sessionLibraryComplete && paletteSessions ? paletteSessions : c.sessions, draftLibrary: c.draftLibrary, findingLibrary: c.findingLibrary,
            openSession: (session) => void c.openSessionInCurrentView(session),
            openRecord: (sessionId, view, recordId) => void c.openLibraryRecord(sessionId, view, recordId) })} />
      ) : null}

      {overlay === 'session-sheet' && c.activeSession ? (() => {
        const sessionId = c.activeSession.id
        return <SessionSheetDialog key={sessionId} session={c.activeSession} onCancel={() => setOverlay(null)}
          onSave={async (patch) => {
            await c.saveSessionSheet(sessionId, patch)
            setOverlay(null)
          }} />
      })() : null}

      {overlay === 'help' || overlay === 'example' ? (
        <FirstUseDialog key={overlay} kind={overlay} onClose={() => setOverlay(null)}
          onExploreExample={() => setOverlay('example')}
          canCreateSession={Boolean(commandById('session.new')?.available)}
          onStartSession={() => {
            const command = commandById('session.new')
            if (!command?.available) return
            setOverlay(null)
            command.run()
          }} />
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
          modelSelectionControl={modelSelectionControl}
          modelSelectionPending={c.settingsWritePending}
          selectionAdvisories={[...(c.effectiveAiSelection?.advisories.map((warning) => warning.message) ?? []),
            ...(customModelAdvisory ? [customModelAdvisory] : [])]}
          onConfigureAi={() => {
            c.setPendingGenerationAction(null)
            runCommand('ai.configure')
          }}
          onCancel={() => c.setPendingGenerationAction(null)}
          onConfirm={(testwarePreferences) => {
            const action = c.pendingGenerationAction
            if (!action || c.settingsWritePending) return
            c.setPendingGenerationAction(null)
            void c.handleAiAction(action, testwarePreferences, {
              selectedProvider: c.selectedProvider, selectedModel: c.selectedModel,
              selectedReasoningEffort: c.selectedReasoningEffort,
            })
          }}
        />
      ) : null}
    </main>
  )
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

/** Names an unfinished conversation in the recovery list by its source; a run is recovered there only once deleted. */
function recoveryTitle(c: AppController, owner: AskAiOwner) {
  if (owner.kind === 'test_run') return 'Deleted test run'
  const { kind, recordId } = owner.record
  return (kind === 'finding' ? c.findings : c.testwareDrafts).find(row => row.id === recordId)?.title ?? 'Unavailable source'
}
