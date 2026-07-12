import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { listDrafts, listFindings, type Draft, type Finding } from '../tauri'
import { formatError } from '../ui/format'
import type { MainView } from '../ui/types'

type UseRecordHydrationOptions = {
  activeSessionId: string | null
  activeView: MainView
  setError: Dispatch<SetStateAction<string | null>>
}

export function useRecordHydration({ activeSessionId, activeView, setError }: UseRecordHydrationOptions) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [testwareDraftCount, setTestwareDraftCount] = useState(0)
  const [findingCount, setFindingCount] = useState(0)

  const draftsSessionIdRef = useRef<string | null>(null)
  const findingsSessionIdRef = useRef<string | null>(null)
  const draftsRef = useRef<Draft[]>([])
  const findingsRef = useRef<Finding[]>([])
  const dirtyDraftIdsRef = useRef<Set<string>>(new Set())
  const dirtyFindingIdsRef = useRef<Set<string>>(new Set())
  const recordLoadVersionRef = useRef(0)
  const activeSessionIdRef = useRef(activeSessionId)

  const invalidateRecordLoads = useCallback(() => {
    recordLoadVersionRef.current += 1
  }, [])

  const resetRecordHydration = useCallback(() => {
    invalidateRecordLoads()
    draftsSessionIdRef.current = null
    findingsSessionIdRef.current = null
    draftsRef.current = []
    findingsRef.current = []
  }, [invalidateRecordLoads])

  const loadDraftsForSession = useCallback(async (sessionId: string, options: { force?: boolean; replace?: boolean } = {}): Promise<Draft[]> => {
    const { force = false, replace = false } = options
    if (!force && draftsSessionIdRef.current === sessionId) return draftsRef.current

    const loadVersion = recordLoadVersionRef.current
    const loaded = await listDrafts(sessionId)
    if (recordLoadVersionRef.current !== loadVersion || activeSessionIdRef.current !== sessionId) return draftsRef.current

    const nextDrafts = mergeRecordLists(loaded, draftsRef.current, sessionId, { dirtyIds: dirtyDraftIdsRef.current, replace })
    draftsSessionIdRef.current = sessionId
    draftsRef.current = nextDrafts
    setDrafts(nextDrafts)
    setTestwareDraftCount(nextDrafts.filter((draft) => draft.kind === 'testware').length)
    return nextDrafts
  }, [])

  const loadFindingsForSession = useCallback(async (sessionId: string, options: { force?: boolean; replace?: boolean } = {}): Promise<Finding[]> => {
    const { force = false, replace = false } = options
    if (!force && findingsSessionIdRef.current === sessionId) return findingsRef.current

    const loadVersion = recordLoadVersionRef.current
    const loaded = await listFindings(sessionId)
    if (recordLoadVersionRef.current !== loadVersion || activeSessionIdRef.current !== sessionId) return findingsRef.current

    const nextFindings = mergeRecordLists(loaded, findingsRef.current, sessionId, { dirtyIds: dirtyFindingIdsRef.current, replace })
    findingsSessionIdRef.current = sessionId
    findingsRef.current = nextFindings
    setFindings(nextFindings)
    setFindingCount(nextFindings.length)
    return nextFindings
  }, [])

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])

  useEffect(() => {
    findingsRef.current = findings
  }, [findings])

  useEffect(() => {
    if (!activeSessionId || activeView !== 'testware') return
    void loadDraftsForSession(activeSessionId).catch((cause: unknown) => setError(formatError(cause)))
  }, [activeSessionId, activeView, loadDraftsForSession, setError])

  useEffect(() => {
    if (!activeSessionId || activeView !== 'findings') return
    void loadFindingsForSession(activeSessionId).catch((cause: unknown) => setError(formatError(cause)))
  }, [activeSessionId, activeView, loadFindingsForSession, setError])

  return {
    drafts,
    findings,
    testwareDraftCount,
    findingCount,
    draftsRef,
    findingsRef,
    dirtyDraftIdsRef,
    dirtyFindingIdsRef,
    setDrafts,
    setFindings,
    setTestwareDraftCount,
    setFindingCount,
    invalidateRecordLoads,
    resetRecordHydration,
    loadDraftsForSession,
    loadFindingsForSession,
  }
}

export function mergeRecordLists<T extends { id: string; sessionId: string }>(
  loaded: T[],
  previous: T[],
  sessionId: string,
  options: { dirtyIds?: Set<string>; replace?: boolean } = {},
): T[] {
  const loadedIds = new Set(loaded.map((record) => record.id))
  const dirtyRecords = new Map(
    previous.filter((record) => record.sessionId === sessionId && options.dirtyIds?.has(record.id)).map((record) => [record.id, record]),
  )
  const localOnly = previous.filter(
    (record) => record.sessionId === sessionId && !loadedIds.has(record.id) && (!options.replace || options.dirtyIds?.has(record.id)),
  )
  return [...localOnly, ...loaded.map((record) => dirtyRecords.get(record.id) ?? record)]
}
