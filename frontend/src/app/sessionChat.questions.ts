import type { ChatMessage, ChatTarget } from '../bindings'
import type { ChatContextPresentation } from './sessionChat.context'

export function sameChatTarget(a: ChatTarget, b: ChatTarget | ChatContextPresentation): boolean {
  return a.kind === b.kind && (a.kind === 'session' || (b.kind !== 'session'
    && a.snapshot.recordId === ('snapshot' in b ? b.snapshot.recordId : b.recordId)))
}
export function questionSource(messages: readonly ChatMessage[], message: ChatMessage) {
  return messages.find(item => item.id === message.response?.sourceUserMessageId)
}
export function questionReason(messages: readonly ChatMessage[], message: ChatMessage, target: ChatTarget | ChatContextPresentation | undefined): string {
  if (messages.at(-1)?.id !== message.id || message.role !== 'assistant' || message.status !== 'completed') return 'This question is no longer active. Continue with a new message.'
  const source = questionSource(messages, message)
  if (!source || !target || !sameChatTarget(source.context ?? { kind: 'session' }, target)) return 'This question belongs to the source shown above. Select that source to use a choice. Typed messages still use your current context.'
  return ''
}
export const occupiedChoiceReason = 'Your unsent message and images are retained. Send your typed message or clear the composer before using this control.'
export const actionRequestText = 'Please use your configured tools to create the Jira issue or subtask from the draft and choices reviewed above. Ask me about any missing or conflicting details before creating. Report the result and link as your observations. Do not repeat creation if its outcome is uncertain.'
