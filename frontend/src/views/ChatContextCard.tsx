import type { ChatTarget } from '../bindings'

export function ChatContextLabel({ context }: { context: ChatTarget }) {
  if (context.kind === 'session') return <p className="chat-context-label">Session context</p>
  return <p className="chat-context-label">
    {context.kind === 'finding' ? 'Finding' : 'Test cases'} · {context.snapshot.title} · {context.snapshot.origin === 'unsaved_editor' ? 'Unsaved editor snapshot' : 'Saved snapshot'}
  </p>
}
