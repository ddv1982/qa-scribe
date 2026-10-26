import { deriveChatHandoff } from '../app/sessionChat.presentation'
import { SessionChatView as View, type SessionChatViewProps as ViewProps } from './SessionChatView'

export type SessionChatViewProps = Omit<Extract<ViewProps, { kind: 'notes' }>, 'kind' | 'handoff' | 'onOpenNote'> & {
  onOpenNote?: () => void
}

export function SessionChatView(props: SessionChatViewProps) {
  return <View {...props} kind="notes" onOpenNote={props.onOpenNote ?? (() => {})} handoff={deriveChatHandoff({
    ...props, sessionId: props.chat?.sessionId ?? null,
    noteEntry: { id: 'note-1', sessionId: 'session-1' },
  })} />
}
