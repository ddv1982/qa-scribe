import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react'
import { deleteTestRun, getTestRun, listTestRuns, saveTestCaseNotes, setTestCaseResult, startTestRun, type TestRun, type TestRunCaseDraft, type TestRunSummary, type TestRunSuggestionOutcome } from '../tauri'
import { CaseSaveQueue, type CasePatch, type CaseSaveListener } from './caseSaveQueue'
import { latestTestRunIds } from './testRuns'
import { formatError } from '../ui/format'

/** The test run on screen: loading while `run` and `error` are both null. */
export type OpenTestRun = { runId: string; draftId: string; run: TestRun | null; error: string | null }

export const BACKGROUND_SAVE_ERROR = 'A change to a test run could not be saved.'

/**
 * Queues of runs no longer on screen that still have saves to make, by run id. It lives outside the
 * hook because the Test cases view unmounts on a tab or Session change while its saves keep going;
 * a run reopened afterwards must still wait for them.
 */
const draining = new Map<string, CaseSaveQueue>()
const onScreen = new Map<string, CaseSaveQueue>()
const editBarriers = new Map<string, Promise<void>>()
const barrierListeners = new Set<() => void>()
const noteImageReads = new Map<Promise<unknown>, string>()

export function trackNoteImageRead<T>(runId: string, read: Promise<T>): Promise<T> {
  noteImageReads.set(read, runId)
  return read.finally(() => noteImageReads.delete(read))
}

function readsForRun(runId: string): Promise<unknown>[] {
  return [...noteImageReads].flatMap(([read, owner]) => owner === runId ? [read] : [])
}

export function isTestRunEditBlocked(runId: string): boolean {
  return editBarriers.has(runId)
}

function subscribeToBarriers(listener: () => void) {
  barrierListeners.add(listener)
  return () => { barrierListeners.delete(listener) }
}

export async function acquireTestRunEditBarrier(runId: string): Promise<() => void> {
  if (isTestRunEditBlocked(runId)) throw new Error('Wait for the current test run action to finish.')
  let resolve!: () => void
  editBarriers.set(runId, new Promise<void>(done => { resolve = done }))
  const notify = () => barrierListeners.forEach(listener => listener())
  const release = () => { editBarriers.delete(runId); resolve(); notify() }
  notify()
  try {
    await Promise.allSettled(readsForRun(runId))
    const queue = onScreen.get(runId) ?? draining.get(runId)
    await queue?.whenIdle()
    if (queue?.hasFailedSave || queue?.hasPendingNotes) {
      throw new Error('Retry the failed test case save before continuing.')
    }
    return release
  } catch (cause) {
    release()
    throw cause
  }
}

function runQueues() {
  return new Set([...onScreen.values(), ...draining.values()])
}

export function hasPendingTestRunNotes(): boolean {
  return noteImageReads.size > 0 || [...runQueues()].some(queue => queue.hasPendingNotes)
}

export async function flushPendingTestRunNotes(): Promise<boolean> {
  const queues = runQueues()
  for (const queue of queues) queue.retryNotes()
  while (noteImageReads.size) await Promise.allSettled(noteImageReads.keys())
  await Promise.all([...runQueues()].map(queue => queue.whenIdle()))
  return !hasPendingTestRunNotes()
}

/** Forgets every draining queue. For tests, which share this module. */
export function forgetDrainingTestRuns() {
  draining.clear()
  onScreen.clear()
  editBarriers.clear()
}

/**
 * Told when a run's background saves have all settled. The view that started them may be gone by
 * then, so whichever view shows that Session now refreshes its counts and reports a failure.
 */
type Drained = { sessionId: string; failed: boolean }
const drainedListeners = new Set<(event: Drained) => void>()

type ScreenQueue = { runId: string; sessionId: string; queue: CaseSaveQueue; background: { failed: boolean } }

