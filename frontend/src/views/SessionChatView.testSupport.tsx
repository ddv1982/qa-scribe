import { StartNewConversation } from './StartNewConversation'
import { deriveChatHandoff } from '../app/sessionChat.presentation'
import { SessionChatView as View, type SessionChatViewProps as ViewProps } from './SessionChatView'

export type SessionChatViewProps = Omit<Extract<ViewProps, { kind: 'notes' }>, 'kind' | 'handoff' | 'onOpenNote'> & {
  onOpenNote?: () => void
}

/** Mirrors AppChat: the Notes panel's Conversation options carry Start new conversation unless the handoff already offers it. */
export function SessionChatView(props: SessionChatViewProps) {
  const handoff = deriveChatHandoff({
    ...props, sessionId: props.chat?.sessionId ?? null,
    noteEntry: { id: 'note-1', sessionId: 'session-1' },
  })
  return <>
    {handoff.kind === 'added' ? null : <StartNewConversation state={props} />}
    <View {...props} kind="notes" onOpenNote={props.onOpenNote ?? (() => {})} handoff={handoff} />
  </>
}
