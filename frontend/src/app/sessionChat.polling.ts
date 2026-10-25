import { getAiActionJobStatus, type ChatRef, type GenerationJobStatus } from '../tauri'
import { sameReference } from './sessionChat.workspaces'
import { chatIsWorking } from './sessionChat.types'
import { formatError } from '../ui/format'

// Backend JobStore status remains available when a webview loses its Channel.
export function createChatPolling(
  accept: (status: GenerationJobStatus) => void,
  refresh: (reference: ChatRef) => Promise<void>,
  report: (reference: ChatRef, error: string) => void,
) {
  const polls = new Map<string, { timer: ReturnType<typeof setTimeout> | null; stopped: boolean; failures: number }>()
  function stop(jobId: string) {
    const poll = polls.get(jobId)
    if (!poll) return
    poll.stopped = true
    if (poll.timer) clearTimeout(poll.timer)
    polls.delete(jobId)
  }
  function watch(status: GenerationJobStatus) {
    if (!status.chat?.reference || status.action !== 'chat' || !chatIsWorking(status) || polls.has(status.jobId)) return
    const reference = status.chat.reference
    const poll = { timer: null as ReturnType<typeof setTimeout> | null, stopped: false, failures: 0 }
    polls.set(status.jobId, poll)
    async function tick() {
      try {
        const next = await getAiActionJobStatus(status.jobId)
        if (poll.stopped) return
        if (next.jobId !== status.jobId || next.sessionId !== status.sessionId || next.action !== 'chat' || !sameReference(next.chat?.reference, reference)) {
          throw new Error('Chat job status returned an unexpected conversation.')
        }
        poll.failures = 0
        accept(next)
        if (!chatIsWorking(next)) {
          stop(next.jobId)
          await refresh(reference)
          return
        }
      } catch (cause) {
        if (poll.stopped) return
        if (++poll.failures >= 3) {
          stop(status.jobId)
          report(reference, `Chat recovery is unavailable. Reopen the Session to retry status recovery. ${formatError(cause)}`)
          return
        }
      }
      if (!poll.stopped) poll.timer = setTimeout(() => { void tick() }, 1000)
    }
    poll.timer = setTimeout(() => { void tick() }, 1000)
  }
  return { watch, stop, dispose: () => { for (const id of polls.keys()) stop(id) } }
}
