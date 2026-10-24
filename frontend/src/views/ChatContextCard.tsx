import { X } from 'lucide-react'
import type { ChatContextPresentation } from '../app/sessionChat.context'
import type { ChatTarget } from '../bindings'
import { ActionButton } from '../components/ActionButton'

export function ChatContextLabel({ context }: { context: ChatTarget }) {
  if (context.kind === 'session') return <p className="chat-context-label">Session context</p>
  return <p className="chat-context-label">
    {context.kind === 'finding' ? 'Finding' : 'Test cases'} · {context.snapshot.title} · {context.snapshot.origin === 'unsaved_editor' ? 'Unsaved editor snapshot' : 'Saved snapshot'}
  </p>
}

export function ChatContextCard({ context, error, onDetach }: { context: ChatContextPresentation; error: string | null; onDetach: () => void }) {
  return <section className="chat-context-card" aria-label="Chat context">
    <div>
      <span className="eyebrow">{context.kind === 'session' ? 'Session context' : context.kind === 'finding' ? 'Finding context' : 'Test cases context'}</span>
      {error ? <p role="alert">{error}</p> : context.kind === 'session'
        ? <p>Session conversation. No record attached to the next message.</p>
        : <>
          <strong title={context.title}>{context.title}</strong>
          <span className="chat-context-state">{context.unsaved ? 'Unsaved editor snapshot' : 'Saved snapshot'}</span>
          <p>{context.unsaved ? 'Unsaved edits included. Sending does not save this record.' : 'Saved record. Snapshot captured when you send.'}</p>
        </>}
    </div>
    {context.kind !== 'session' || error ? <ActionButton variant="secondary" iconOnly icon={X} aria-label="Detach record context" title="Detach for future messages" onClick={onDetach} /> : null}
  </section>
}
