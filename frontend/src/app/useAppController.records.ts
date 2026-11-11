import type { RecordWorkspace } from './types'
import { useRecordHydration } from './useRecordHydration'

export function useAppControllerRecords(options: Parameters<typeof useRecordHydration>[0]) {
  const hydration = useRecordHydration(options)
  const recordWorkspace: RecordWorkspace = {
    drafts: hydration.drafts,
    findings: hydration.findings,
    dirtyDraftIdsRef: hydration.dirtyDraftIdsRef,
    dirtyFindingIdsRef: hydration.dirtyFindingIdsRef,
    draftsRef: hydration.draftsRef,
    findingsRef: hydration.findingsRef,
    savedDraftsRef: hydration.savedDraftsRef,
    savedFindingsRef: hydration.savedFindingsRef,
    setDrafts: hydration.setDrafts,
    setFindings: hydration.setFindings,
    setTestwareDraftCount: hydration.setTestwareDraftCount,
    setFindingCount: hydration.setFindingCount,
  }
  // The record part of the AppController surface.
  const recordsView = {
    draftLoadError: hydration.draftLoadError,
    draftLoadState: hydration.draftLoadState,
    findingCount: hydration.findingCount,
    findingLoadError: hydration.findingLoadError,
    findingLoadState: hydration.findingLoadState,
    findings: hydration.findings,
    loadDraftsForSession: hydration.loadDraftsForSession,
    loadFindingsForSession: hydration.loadFindingsForSession,
    testwareDraftCount: hydration.testwareDraftCount,
  }
  return { ...hydration, recordWorkspace, recordsView }
}
