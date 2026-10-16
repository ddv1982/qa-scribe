import type { SummaryRecoveryCoordinator } from './types'
import type { ChatNoteRecovery } from './useChatNoteRecovery'

export type NoteEligibility = ReturnType<typeof createNoteEligibility>

type RecoveryOwners = {
  summary: Pick<SummaryRecoveryCoordinator, 'discoveryPendingRef' | 'unresolvedSummaryJobsRef'>
  chat: Pick<ChatNoteRecovery, 'has' | 'isRetired'>
}

export function createNoteEligibility(owners: RecoveryOwners) {
  const summaryBlocks = (sessionId: string) => owners.summary.discoveryPendingRef.current
    || Array.from(owners.summary.unresolvedSummaryJobsRef.current.values()).includes(sessionId)
  const chatBlocks = (sessionId: string) => owners.chat.has(sessionId) || owners.chat.isRetired(sessionId)
  return {
    canWrite: (sessionId: string, operation: 'ambient' | 'recovery') => !chatBlocks(sessionId)
      && (operation === 'recovery' || !summaryBlocks(sessionId)),
    canHydrate: () => !owners.summary.discoveryPendingRef.current,
    canAdoptSummary: (sessionId: string) => !chatBlocks(sessionId),
    canRecoverCanonical: (sessionId: string) => !owners.chat.isRetired(sessionId),
  }
}