/** Keeps a queue that left the screen until its saves have settled, then tells the views. */
function drain(left: ScreenQueue) {
  const reads = readsForRun(left.runId)
  const barrier = editBarriers.get(left.runId)
  if (draining.get(left.runId) === left.queue) return
  if (!barrier && !reads.length && left.queue.idle && !left.queue.hasPendingNotes) return
  draining.set(left.runId, left.queue)
  void Promise.all([barrier, Promise.allSettled(reads)]).then(() => left.queue.whenIdle()).then(() => {
    if (draining.get(left.runId) === left.queue && !left.queue.hasPendingNotes) draining.delete(left.runId)
    for (const listener of drainedListeners) listener({ sessionId: left.sessionId, failed: left.background.failed })
  })
}

/**
 * Test runs of one Session, owned by its Test cases view and kept out of the app controller. Results
 * and remarks are saved as they change: the screen updates at once, saves of one case go one at a time
 * (see CaseSaveQueue), and a failed save shows the stored value again. A change is stored even when the
 * tester leaves the run before its save finished: the run's queue drains in the background, and
 * opening or deleting that run waits for it.
 */
export function useTestRuns(sessionId: string | null) {
  const [summaries, setSummaries] = useState<TestRunSummary[]>([])
  /** The newest test run of each draft, with its cases, for the coverage line. */
  const [latestRuns, setLatestRuns] = useState<TestRun[]>([])
  const [open, setOpen] = useState<OpenTestRun | null>(null)
  const editsBlocked = useSyncExternalStore(subscribeToBarriers, () => Boolean(open && isTestRunEditBlocked(open.runId)))
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef(sessionId)
  /** The run on screen and its draft, read by callbacks that outlive a render. */
  const openRef = useRef<Pick<OpenTestRun, 'runId' | 'draftId'> | null>(null)
  const summariesRequestRef = useRef(0)
  /** Saves of the run on screen. */
  const queueRef = useRef<ScreenQueue | null>(null)
  /** The queue that last left the screen. A remark committed as its input unmounts still belongs to it. */
  const leftRef = useRef<ScreenQueue | null>(null)
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
      const latest = await Promise.all(latestTestRunIds(next).map((runId) => getTestRun(runId)))
      if (request !== summariesRequestRef.current || sessionRef.current !== session) return
      setSummaries(next)
      setLatestRuns(latest)
    } catch {
      // The Last test run line and the coverage line are hints; a failed refresh keeps the previous ones.
    }
  }, [])

  /** Takes the screen's queue off screen; it keeps saving until idle, then is forgotten. */
  const detachQueue = useCallback(() => {
    const current = queueRef.current
    queueRef.current = null
    if (!current) return
    if (onScreen.get(current.runId) === current.queue) onScreen.delete(current.runId)
    current.queue.detach()
    leftRef.current = current
    drain(current)
  }, [])

  const show = useCallback((next: OpenTestRun | null) => {
    openRef.current = next ? { runId: next.runId, draftId: next.draftId } : null
    detachQueue()
    if (next?.run) {
      const background = { failed: false }
      // Once the queue has left the screen, the drained notice refreshes the counts instead.
      const onSaved = () => { if (queueRef.current?.queue === queue) void refresh() }
      const listener = caseListener(next.run.id, setOpen, setError, onSaved, background)
      const existing = draining.get(next.runId)
      const queue = existing ?? saveQueue(next.run, listener)
      draining.delete(next.runId)
      onScreen.set(next.runId, queue)
      queueRef.current = { runId: next.runId, sessionId: next.run.sessionId, background, queue }
      if (existing) next = { ...next, run: { ...next.run, cases: queue.attach(next.run.cases, listener) } }
    }
    setError(null)
    setOpen(next)
  }, [detachQueue, refresh])

  useEffect(() => {
    const onDrained = (event: Drained) => {
      if (event.sessionId !== sessionRef.current) return
      void refresh()
      if (event.failed) setError(BACKGROUND_SAVE_ERROR)
    }
    drainedListeners.add(onDrained)
    return () => { drainedListeners.delete(onDrained) }
  }, [refresh])

  /** Abandons a pending start: whatever it returns no longer opens. */
  const leaveContext = useCallback(() => {
    contextRef.current += 1
    setStarting(false)
    setStartError(null)
  }, [])

  // Another Session starts with nothing on screen; its test runs load below.
  const [shownSession, setShownSession] = useState(sessionId)
  if (shownSession !== sessionId) {
    setShownSession(sessionId)
    setSummaries([])
    setLatestRuns([])
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
      // Saves made before the run was left land first, so what is read is what is stored. The pause
      // lets a remark committed as its input unmounts join them.
      await Promise.resolve()
      await editBarriers.get(runId)
      await Promise.allSettled(readsForRun(runId))
      await draining.get(runId)?.whenIdle()
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
  const changeCase = useCallback((caseId: string, patch: CasePatch, completingImageRead = false) => {
    setError(null)
    const current = queueRef.current
    if (current?.queue.has(caseId)) {
      if (completingImageRead || !isTestRunEditBlocked(current.runId)) current.queue.change(caseId, patch)
      return
    }
    // The run just left the screen: its queue stores the change in the background.
    const left = leftRef.current
    if (left?.queue.has(caseId)) {
      if (completingImageRead || !isTestRunEditBlocked(left.runId)) left.queue.change(caseId, patch)
      drain(left)
      return
    }
    for (const [runId, queue] of draining) {
      if (queue.has(caseId) && (completingImageRead || !isTestRunEditBlocked(runId))) { queue.change(caseId, patch); break }
    }
  }, [])

  const readSavedRun = useCallback(async (runId: string) => {
    const current = queueRef.current
    const queue = current?.runId === runId ? current.queue : draining.get(runId)
    await Promise.allSettled(readsForRun(runId))
    await queue?.whenIdle()
    if (queue?.hasPendingNotes) throw new Error('Retry the unsaved result notes before copying the report.')
    return getTestRun(runId)
  }, [])

  const deleteRun = useCallback(async (runId: string) => {
    await editBarriers.get(runId)
    const wasOpen = openRef.current?.runId === runId ? openRef.current : null
    // No save may land on a case after it is deleted, so every save of the run settles first.
    if (queueRef.current?.runId === runId) detachQueue()
    await Promise.allSettled(readsForRun(runId))
    await draining.get(runId)?.whenIdle()
    try {
      await deleteTestRun(runId)
      draining.delete(runId)
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

  return { summaries, latestRuns, open, editsBlocked, starting, startError, error, openRun, close, keepForDraft, start, changeCase, readSavedRun, deleteRun }
}

function saveQueue(run: TestRun, listener: CaseSaveListener) {
  return new CaseSaveQueue(run.cases, (caseId, { result, remark }) => setTestCaseResult(caseId, result, remark),
    listener, (caseId, { notes, images }) => saveTestCaseNotes(caseId, notes.bodyJson, images))
}

function caseListener(runId: string, setOpen: Dispatch<SetStateAction<OpenTestRun | null>>, setError: (error: string) => void,
  onSaved: () => void, background: { failed: boolean }): CaseSaveListener {
  return {
    onShow: (next) => setOpen((current) => current?.run && current.runId === runId
      ? { ...current, run: { ...current.run, cases: current.run.cases.map((testCase) => testCase.id === next.id ? next : testCase) } }
      : current),
    onSaved,
    onError: (_caseId, cause) => setError(formatError(cause)),
    onBackgroundError: () => { background.failed = true },
  }
}

export type TestRuns = ReturnType<typeof useTestRuns>

export async function runTestRunSuggestionAction(
  runId: string,
  write: () => Promise<TestRunSuggestionOutcome[]>,
): Promise<TestRunSuggestionOutcome[]> {
  const release = await acquireTestRunEditBarrier(runId)
  try {
    const queue = onScreen.get(runId)
    if (!queue) throw new Error('Open this test run to update its results.')
    const outcomes = await write()
    queue.install(outcomes.flatMap(outcome => outcome.kind === 'failed' ? [] : [outcome.testCase]))
    return outcomes
  } finally {
    release()
  }
}
