import { useCallback, useEffect, useRef, useState } from 'react'
import { listDrafts, listFindings, type Draft, type Finding } from '../tauri'
import { formatError } from '../ui/format'
import type { MainView } from '../ui/types'

type UseRecordHydrationOptions = {
  activeSessionId: string | null
  activeView: MainView
}

export type RecordLoadState = 'idle' | 'loading' | 'ready' | 'error'
export type RecordLoadSuspension = { draftVersion: number; findingVersion: number }

export function useRecordHydration({ activeSessionId, activeView }: UseRecordHydrationOptions) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [testwareDraftCount, setTestwareDraftCount] = useState(0)
  const [findingCount, setFindingCount] = useState(0)
  const [draftLoadState, setDraftLoadState] = useState<RecordLoadState>('idle')
  const [findingLoadState, setFindingLoadState] = useState<RecordLoadState>('idle')
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null)
  const [findingLoadError, setFindingLoadError] = useState<string | null>(null)

  const draftsSessionIdRef = useRef<string | null>(null)
  const findingsSessionIdRef = useRef<string | null>(null)
  const draftsRef = useRef<Draft[]>([])
  const findingsRef = useRef<Finding[]>([])
  const savedDraftsRef = useRef<Draft[]>([])
  const savedFindingsRef = useRef<Finding[]>([])
  const dirtyDraftIdsRef = useRef<Set<string>>(new Set())
  const dirtyFindingIdsRef = useRef<Set<string>>(new Set())
  const draftLoadVersionRef = useRef(0)
  const findingLoadVersionRef = useRef(0)
  const activeSessionIdRef = useRef(activeSessionId)

  const invalidateDraftLoads = useCallback(() => {
    draftLoadVersionRef.current += 1
    setDraftLoadState((current) => current === 'loading' ? 'ready' : current)
  }, [])

  const invalidateFindingLoads = useCallback(() => {
    findingLoadVersionRef.current += 1
    setFindingLoadState((current) => current === 'loading' ? 'ready' : current)
  }, [])

  const invalidateRecordLoads = useCallback(() => {
    invalidateDraftLoads()
    invalidateFindingLoads()
  }, [invalidateDraftLoads, invalidateFindingLoads])

  const resetRecordHydration = useCallback(() => {
    invalidateRecordLoads()
    draftsSessionIdRef.current = null
    findingsSessionIdRef.current = null
    draftsRef.current = []
    findingsRef.current = []
    savedDraftsRef.current = []
    savedFindingsRef.current = []
    setDraftLoadState('idle')
    setFindingLoadState('idle')
    setDraftLoadError(null)
    setFindingLoadError(null)
  }, [invalidateRecordLoads])

  const loadDraftsForSession = useCallback(async (sessionId: string, options: { force?: boolean; replace?: boolean } = {}): Promise<Draft[]> => {
    const { force = false, replace = false } = options
    if (!force && draftsSessionIdRef.current === sessionId) return draftsRef.current

    setDraftLoadState('loading')
    setDraftLoadError(null)
    const loadVersion = ++draftLoadVersionRef.current
    let loaded: Draft[]
    try {
      loaded = await listDrafts(sessionId)
    } catch (cause) {
      if (draftLoadVersionRef.current !== loadVersion || activeSessionIdRef.current !== sessionId) return draftsRef.current
      setDraftLoadError(formatError(cause))
      setDraftLoadState('error')
      throw cause
    }
    if (draftLoadVersionRef.current !== loadVersion || activeSessionIdRef.current !== sessionId) return draftsRef.current

    savedDraftsRef.current = loaded
    const nextDrafts = mergeRecordLists(loaded, draftsRef.current, sessionId, { dirtyIds: dirtyDraftIdsRef.current, replace })
    draftsSessionIdRef.current = sessionId
    draftsRef.current = nextDrafts
    setDrafts(nextDrafts)
    setTestwareDraftCount(nextDrafts.filter((draft) => draft.kind === 'testware').length)
    setDraftLoadState('ready')
    return nextDrafts
  }, [])

  const loadFindingsForSession = useCallback(async (sessionId: string, options: { force?: boolean; replace?: boolean } = {}): Promise<Finding[]> => {
    const { force = false, replace = false } = options
    if (!force && findingsSessionIdRef.current === sessionId) return findingsRef.current

    setFindingLoadState('loading')
    setFindingLoadError(null)
    const loadVersion = ++findingLoadVersionRef.current
    let loaded: Finding[]
    try {
      loaded = await listFindings(sessionId)
    } catch (cause) {
      if (findingLoadVersionRef.current !== loadVersion || activeSessionIdRef.current !== sessionId) return findingsRef.current
      setFindingLoadError(formatError(cause))
      setFindingLoadState('error')
      throw cause
    }
    if (findingLoadVersionRef.current !== loadVersion || activeSessionIdRef.current !== sessionId) return findingsRef.current

    savedFindingsRef.current = loaded
    const nextFindings = mergeRecordLists(loaded, findingsRef.current, sessionId, { dirtyIds: dirtyFindingIdsRef.current, replace })
    findingsSessionIdRef.current = sessionId
    findingsRef.current = nextFindings
    setFindings(nextFindings)
    setFindingCount(nextFindings.length)
    setFindingLoadState('ready')
    return nextFindings
  }, [])

  const suspendRecordLoads = useCallback((): RecordLoadSuspension => {
    invalidateRecordLoads()
    return {
      draftVersion: draftLoadVersionRef.current,
      findingVersion: findingLoadVersionRef.current,
    }
  }, [invalidateRecordLoads])

  const restoreRecordLoads = useCallback(async (suspension: RecordLoadSuspension): Promise<void> => {
    if (
      draftLoadVersionRef.current !== suspension.draftVersion
      || findingLoadVersionRef.current !== suspension.findingVersion
      || !activeSessionId
    ) return
    try {
      if (activeView === 'testware') {
        await loadDraftsForSession(activeSessionId, { force: true })
      } else if (activeView === 'findings') {
        await loadFindingsForSession(activeSessionId, { force: true })
      }
    } catch {
      // The loader owns its error state and retry UI.
    }
  }, [activeSessionId, activeView, loadDraftsForSession, loadFindingsForSession])

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
    const timeout = window.setTimeout(() => void loadDraftsForSession(activeSessionId).catch(() => undefined), 0)
    return () => window.clearTimeout(timeout)
  }, [activeSessionId, activeView, loadDraftsForSession])

  useEffect(() => {
    if (!activeSessionId || activeView !== 'findings') return
    const timeout = window.setTimeout(() => void loadFindingsForSession(activeSessionId).catch(() => undefined), 0)
    return () => window.clearTimeout(timeout)
  }, [activeSessionId, activeView, loadFindingsForSession])

  return {
    drafts,
    findings,
    testwareDraftCount,
    findingCount,
    draftLoadError,
    draftLoadState,
    findingLoadError,
    findingLoadState,
    draftsRef,
    findingsRef,
    savedDraftsRef,
    savedFindingsRef,
    dirtyDraftIdsRef,
    dirtyFindingIdsRef,
    setDrafts,
    setFindings,
    setTestwareDraftCount,
    setFindingCount,
    invalidateDraftLoads,
    invalidateFindingLoads,
    resetRecordHydration,
    suspendRecordLoads,
    restoreRecordLoads,
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
