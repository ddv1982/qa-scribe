import { deriveChatHandoff } from '../app/sessionChat.presentation'
import { SessionChatView as View, type SessionChatViewProps as ViewProps } from './SessionChatView'

export type SessionChatViewProps = Omit<ViewProps, 'handoff' | 'onOpenNote'> & {
  onOpenNote?: () => void
}

export function SessionChatView(props: SessionChatViewProps) {
  return <View {...props} onOpenNote={props.onOpenNote ?? (() => {})} handoff={deriveChatHandoff({
    ...props, sessionId: props.chat?.sessionId ?? null,
    noteEntry: { id: 'note-1', sessionId: 'session-1' },
  })} />
}
