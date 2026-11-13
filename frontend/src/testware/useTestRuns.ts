import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { deleteTestRun, getTestRun, listTestRuns, setTestCaseResult, startTestRun, type TestRun, type TestRunCase, type TestRunCaseDraft, type TestRunSummary } from '../tauri'
import { CaseSaveQueue, type CasePatch } from './caseSaveQueue'
import { formatError } from '../ui/format'

/** The test run on screen: loading while `run` and `error` are both null. */
export type OpenTestRun = { runId: string; draftId: string; run: TestRun | null; error: string | null }

export const BACKGROUND_SAVE_ERROR = 'A change to a test run could not be saved.'

/**
 * Test runs of one Session, owned by its Test cases view and kept out of the app controller. Results
 * and remarks are saved as they change: the screen updates at once, saves of one case go one at a time
 * (see CaseSaveQueue), and a failed save shows the stored value again. A change is stored even when the
 * tester leaves the run before its save finished: the run's queue drains in the background, and
 * opening or deleting that run waits for it.
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
  /** Saves of the run on screen. */
  const queueRef = useRef<{ runId: string; queue: CaseSaveQueue } | null>(null)
  /** Queues of runs no longer on screen that still have saves to make, by run id. */
  const drainingRef = useRef(new Map<string, CaseSaveQueue>())
  /**
   * Bumped when the Session or the selected draft changes. A test run that is started or opened shows
   * only if nothing changed while it was being read.
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

  /** Takes the screen's queue off screen; it keeps saving until idle, then is forgotten. */
  const detachQueue = useCallback(() => {
    const current = queueRef.current
    queueRef.current = null
    if (!current) return
    current.queue.detach()
    if (current.queue.idle) return
    const draining = drainingRef.current
    draining.set(current.runId, current.queue)
    void current.queue.whenIdle().then(() => {
      if (draining.get(current.runId) === current.queue) draining.delete(current.runId)
    })
  }, [])

  const show = useCallback((next: OpenTestRun | null) => {
    openRef.current = next ? { runId: next.runId, draftId: next.draftId } : null
    detachQueue()
    if (next?.run) {
      const session = sessionRef.current
      const sameSession = () => sessionRef.current === session
      queueRef.current = { runId: next.runId, queue: saveQueue(next.run, setOpen, setError, sameSession, refresh) }
    }
    setError(null)
    setOpen(next)
  }, [detachQueue, refresh])

  /** Abandons a pending start: whatever it returns no longer opens. */
  const leaveContext = useCallback(() => {
    contextRef.current += 1
    setStarting(false)
  }, [])

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
    detachQueue()
    void refresh()
  }, [sessionId, refresh, detachQueue])

  useEffect(() => detachQueue, [detachQueue])

  const openRun = useCallback(async (runId: string, draftId: string) => {
    const context = contextRef.current
    show({ runId, draftId, run: null, error: null })
    const current = () => contextRef.current === context && openRef.current?.runId === runId
    try {
      // Saves made before the run was left land first, so what is read is what is stored.
      await drainingRef.current.get(runId)?.whenIdle()
      const run = await getTestRun(runId)
      if (current()) show({ runId, draftId, run, error: null })
    } catch (cause) {
      if (current()) show({ runId, draftId, run: null, error: formatError(cause) })
    }
  }, [show])

  const close = useCallback(() => show(null), [show])

  /** Closes the run screen unless it belongs to `draftId`, the draft now selected. */
  const keepForDraft = useCallback((draftId: string | null) => {
    if (selectedDraftRef.current !== draftId) leaveContext()
    selectedDraftRef.current = draftId
    if (openRef.current && openRef.current.draftId !== draftId) show(null)
  }, [leaveContext, show])

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
    queueRef.current?.queue.change(caseId, patch)
  }, [])

  const deleteRun = useCallback(async (runId: string) => {
    const wasOpen = openRef.current?.runId === runId ? openRef.current : null
    // No save may land on a case after it is deleted, so every save of the run settles first.
    if (queueRef.current?.runId === runId) detachQueue()
    await drainingRef.current.get(runId)?.whenIdle()
    try {
      await deleteTestRun(runId)
      if (openRef.current?.runId === runId) show(null)
      await refresh()
      return true
    } catch (cause) {
      // The run stays on screen; read it again so its changes save through a fresh queue.
      if (wasOpen && openRef.current?.runId === runId) await openRun(runId, wasOpen.draftId)
      setError(formatError(cause))
      return false
    }
  }, [detachQueue, openRun, refresh, show])

  return { summaries, open, starting, startError, error, openRun, close, keepForDraft, start, changeCase, deleteRun }
}

/** A save queue for `run` that shows each case change on screen while `run` is the open one. */
function saveQueue(run: TestRun, setOpen: Dispatch<SetStateAction<OpenTestRun | null>>, setError: (error: string) => void,
  sameSession: () => boolean, refresh: () => Promise<void>) {
  const showCase = (next: TestRunCase) => setOpen((current) => current?.run && current.runId === run.id
    ? { ...current, run: { ...current.run, cases: current.run.cases.map((testCase) => testCase.id === next.id ? next : testCase) } }
    : current)
  return new CaseSaveQueue(run.cases, (caseId, { result, remark }) => setTestCaseResult(caseId, result, remark), {
    onShow: showCase,
    onSaved: () => { if (sameSession()) void refresh() },
    onError: (_caseId, cause) => setError(formatError(cause)),
    onBackgroundError: () => { if (sameSession()) setError(BACKGROUND_SAVE_ERROR) },
  })
}

export type TestRuns = ReturnType<typeof useTestRuns>
