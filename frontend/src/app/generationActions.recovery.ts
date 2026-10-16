import { getAiActionJobStatus, listActiveAiActionJobs, openSessionNoteState, type Entry, type GenerationJobStatus } from '../tauri'
import { formatError } from '../ui/format'
import type { GenerationActionsContext } from './generationActions.types'

const POLL_INTERVAL_MS = 1000
const MAX_ATTEMPTS = 3

type Observer = {
  status: Pick<GenerationJobStatus, 'jobId' | 'sessionId' | 'action'>
  stopped: boolean
  waits: Set<() => void>
}

export function generationIsActive(job: GenerationJobStatus): boolean {
  return job.state === 'starting' || job.state === 'running' || job.state === 'cancelling'
}

export function createGenerationRecovery(
  ctx: GenerationActionsContext,
  publish: (status: GenerationJobStatus) => void,
  apply: (entry: Entry) => void,
) {
  let active = true
  let epoch = 0
  let reconciliationStarted = false
  let discoveryVersion = 0
  const observers = new Map<string, Observer>()
  const discoveryWaits = new Set<() => void>()
  const reloadVersions = new Map<string, number>()

  function wait(waits: Set<() => void>) {
    return new Promise<void>((resolve) => {
      const cancel = () => { window.clearTimeout(timer); waits.delete(cancel); resolve() }
      const timer = window.setTimeout(cancel, POLL_INTERVAL_MS)
      waits.add(cancel)
    })
  }

  function stop(observer: Observer) {
    observer.stopped = true
    for (const cancel of observer.waits) cancel()
    if (observers.get(observer.status.jobId) === observer) observers.delete(observer.status.jobId)
  }

  function alive(observer: Observer) {
    return active && !observer.stopped && observers.get(observer.status.jobId) === observer
  }

  async function retry<T>(command: () => Promise<T>, current: () => boolean, waits: Set<() => void>): Promise<T | null> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && current(); attempt += 1) {
      try {
        const value = await command()
        return current() ? value : null
      } catch (cause) {
        if (!current()) return null
        if (attempt === MAX_ATTEMPTS) throw cause
        await wait(waits)
      }
    }
    return null
  }

  async function captureActiveJobs() {
    const capturedEpoch = epoch
    const capturedVersion = ++discoveryVersion
    const current = () => active && epoch === capturedEpoch && discoveryVersion === capturedVersion
    if (!current()) return
    let command: typeof listActiveAiActionJobs
    try { command = listActiveAiActionJobs } catch { ctx.summaryRecovery.discoveryPendingRef.current = false; return }
    if (typeof command !== 'function') { ctx.summaryRecovery.discoveryPendingRef.current = false; return }
    ctx.summaryRecovery.discoveryPendingRef.current = true
    let captured: GenerationJobStatus[] | null
    try {
      captured = await retry(command, current, discoveryWaits)
    } catch (cause) {
      if (!current()) return
      ctx.feedback.setError(formatError(cause))
      throw cause
    }
    if (!current() || !captured) return
    ctx.summaryRecovery.recoveredJobsRef.current.clear()
    for (const status of captured) {
      if (status.action !== 'chat') {
        ctx.summaryRecovery.recoveredJobsRef.current.set(status.jobId, status)
        if (status.action === 'summary') ctx.summaryRecovery.unresolvedSummaryJobsRef.current.set(status.jobId, status.sessionId)
      }
      publish(status)
    }
    ctx.summaryRecovery.discoveryPendingRef.current = false
    if (reconciliationStarted) startCapturedJobPolls()
  }

  function startCapturedJobPolls() {
    if (!active) return
    const captured = new Map<string, Observer['status']>(ctx.summaryRecovery.recoveredJobsRef.current)
    ctx.summaryRecovery.recoveredJobsRef.current.clear()
    for (const [jobId, sessionId] of ctx.summaryRecovery.unresolvedSummaryJobsRef.current) {
      captured.set(jobId, { jobId, sessionId, action: 'summary' })
    }
    for (const status of captured.values()) {
      if (observers.has(status.jobId)) continue
      const observer: Observer = { status, stopped: false, waits: new Set() }
      observers.set(status.jobId, observer)
      void poll(observer).finally(() => stop(observer))
    }
  }

  function blocks(sessionId: string) {
    return ctx.summaryRecovery.discoveryPendingRef.current
      || Array.from(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.values()).includes(sessionId)
  }

  function finish(jobId: string, sessionId: string, flush: boolean) {
    ctx.summaryRecovery.unresolvedSummaryJobsRef.current.delete(jobId)
    if (blocks(sessionId)) return
    if (flush && ctx.session.activeSessionIdRef.current !== sessionId) return
    const blocked = ctx.summaryRecovery.blockedSaveSessionIdsRef.current.delete(sessionId)
    if (flush && blocked) void ctx.saveNoteNow({ manageBusy: false })
  }

  async function reload(sessionId: string, observer: Observer): Promise<Entry | null> {
    try {
      const canonical = await retry(() => openSessionNoteState(sessionId), () => alive(observer), observer.waits)
      if (!alive(observer) || !canonical) return null
      if (canonical.session.id !== sessionId || canonical.noteEntry.sessionId !== sessionId) {
        ctx.feedback.setError('Recovered Summary returned an unexpected Session or Note Entry.')
        return null
      }
      return canonical.noteEntry
    } catch (cause) {
      if (alive(observer)) ctx.feedback.setError(formatError(cause))
      return null
    }
  }

  async function poll(observer: Observer) {
    let failures = 0
    while (alive(observer)) {
      await wait(observer.waits)
      if (!alive(observer)) return
      let status: GenerationJobStatus
      try {
        status = await getAiActionJobStatus(observer.status.jobId)
        if (!alive(observer)) return
        if (status.jobId !== observer.status.jobId || status.sessionId !== observer.status.sessionId || status.action !== observer.status.action) {
          throw new Error('Generation job status returned an unexpected Session or action.')
        }
      } catch (cause) {
        if (!alive(observer)) return
        if (++failures < MAX_ATTEMPTS) continue
        ctx.feedback.setError(formatError(cause))
        return
      }
      failures = 0
      publish(status)
      if (generationIsActive(status)) continue
      const sessionId = ctx.summaryRecovery.unresolvedSummaryJobsRef.current.get(status.jobId)
      if (sessionId && status.state === 'completed') {
        const version = (reloadVersions.get(sessionId) ?? 0) + 1
        reloadVersions.set(sessionId, version)
        const entry = await reload(sessionId, observer)
        if (!alive(observer) || !entry) return
        if (reloadVersions.get(sessionId) === version) {
          if (ctx.session.activeSessionIdRef.current === sessionId && ctx.session.noteEntryIdRef.current === entry.id) {
            apply(entry)
            ctx.summaryRecovery.completedSummaryEntriesRef.current.delete(sessionId)
          } else if (ctx.summaryRecovery.openingSessionIdRef.current === sessionId) {
            ctx.summaryRecovery.completedSummaryEntriesRef.current.set(sessionId, entry)
          }
        }
      }
      if (!alive(observer)) return
      if (sessionId) finish(status.jobId, sessionId, status.state !== 'completed')
      if (status.state === 'failed' && status.errorMessage) ctx.feedback.setError(status.errorMessage)
      else if (status.state === 'cancelled') ctx.feedback.setNotice('Generation cancelled')
      else if (status.state === 'completed') ctx.feedback.setNotice('Generation finished')
      return
    }
  }

  return {
    captureActiveJobs,
    reconcileActiveJobs: () => { reconciliationStarted = true; startCapturedJobPolls(); return Promise.resolve() },
    activate: () => { active = true },
    dispose: () => {
      active = false
      epoch += 1
      for (const observer of observers.values()) stop(observer)
      for (const cancel of discoveryWaits) cancel()
    },
  }
}
