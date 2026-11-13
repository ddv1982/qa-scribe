import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { deleteTestRun, getTestRun, listTestRuns, setTestCaseResult, startTestRun, type TestRun, type TestRunCase, type TestRunCaseDraft, type TestRunSummary } from '../tauri'
import { CaseSaveQueue, type CasePatch } from './caseSaveQueue'
import { formatError } from '../ui/format'

/** The test run on screen: loading while `run` and `error` are both null. */
export type OpenTestRun = { runId: string; draftId: string; run: TestRun | null; error: string | null }

/**
 * Test runs of one Session, owned by its Test cases view and kept out of the app controller. Results
 * and remarks are saved as they change: the screen updates at once, saves of one case go one at a time
 * (see CaseSaveQueue), and a failed save shows the stored value again.
 */
export function useTestRuns(sessionId: string | null) {
  const [summaries, setSummaries] = useState<TestRunSummary[]>([])
  const [open, setOpen] = useState<OpenTestRun | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef(sessionId)
  /** The run on screen and its draft, read by callbacks that outlive a render. */
  const openRef = useRef<Pick<OpenTestRun, 'runId' | 'draftId'> | null>(null)
  const summariesRequestRef = useRef(0)
  /** Saves of the open run's cases; replaced, and the old one silenced, whenever the run changes. */
  const queueRef = useRef<CaseSaveQueue | null>(null)
  /**
   * Bumped when the Session or the selected draft changes. A started test run opens only if nothing
   * changed while it was being created.
   */
  const contextRef = useRef(0)
  const selectedDraftRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    const request = ++summariesRequestRef.current
    try {
      const next = await listTestRuns(session)
      if (request === summariesRequestRef.current && sessionRef.current === session) setSummaries(next)
    } catch {
      // The Last test run line is a hint; a failed refresh keeps the previous one.
    }
  }, [])

  const show = useCallback((next: OpenTestRun | null) => {
    openRef.current = next ? { runId: next.runId, draftId: next.draftId } : null
    queueRef.current?.dispose()
    queueRef.current = next?.run ? saveQueue(next.run, setOpen, setError, refresh) : null
    setError(null)
    setOpen(next)
  }, [refresh])

  // Another Session starts with nothing on screen; its test runs load below.
  const [shownSession, setShownSession] = useState(sessionId)
  if (shownSession !== sessionId) {
    setShownSession(sessionId)
    setSummaries([])
    setOpen(null)
    setError(null)
    setStartError(null)
    setStarting(false)
  }

  useEffect(() => {
    sessionRef.current = sessionId
    contextRef.current += 1
    openRef.current = null
    queueRef.current?.dispose()
    queueRef.current = null
    void refresh()
  }, [sessionId, refresh])

  useEffect(() => () => queueRef.current?.dispose(), [])

  const openRun = useCallback(async (runId: string, draftId: string) => {
    show({ runId, draftId, run: null, error: null })
    try {
      const run = await getTestRun(runId)
      if (openRef.current?.runId === runId) show({ runId, draftId, run, error: null })
    } catch (cause) {
      if (openRef.current?.runId === runId) show({ runId, draftId, run: null, error: formatError(cause) })
    }
  }, [show])

  const close = useCallback(() => show(null), [show])

  /** Closes the run screen unless it belongs to `draftId`, the draft now selected. */
  const keepForDraft = useCallback((draftId: string | null) => {
    if (selectedDraftRef.current !== draftId) contextRef.current += 1
    selectedDraftRef.current = draftId
    if (openRef.current && openRef.current.draftId !== draftId) show(null)
  }, [show])

  const start = useCallback(async (draftId: string, cases: TestRunCaseDraft[]) => {
    const context = contextRef.current
    setStarting(true)
    setStartError(null)
    try {
      const run = await startTestRun(draftId, cases)
      if (contextRef.current === context) show({ runId: run.id, draftId, run, error: null })
      void refresh()
    } catch (cause) {
      if (contextRef.current === context) setStartError(formatError(cause))
    } finally {
      if (contextRef.current === context) setStarting(false)
    }
  }, [refresh, show])

  /** Changes one case of the open run: `{ result }` from a result button, `{ remark }` from the remark field. */
  const changeCase = useCallback((caseId: string, patch: CasePatch) => {
    setError(null)
    queueRef.current?.change(caseId, patch)
  }, [])

  const deleteRun = useCallback(async (runId: string) => {
    try {
      await deleteTestRun(runId)
      if (openRef.current?.runId === runId) show(null)
      await refresh()
      return true
    } catch (cause) {
      setError(formatError(cause))
      return false
    }
  }, [refresh, show])

  return { summaries, open, starting, startError, error, openRun, close, keepForDraft, start, changeCase, deleteRun }
}

/** A save queue for `run` that shows each case change on screen while `run` is the open one. */
function saveQueue(run: TestRun, setOpen: Dispatch<SetStateAction<OpenTestRun | null>>, setError: (error: string) => void, refresh: () => Promise<void>) {
  const showCase = (next: TestRunCase) => setOpen((current) => current?.run && current.runId === run.id
    ? { ...current, run: { ...current.run, cases: current.run.cases.map((testCase) => testCase.id === next.id ? next : testCase) } }
    : current)
  return new CaseSaveQueue(run.cases, (caseId, { result, remark }) => setTestCaseResult(caseId, result, remark), {
    onShow: showCase,
    onSaved: () => void refresh(),
    onError: (_caseId, cause) => setError(formatError(cause)),
  })
}

export type TestRuns = ReturnType<typeof useTestRuns>
