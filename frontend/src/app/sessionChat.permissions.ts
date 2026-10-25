import { commands, getAiActionJobStatus, listActiveAiActionJobs, type ChatRef, type AiProvider, type GenerationJobStatus } from '../tauri'
import type { ChatPermissionDecision, ChatPermissionRequest } from '../bindings'
import { statusOwns } from './sessionChat.workspaces'
import { chatIsWorking, type ChatWorkspace, type SessionChatContext } from './sessionChat.types'
import { toCommandError } from '../ui/format'

type PermissionLedger = {
  jobId: string
  provider: AiProvider | null
  pending: ChatPermissionRequest | null
  attempted: Set<string>
  resolved: Set<string>
}

// Authority is ephemeral and belongs to one job, never to Chat persistence or
// a provider configuration. Hidden tokens remain available for response guards.
export function createChatPermissions(ctx: SessionChatContext, host: {
  active: () => ChatWorkspace | null
  current: (entry: ChatWorkspace) => boolean
  epoch: () => number
  publish: (entry: ChatWorkspace) => void
  report: (entry: ChatWorkspace, cause: unknown) => void
  observe: (status: GenerationJobStatus) => void
  refresh: (reference: ChatRef, current?: () => boolean) => Promise<void>
}) {
  const ledgers = new WeakMap<ChatWorkspace, PermissionLedger>()
  function ledger(entry: ChatWorkspace, jobId: string, aiRunId = entry.job?.aiRunId) {
    let value = ledgers.get(entry)
    if (!value || value.jobId !== jobId) {
      entry.permissionOperation = null
      value = { jobId, provider: entry.chat?.aiRuns.find(run => run.id === aiRunId)?.provider ?? null, pending: null, attempted: new Set(), resolved: new Set() }
      ledgers.set(entry, value)
    }
    return value
  }
  function filterStatus(entry: ChatWorkspace, status: GenerationJobStatus): GenerationJobStatus | null {
    if (!statusOwns(entry, status)) return null
    const state = ledger(entry, status.jobId, status.aiRunId)
    if (status.pendingPermission && state.provider && status.pendingPermission.provider !== state.provider) return null
    state.provider ??= status.pendingPermission?.provider ?? null
    state.pending = status.pendingPermission ?? null
    if (!['starting', 'running', 'cancelling'].includes(status.state)) {
      entry.permissionOperation = null
      state.pending = null
      state.attempted.clear()
      state.resolved.clear()
      return { ...status, pendingPermission: null }
    }
    const token = state.pending?.requestId
    return token && (state.attempted.has(token) || state.resolved.has(token))
      ? { ...status, pendingPermission: null } : status
  }
  function validStatus(status: GenerationJobStatus, entry: ChatWorkspace, jobId: string) {
    if (status.jobId !== jobId || !statusOwns(entry, status) || (status.pendingPermission && ledgers.get(entry)?.provider && status.pendingPermission.provider !== ledgers.get(entry)?.provider)) {
      throw new Error('Permission recovery returned an unexpected Chat job.')
    }
  }
  function needsRecovery(entry: ChatWorkspace): boolean {
    const state = ledgers.get(entry)
    const token = state?.pending?.requestId
    return Boolean(entry.job?.state === 'running' && state?.jobId === entry.job.jobId
      && token && state?.attempted.has(token) && !state.resolved.has(token)
      && !entry.permissionOperation)
  }
  function onDecidePermission(requestId: string, decision: ChatPermissionDecision, bound?: ChatWorkspace): Promise<void> {
    const entry = bound ?? host.active()
    if (!entry || !host.current(entry) || !['approve', 'approveAll', 'deny'].includes(decision)) return Promise.resolve()
    if (entry.permissionOperation) return entry.permissionOperation
    const job = entry.job
    const request = job?.pendingPermission
    if (!job || job.action !== 'chat' || job.sessionId !== entry.sessionId || job.state !== 'running'
      || !request || request.requestId !== requestId || !statusOwns(entry, job)) {
      return Promise.resolve()
    }
    if ((decision === 'approve' || decision === 'approveAll') && request.canApprove === false) return Promise.resolve()
    const state = ledger(entry, job.jobId)
    if (state.attempted.has(requestId) || state.resolved.has(requestId)) return Promise.resolve()
    const scopeCurrent = () => host.current(entry)
      && entry.job?.jobId === job.jobId
      && ledgers.get(entry) === state
    const stillCurrent = () => scopeCurrent() && entry.job?.state === 'running'
      && (!state.pending || (state.pending.requestId === requestId && state.pending.provider === request.provider))
    state.attempted.add(requestId)
    entry.job = { ...job, pendingPermission: null }
    entry.error = null
    ctx.feedback.setError(null)
    const operation = Promise.race([(async () => {
      try {
        const status = await commands.decideChatPermission({ jobId: job.jobId,
          sessionId: entry.sessionId, requestId, provider: request.provider, decision })
        if (!stillCurrent()) return
        if (status.jobId !== job.jobId || !statusOwns(entry, status)) return
        if (status.pendingPermission && status.pendingPermission.provider !== request.provider) return
        state.resolved.add(requestId)
        host.observe(status)
        if (!['starting', 'running', 'cancelling'].includes(status.state)) {
          await host.refresh(entry.reference, () => host.current(entry))
        }
      } catch (cause) {
        if (!stillCurrent()) return
        // A lost invoke response is not permission to replay. Only JobStore can
        // restore the original token, and only a new explicit click can retry it.
        try {
          const status = await getAiActionJobStatus(job.jobId)
          if (!stillCurrent()) return
          validStatus(status, entry, job.jobId)
          if (status.state === 'running' && status.pendingPermission?.requestId === requestId
            && status.pendingPermission.provider === request.provider) {
            state.attempted.delete(requestId)
            state.resolved.delete(requestId)
          }
          host.observe(status)
        } catch {
          // Keep attempted-token suppression when recovery itself is unavailable.
        }
        if (scopeCurrent() && (!state.pending || state.pending.requestId === requestId)) host.report(entry, cause)
      }
    })(), entry.retirement]).finally(() => {
      if (entry.permissionOperation !== operation) return
      entry.permissionOperation = null
      // This only releases the local operation indicator. Foreign responses
      // never reach observe or refresh, even if the Session was reselected.
      if (host.current(entry)) host.publish(entry)
    })
    entry.permissionOperation = operation
    host.publish(entry)
    return operation
  }
  async function onRecheck(bound?: ChatWorkspace): Promise<void> {
    const entry = bound ?? host.active()
    if (!entry || !host.current(entry)) return
    const jobId = entry.job?.jobId
    const provider = entry.job ? ledger(entry, entry.job.jobId).provider : null
    const current = () => host.current(entry)
      && entry.job?.jobId === jobId
    try {
      if (jobId) {
        let status: GenerationJobStatus | null = null
        try {
          status = await getAiActionJobStatus(jobId)
        } catch (cause) {
          if (!current()) return
          if (toCommandError(cause).kind !== 'notFound'
            || (entry.pendingStart?.state !== 'uncertain' && chatIsWorking(entry.job))) {
            host.report(entry, cause)
            return
          }
        }
        if (!current()) return
        if (status) {
          validStatus(status, entry, jobId)
          const state = ledger(entry, jobId)
          const token = status.pendingPermission?.requestId
          if (!entry.permissionOperation && token && !state.resolved.has(token)
            && status.pendingPermission?.provider === provider) state.attempted.delete(token)
          host.observe(status)
        }
      }
      if (!current()) return
      await host.refresh(entry.reference, current)
      if (!current()) return
      let recoveredJob: GenerationJobStatus | null = null
      if ((entry.pendingStart || entry.chat?.messages.some(message => message.status === 'running')) && !chatIsWorking(entry.job)) {
        const jobs = await listActiveAiActionJobs()
        if (!current()) return
        const active = jobs.filter(job => statusOwns(entry, job) && chatIsWorking(job))
        if (active.length !== 1) throw new Error('The running response could not be located. Recheck status to try again.')
        recoveredJob = active[0]
        validStatus(recoveredJob, entry, recoveredJob.jobId)
        if (recoveredJob.pendingPermission && provider && recoveredJob.pendingPermission.provider !== provider) throw new Error('Permission recovery returned an unexpected provider.')
      }
      if (ctx.refreshProviderStatus) await ctx.refreshProviderStatus()
      if (!current()) return
      entry.error = (recoveredJob ?? entry.job)?.errorMessage ?? null
      ctx.feedback.setError(entry.error)
      if (recoveredJob) { host.observe(recoveredJob); entry.pendingStart = null; host.publish(entry) }
      else host.publish(entry)
    } catch (cause) {
      if (current()) host.report(entry, cause)
    }
  }
  return { filterStatus, needsRecovery, onDecidePermission, onRecheck }
}
