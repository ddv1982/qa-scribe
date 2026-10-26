import { useMemo, useSyncExternalStore } from 'react'
import type { ChatRef } from '../bindings'
import type { ConversationEngine } from './sessionChat.actions'
import { emptyChatSnapshot } from './sessionChat.types'

const subscribeEmpty = () => () => {}
const snapshotEmpty = () => emptyChatSnapshot

export function useConversationSnapshot(engine: ConversationEngine, reference: ChatRef | null) {
  const sessionId = reference?.sessionId
  const draftId = reference?.draftId
  const handle = useMemo(() => sessionId && draftId ? engine.bind({ sessionId, draftId }) : null, [engine, sessionId, draftId])
  return useSyncExternalStore(handle?.subscribe ?? subscribeEmpty, handle?.snapshot ?? snapshotEmpty)
}
