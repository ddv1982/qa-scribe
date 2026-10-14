import { useState } from 'react'

export type ChatNoteRecovery = {
  pendingSessionIds: string[]
  has: (sessionId: string) => boolean
  hasPending: () => boolean
  isRetired: (sessionId: string) => boolean
  begin: (sessionId: string) => void
  complete: (sessionId: string) => void
  retire: (sessionId: string) => void
  bindRetirement: (handler: (sessionId: string) => void) => () => void
}

// This is a Note-write guard, not Summary undo or an ambient-save suppression.
// Its synchronous set protects invoke boundaries; state exposes read-only UI.
export function useChatNoteRecovery(): ChatNoteRecovery {
  const [pendingSessionIds, setPendingSessionIds] = useState<string[]>([])
  const [actions] = useState(() => {
    const pending = new Set<string>()
    const retired = new Set<string>()
    let retirementHandler: ((sessionId: string) => void) | null = null
    const publish = () => setPendingSessionIds(Array.from(pending))
    return {
      has: (id: string) => pending.has(id),
      hasPending: () => pending.size > 0,
      isRetired: (id: string) => retired.has(id),
      begin: (id: string) => { if (!retired.has(id)) { pending.add(id); publish() } },
      complete: (id: string) => { if (pending.delete(id)) publish() },
      retire: (id: string) => {
        retired.add(id)
        pending.delete(id)
        retirementHandler?.(id)
        publish()
      },
      bindRetirement: (handler: (sessionId: string) => void) => {
        retirementHandler = handler
        return () => { if (retirementHandler === handler) retirementHandler = null }
      },
    }
  })
  return { ...actions, pendingSessionIds }
}
