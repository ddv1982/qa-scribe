import { useEffect, useLayoutEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { SessionChatView } from '../views/SessionChatView'
import type { SessionChatViewProps } from '../views/SessionChatView'
import type { AppController } from './useAppController'
import { deriveChatHandoff, handoffDuringRecordWrites } from './sessionChat.presentation'
import '../styles/ask-ai.css'

export function AppChat({ c, modelSelectionControl, onConfigureAi }: {
  c: AppController; modelSelectionControl: SessionChatViewProps['modelSelectionControl']; onConfigureAi: () => void
}) {
  const notesVisible = Boolean(c.activeSession && c.activeView === 'sessions' && c.sessionMode === 'chat')
  const notesRef = useRef<HTMLElement>(null)
  const notesDraftId = c.sessionChat.chat?.draftId
  const notesSessionId = c.sessionChat.chat?.sessionId
  const engine = c.conversations
  useEffect(() => {
    if (notesVisible && notesDraftId && notesSessionId) void engine.select({ sessionId: notesSessionId, draftId: notesDraftId }).catch(() => undefined)
  }, [notesVisible, notesDraftId, notesSessionId, engine])
  useLayoutEffect(() => {
    if (notesVisible) notesRef.current?.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')?.focus({ preventScroll: true })
  }, [notesVisible, c.sessionChat.chat?.draftId])
  const common = {
    providerLabel: c.activeProvider?.label ?? c.selectedProvider, modelLabel: c.selectedModel === 'default' ? 'CLI Default' : c.selectedModel,
    modelSelectionPending: c.settingsWritePending, providerAvailable: Boolean(c.activeProvider?.available) && !c.effectiveAiSelection?.warning,
    providerReason: c.effectiveAiSelection?.warning ?? c.activeProvider?.reason ?? 'Loading provider status', onConfigureAi,
  }
  return <>
    <aside ref={notesRef} className="ask-ai-panel" hidden={!notesVisible} inert={!notesVisible} aria-label="Notes AI chat">
      <header className="ask-ai-header"><h2>AI chat</h2><ActionButton variant="secondary" iconOnly icon={X} aria-label="Close AI chat" onClick={() => { c.setSessionMode('write_note') }} /></header>
      <SessionChatView {...c.sessionChat} {...common} kind="notes" hidden={!notesVisible}
        modelSelectionControl={notesVisible ? modelSelectionControl : null}
        onOpenNote={() => { c.setSessionMode('write_note'); c.setActiveView('sessions') }} />
    </aside>
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
  const controls = handle ? { ...c.proposalControls, applyUnavailable: source.kind === 'available' ? undefined : 'The original source must be available before Apply.',
    onAction: (id: string, action: import('../bindings').RefinementAction) => c.proposalControls.onAction(id, action, reference!) } : undefined
  return <aside ref={ref} className="ask-ai-panel ask-ai-panel--record" hidden={!c.askAi.visible} inert={!c.askAi.visible} aria-label="Ask AI">
    <header className="ask-ai-header"><h2>Ask AI</h2>
      <ActionButton variant="secondary" iconOnly icon={X} aria-label="Close Ask AI" onClick={() => void c.askAi.close()} />
    </header>
    <section className="chat-context-card" aria-label="Chat source"><div><span className="eyebrow">{panel.owner.record.kind === 'finding' ? 'Finding' : 'Test case'}</span>
      {source.kind === 'available' ? <strong title={source.title}>{source.title}</strong>
        : <p role={source.kind === 'error' ? 'alert' : 'status'}>{source.kind === 'loading' ? 'Loading source…' : source.kind === 'error' ? source.message : `This ${panel.owner.record.kind === 'finding' ? 'finding is' : 'Test cases draft is'} no longer available.`}</p>}
      {source.kind === 'error' ? <ActionButton variant="secondary" onClick={c.askAi.retrySource}>Try again</ActionButton> : null}
    </div></section>
    {panel.phase === 'preparing' ? <p role="status">Preparing conversation…</p> : null}
    {panel.phase === 'error' ? <div><p className="chat-error" role="alert">{panel.error}</p>{panel.blockedReference ? <ActionButton variant="secondary" onClick={() => void c.askAi.openConversation(panel.blockedReference!)}>Return to retained chat</ActionButton> : null}</div> : null}
    {panel.closeError ? <p className="chat-error" role="alert">{panel.closeError}</p> : null}
    {panel.recoveryReason && c.askAi.recovery.some(item => item.reference.draftId === reference?.draftId) ? <p className="chat-recovery-reason" role="status">{panel.recoveryReason}</p> : null}
    {handle && reference ? <div className="conversation-presentation" key={reference.draftId}>
      {panel.legacyOrigin ? <BoundNotes c={c} common={common} hidden={!c.askAi.visible} modelSelectionControl={null} /> : <SessionChatView {...state} {...common} kind="record" owner={panel.owner} source={source} hidden={!c.askAi.visible}
        modelSelectionControl={null} proposalControls={controls} activeTarget={c.askAi.context}
        onSetComposer={handle.setComposer} onSend={handle.send} onRetry={handle.retry} onCancel={handle.cancel}
        onAttachImages={handle.attachImages} onPasteNativeImage={handle.pasteImage} onRemoveImage={handle.removeImage} onRetryImage={handle.retryImage} onDismissImageFailure={handle.dismissImage}
        onDecidePermission={handle.decidePermission} onRecheck={handle.recheck} />}
    </div> : null}
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
