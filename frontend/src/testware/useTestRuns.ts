import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteTestRun, getTestRun, listTestRuns, setTestCaseResult, startTestRun, type TestCaseResult, type TestRun, type TestRunCase, type TestRunCaseDraft, type TestRunSummary } from '../tauri'
import { formatError } from '../ui/format'

/** The test run on screen: loading while `run` and `error` are both null. */
export type OpenTestRun = { runId: string; draftId: string; run: TestRun | null; error: string | null }

/**
 * Test runs of one Session, owned by its Test cases view and kept out of the app controller. Results
 * are saved as they are chosen: the screen updates at once and rolls back when the save fails.
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
  /** Per case: the last save request, so only the newest one settles the screen. */
  const caseRequestsRef = useRef(new Map<string, number>())
  /** Per case: what the store last confirmed, the value a failed save rolls back to. */
  const confirmedRef = useRef(new Map<string, TestRunCase>())

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
    caseRequestsRef.current.clear()
    confirmedRef.current = new Map(next?.run?.cases.map((testCase) => [testCase.id, testCase]) ?? [])
    setError(null)
    setOpen(next)
  }, [])

  // Another Session starts with nothing on screen; its test runs load below.
  const [shownSession, setShownSession] = useState(sessionId)
  if (shownSession !== sessionId) {
    setShownSession(sessionId)
    setSummaries([])
    setOpen(null)
    setError(null)
    setStartError(null)
  }

  useEffect(() => {
    sessionRef.current = sessionId
    openRef.current = null
    caseRequestsRef.current.clear()
    void refresh()
  }, [sessionId, refresh])

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
    if (openRef.current && openRef.current.draftId !== draftId) show(null)
  }, [show])

  const start = useCallback(async (draftId: string, cases: TestRunCaseDraft[]) => {
    setStarting(true)
    setStartError(null)
    try {
      const run = await startTestRun(draftId, cases)
      show({ runId: run.id, draftId, run, error: null })
      void refresh()
    } catch (cause) {
      setStartError(formatError(cause))
    } finally {
      setStarting(false)
    }
  }, [refresh, show])

  const setResult = useCallback(async (caseId: string, result: TestCaseResult, remark: string | null) => {
    const runId = openRef.current?.runId
    const request = (caseRequestsRef.current.get(caseId) ?? 0) + 1
    caseRequestsRef.current.set(caseId, request)
    const replaceCase = (next: TestRunCase) => setOpen((current) => current?.run && current.runId === runId
      ? { ...current, run: { ...current.run, cases: current.run.cases.map((testCase) => testCase.id === caseId ? next : testCase) } }
      : current)
    const confirmed = confirmedRef.current.get(caseId)
    if (confirmed) replaceCase({ ...confirmed, result, remark })
    setError(null)
    try {
      const saved = await setTestCaseResult(caseId, result, remark)
      if (openRef.current?.runId !== runId) return
      confirmedRef.current.set(caseId, saved)
      if (caseRequestsRef.current.get(caseId) === request) replaceCase(saved)
      void refresh()
    } catch (cause) {
      if (openRef.current?.runId !== runId || caseRequestsRef.current.get(caseId) !== request) return
      const previous = confirmedRef.current.get(caseId)
      if (previous) replaceCase(previous)
      setError(formatError(cause))
    }
  }, [refresh])

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

  return { summaries, open, starting, startError, error, openRun, close, keepForDraft, start, setResult, deleteRun }
}

export type TestRuns = ReturnType<typeof useTestRuns>
