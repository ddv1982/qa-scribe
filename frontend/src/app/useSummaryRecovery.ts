import { useRef } from 'react'
import type { Entry, GenerationJobStatus } from '../bindings'
import type { SummaryRecoveryCoordinator } from './types'

export function useSummaryRecovery(): SummaryRecoveryCoordinator {
  return {
    recoveredJobsRef: useRef(new Map<string, GenerationJobStatus>()),
    unresolvedSummaryJobsRef: useRef(new Map<string, string>()),
    completedSummaryEntriesRef: useRef(new Map<string, Entry>()),
    openingSessionIdRef: useRef<string | null>(null),
    discoveryPendingRef: useRef(true),
    blockedSaveSessionIdsRef: useRef(new Set<string>()),
  }
}
