import { useLayoutEffect, useRef } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { ChatContextCard } from '../views/ChatContextCard'
import { SessionChatView } from '../views/SessionChatView'
import type { SessionChatViewProps } from '../views/SessionChatView'
import type { AppController } from './useAppController'
import '../styles/ask-ai.css'

export function AppChat({ c, modelSelectionControl, onConfigureAi }: {
  c: AppController
  modelSelectionControl: SessionChatViewProps['modelSelectionControl']
  onConfigureAi: () => void
}) {
  const ref = useRef<HTMLElement>(null)
  const notesChat = c.activeView === 'sessions' && c.sessionMode === 'chat'
  const visible = Boolean(c.activeSession && (notesChat || c.askAi.visible))
  const ready = Boolean(c.sessionChat.chat)
  useLayoutEffect(() => {
    if (visible) ref.current?.querySelector<HTMLTextAreaElement>('textarea:not(:disabled)')?.focus({ preventScroll: true })
  }, [visible, c.askAi.focusRequest, ready])
  return <aside ref={ref} className="ask-ai-panel" hidden={!visible} aria-label="AI chat">
    <header className="ask-ai-header">
      <div><h2>AI chat</h2><p>The shared Session conversation</p></div>
      <div className="ask-ai-controls">
        {!notesChat ? <ActionButton variant="secondary" iconOnly icon={c.askAi.expanded ? Minimize2 : Maximize2}
          aria-label={c.askAi.expanded ? 'Collapse AI chat' : 'Expand AI chat'} onClick={c.askAi.toggleExpanded} /> : null}
        <ActionButton variant="secondary" iconOnly icon={X} aria-label="Close AI chat" onClick={() => {
          if (notesChat) c.setSessionMode('write_note')
          else { c.askAi.close(); document.querySelector<HTMLButtonElement>('.record-detail-pane button.ask-ai-trigger')?.focus() }
        }} />
      </div>
    </header>
    <ChatContextCard context={c.askAi.context} error={c.askAi.contextError} onDetach={c.askAi.detach} />
    <SessionChatView {...c.sessionChat} onRefine={c.askAi.context.kind === 'session' ? undefined : c.sessionChat.onRefine} hidden={!visible}
      onOpenNote={() => { c.setSessionMode('write_note'); c.setActiveView('sessions') }}
      providerLabel={c.activeProvider?.label ?? c.selectedProvider}
      modelLabel={c.selectedModel === 'default' ? 'CLI Default' : c.selectedModel}
      modelSelectionControl={modelSelectionControl} modelSelectionPending={c.settingsWritePending}
      providerAvailable={Boolean(c.activeProvider?.available) && !c.effectiveAiSelection?.warning}
      providerReason={c.effectiveAiSelection?.warning ?? c.activeProvider?.reason ?? 'Loading provider status'}
      onConfigureAi={onConfigureAi} />
  </aside>
}
