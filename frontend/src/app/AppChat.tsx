import { useEffect, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { SessionChatView } from '../views/SessionChatView'
import { StartNewConversation } from '../views/StartNewConversation'
import { noteReadOnlyReason, useNoteProposalControls } from './useNoteProposalControls'
import type { SessionChatViewProps } from '../views/SessionChatView'
import type { AppController } from './useAppController'
import { deriveChatHandoff, handoffDuringRecordWrites, recoveredSummaryChoiceReason } from './sessionChat.presentation'
import '../styles/ask-ai.css'

export function AppChat({ c, modelSelectionControl, onConfigureAi }: {
  c: AppController; modelSelectionControl: SessionChatViewProps['modelSelectionControl']; onConfigureAi: () => void
}) {
  const notesVisible = Boolean(c.activeSession && c.activeView === 'sessions' && c.sessionMode === 'chat')
  const notesAddedToNote = c.sessionChat.handoff.kind === 'added'
  const notesRef = useRef<HTMLElement>(null)
  const restoreNotesFocus = useRef(false)
  const notesDraftId = c.sessionChat.chat?.draftId
  const notesSessionId = c.sessionChat.chat?.sessionId
  const engine = c.conversations
  const notesMessages = c.sessionChat.chat?.messages ?? []
  const noteControls = useNoteProposalControls({ chat: c.sessionChat.chat, onRefresh: c.sessionChat.onRefresh, noteBody: c.noteBody, setNoteBody: c.setNoteBody,
    saveNote: c.saveAllPendingChanges, blockedReason: c.noteReadOnly ? noteReadOnlyReason : c.pendingRecoveredSummaryDecision ? recoveredSummaryChoiceReason : undefined, recordControls: c.sessionChat.proposalControls })
  useEffect(() => {
    if (notesVisible && notesDraftId && notesSessionId) void engine.select({ sessionId: notesSessionId, draftId: notesDraftId }).catch(() => undefined)
  }, [notesVisible, notesDraftId, notesSessionId, engine])
  useLayoutEffect(() => {
    if (notesVisible) notesRef.current?.querySelector<HTMLElement>('textarea:not(:disabled), .chat-completion button:not(:disabled)')?.focus({ preventScroll: true })
    else if (restoreNotesFocus.current) {
      restoreNotesFocus.current = false
      document.querySelector<HTMLButtonElement>('.session-workspace .ask-ai-trigger')?.focus()
    }
  }, [notesVisible, c.sessionChat.chat?.draftId, notesAddedToNote])
  const common = {
    providerLabel: c.activeProvider?.label ?? c.selectedProvider, modelLabel: c.selectedModel === 'default' ? 'CLI Default' : c.selectedModel,
    modelSelectionPending: c.settingsWritePending, providerAvailable: Boolean(c.activeProvider?.available) && !c.effectiveAiSelection?.warning,
    providerReason: c.effectiveAiSelection?.warning ?? c.activeProvider?.reason ?? 'Loading provider status', onConfigureAi,
  }
  return <>
    <AskAiPanel panelRef={notesRef} id="notes-ask-ai" kind="notes" visible={notesVisible} label="Notes AI chat" eyebrow="Session note"
      actions={<ConversationOptions>
          {notesVisible ? modelSelectionControl : null}
          <div className="chat-buttons"><ActionButton variant="secondary" type="button" onClick={onConfigureAi}>Configure AI</ActionButton>
            {notesAddedToNote ? null : <StartNewConversation state={c.sessionChat} />}</div>
          <p className="chat-counts">{notesMessages.length} / 128 messages · {(notesMessages.reduce((total, message) => total + new TextEncoder().encode(message.text).length, 0) / 1024).toFixed(1)} / 128 KiB transcript</p>
      </ConversationOptions>}
      source={<strong>{c.sessionTitle}</strong>} onClose={() => {
        restoreNotesFocus.current = true
        c.setSessionMode('write_note')
      }}>
      <SessionChatView {...c.sessionChat} {...common} kind="notes" hidden={!notesVisible} proposalControls={noteControls}
        onOpenNote={() => { restoreNotesFocus.current = true; c.setSessionMode('write_note'); c.setActiveView('sessions') }} />
    </AskAiPanel>
    {c.askAi.panel ? <RecordConversation key={c.activeSession?.id} c={c} common={common} /> : null}
  </>
}

function RecordConversation({ c, common }: {
  c: AppController; common: Pick<SessionChatViewProps, 'providerLabel' | 'modelLabel' | 'modelSelectionPending' | 'providerAvailable' | 'providerReason' | 'onConfigureAi'>
}) {
  const ref = useRef<HTMLElement>(null)
  const panel = c.askAi.panel!
  const reference = c.askAi.reference
  const handle = reference ? c.conversations.bind(reference) : null
  const state = c.recordChat
  useLayoutEffect(() => {
    if (!c.askAi.visible || !reference) return
    const input = ref.current?.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')
    input?.focus({ preventScroll: true })
  }, [c.askAi.visible, c.askAi.focusRequest, state.chat?.draftId, reference])
  const source = c.askAi.source!
  const owner = panel.owner
  // A test run is only read: its conversation offers no change to apply.
  const controls = handle && owner.kind === 'record' ? { ...c.proposalControls, applyUnavailable: source.kind === 'available' ? undefined : 'The original source must be available before Update.',
    onUpdate: (id: string) => c.proposalControls.onUpdate?.(id, reference!) ?? Promise.resolve(),
    onAction: (id: string, action: import('../bindings').RefinementAction) => c.proposalControls.onAction(id, action, reference!) } : undefined
  const noun = owner.kind === 'test_run' ? { eyebrow: 'Test run', missing: 'test run is' }
    : owner.record.kind === 'finding' ? { eyebrow: 'Finding', missing: 'finding is' } : { eyebrow: 'Test case', missing: 'Test cases draft is' }
  return <AskAiPanel panelRef={ref} kind="record" visible={c.askAi.visible} label="Ask AI" eyebrow={noun.eyebrow}
    onClose={() => void c.askAi.close()} source={<>
      {source.kind === 'available' ? <strong title={source.title}>{source.title}</strong>
        : <p role={source.kind === 'error' ? 'alert' : 'status'}>{source.kind === 'loading' ? 'Loading source…' : source.kind === 'error' ? source.message : `This ${noun.missing} no longer available.`}</p>}
      {source.kind === 'error' ? <ActionButton variant="secondary" onClick={c.askAi.retrySource}>Try again</ActionButton> : null}
    </>}>
    {panel.phase === 'preparing' ? <p role="status">Preparing conversation…</p> : null}
    {panel.phase === 'error' ? <div><p className="chat-error" role="alert">{panel.error}</p>{panel.blockedReference ? <ActionButton variant="secondary" onClick={() => void c.askAi.openConversation(panel.blockedReference!)}>Return to retained chat</ActionButton> : null}</div> : null}
    {panel.closeError ? <p className="chat-error" role="alert">{panel.closeError}</p> : null}
    {panel.recoveryReason && c.askAi.recovery.some(item => item.reference.draftId === reference?.draftId) ? <p className="chat-recovery-reason" role="status">{panel.recoveryReason}</p> : null}
    {handle && reference ? <div className="conversation-presentation" key={reference.draftId}>
      {panel.legacyOrigin ? <BoundNotes c={c} common={common} hidden={!c.askAi.visible} modelSelectionControl={null} /> : <SessionChatView {...state} {...common} kind="record" owner={owner} source={source} hidden={!c.askAi.visible}
        modelSelectionControl={null} proposalControls={controls} activeTarget={c.askAi.context}
        onSetComposer={handle.setComposer} onSend={handle.send} onRetry={handle.retry} onCancel={handle.cancel}
        onAttachImages={handle.attachImages} onPasteNativeImage={handle.pasteImage} onRemoveImage={handle.removeImage} onRetryImage={handle.retryImage} onDismissImageFailure={handle.dismissImage}
        onDecidePermission={handle.decidePermission} onRecheck={handle.recheck} />}
    </div> : null}
  </AskAiPanel>
}

/** The one Ask AI shell (R6): header, source line, then the conversation. Notes and records differ only in their body. */
function AskAiPanel({ panelRef, id, kind, visible, label, eyebrow, source, actions, onClose, children }: {
  panelRef: Ref<HTMLElement>; id?: string; kind: 'notes' | 'record'; visible: boolean; label: string
  eyebrow: string; source: ReactNode; actions?: ReactNode; onClose: () => void; children: ReactNode
}) {
  return <aside ref={panelRef} id={id} className={`ask-ai-panel ask-ai-panel--${kind}`} hidden={!visible} inert={!visible} aria-label={label}>
    <header className="ask-ai-header"><h2>Ask AI</h2><div className="ask-ai-header-actions">{actions}<ActionButton variant="secondary" iconOnly icon={X} aria-label="Close Ask AI" onClick={onClose} /></div></header>
    <section className="chat-context-card" aria-label="Chat source"><div><span className="eyebrow">{eyebrow}</span>{source}</div></section>
    {children}
  </aside>
}

function BoundNotes({ c, common, hidden, modelSelectionControl }: {
  c: AppController; common: Pick<SessionChatViewProps, 'providerLabel' | 'modelLabel' | 'modelSelectionPending' | 'providerAvailable' | 'providerReason' | 'onConfigureAi'>
  hidden: boolean; modelSelectionControl: SessionChatViewProps['modelSelectionControl']
}) {
  const handle = c.conversations.bind(c.askAi.reference!)
  const state = c.recordChat
  return <SessionChatView {...state} {...common} kind="notes" recoveryPending={c.noteReadOnly} legacySource={c.askAi.panel?.legacyOrigin ? c.askAi.source ?? undefined : undefined} hidden={hidden} modelSelectionControl={modelSelectionControl}
    handoff={handoffDuringRecordWrites(deriveChatHandoff({ ...state, sessionId: state.chat?.sessionId ?? null, noteEntry: c.noteEntry, recoveryPending: c.noteReadOnly }), Boolean(c.sessionChat.recordWritesPending))}
    activeTarget={c.askAi.context} proposalControls={{ ...c.proposalControls, applyUnavailable: c.askAi.panel?.legacyOrigin && c.askAi.source?.kind !== 'available' ? 'The original source must be available before Apply or Undo.' : undefined, onAction: (id, action) => c.proposalControls.onAction(id, action, handle.reference) }}
    onSetComposer={handle.setComposer} onSend={handle.send} onRetry={handle.retry} onCancel={handle.cancel} onSubmit={handle.submit} onRestart={handle.restart} captureRestart={handle.captureRestart}
    onOpenNote={() => { c.setSessionMode('write_note'); c.setActiveView('sessions') }} onAttachImages={handle.attachImages} onPasteNativeImage={handle.pasteImage}
    onRemoveImage={handle.removeImage} onRetryImage={handle.retryImage} onDismissImageFailure={handle.dismissImage} onAnswerQuestion={handle.answer}
    onPrepareAction={handle.prepareAction} onDecidePermission={handle.decidePermission} onRecheck={handle.recheck} />
}

/** One header icon for model choice, AI setup and restart. It closes on Escape or a press outside, so it never covers the conversation. */
function ConversationOptions({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: Event) => {
      const options = ref.current
      if (!options?.open) return
      // A modal opened from the options (restart confirmation) owns Escape and focus until it closes.
      if (document.querySelector('dialog[open]')) return
      // The model menu renders its choices into document.body; they still belong to these options.
      const inside = event.target instanceof Element && (options.contains(event.target) || Boolean(event.target.closest('.model-combobox-popover')))
      // Captured before the combobox handles it: an open model menu closes first.
      const menuOpen = event.target instanceof Element && Boolean(event.target.closest('[role="combobox"][aria-expanded="true"]'))
      if (event instanceof KeyboardEvent ? event.key === 'Escape' && !menuOpen : !inside) {
        options.open = false
        if (event instanceof KeyboardEvent) options.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', close, true)
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', close, true) }
  }, [])
  return <details ref={ref} className="chat-options">
    <summary aria-label="Conversation options" title="Conversation options"><SlidersHorizontal size={16} aria-hidden="true" /></summary>
    <div className="chat-options-content">{children}</div>
  </details>
}
