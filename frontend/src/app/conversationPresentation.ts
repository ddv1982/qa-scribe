import { captureRecordContext } from './sessionChat.context'
import { formatDateTime } from '../ui/format'
import type { RecordWorkspace } from './types'
import type { ConversationAttention } from './sessionChat.workspaces'
import type { RecordLoadState } from './useRecordHydration'
import type { ChatHistoryEntry, ChatRef, ConversationOwner, ConversationRecord } from '../bindings'
import type { ChatSnapshot } from './sessionChat.types'

/** What an Ask AI panel works on: a record, or a test run it only reads. */
export type AskAiOwner = Exclude<ConversationOwner, { kind: 'notes' }>
export type TestRunOwner = Extract<ConversationOwner, { kind: 'test_run' }>
/** The test run on the run screen, as the Ask AI panel names it. */
export type ShownTestRun = { sessionId: string; runId: string; draftTitle: string | null; createdAt: string | null; error: string | null; retry: () => void }
export type RecordRevealRequest = { requestId: string; sessionId: string; record: ConversationRecord }
export type SourcePresentation =
  | { kind: 'loading' }
  | { kind: 'available'; title: string; unsaved: boolean }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string }

/** A test run is a source while the run screen shows it; the panel names it by draft title and start. */
export function presentRun(owner: TestRunOwner, shown: ShownTestRun | null): SourcePresentation {
  if (shown?.sessionId !== owner.sessionId || shown.runId !== owner.runId) return { kind: 'unavailable' }
  if (shown.error) return { kind: 'error', message: shown.error }
  return shown.draftTitle !== null && shown.createdAt !== null
    ? { kind: 'available', title: `${shown.draftTitle}, ${formatDateTime(shown.createdAt)}`, unsaved: false } : { kind: 'loading' }
}

export function sameRecord(a: ConversationRecord | null | undefined, b: ConversationRecord | null | undefined) {
  return Boolean(a && b && a.kind === b.kind && a.recordId === b.recordId)
}
export function sameOwner(a: ConversationOwner | null | undefined, b: ConversationOwner | null | undefined) {
  if (!a || !b || a.sessionId !== b.sessionId) return false
  if (a.kind === 'record') return b.kind === 'record' && sameRecord(a.record, b.record)
  if (a.kind === 'test_run') return b.kind === 'test_run' && a.runId === b.runId
  return b.kind === 'notes'
}
export function attentionReasons(state: ChatSnapshot): string[] {
  const reasons: string[] = []
  if (state.job?.pendingPermission || state.permissionRecoveryPending) reasons.push('Tool permission waiting')
  if (state.working || state.responseStarting) reasons.push('Response in progress')
  if (state.inputRecoveryPending) reasons.push('Recheck required')
  if (state.error) reasons.push(state.dirty ? 'Input save failed' : state.error)
  if (state.imageFailures.length) reasons.push('Image recovery required')
  if (state.chat?.proposals?.some(proposal => proposal.state.kind === 'staged')) reasons.push('Prepared changes waiting')
  if (state.chat?.messages.some(m => ['failed', 'interrupted', 'cancelled'].includes(m.status))) reasons.push('Unfinished turn')
  return reasons
}
export type UnfinishedConversation = {
  reference: ChatRef
  owner: AskAiOwner
  reason: string
  origin?: import('../bindings').StageOrigin
}
export function unfinishedConversations(rows: ChatHistoryEntry[], attention: ConversationAttention[]): UnfinishedConversation[] {
  const retained = new Map(rows.map(row => [referenceKey(row.reference), row]))
  const localByReference = new Map(attention.map(local => [referenceKey(local.reference), local]))
  for (const local of attention) {
    if (!local.owner || retained.has(referenceKey(local.reference))) continue
    retained.set(referenceKey(local.reference), { reference: local.reference, owner: local.owner, createdAt: '', lastActiveAt: '',
      lastActiveOrder: 0, preview: '', archived: false, submission: null, hasContent: false, lastTurnStatus: null, unresolvedStages: [] })
  }
  return [...retained.values()].sort((a, b) => b.lastActiveOrder - a.lastActiveOrder).flatMap(row => {
    const local = localByReference.get(referenceKey(row.reference))?.snapshot
    const fresh = Boolean(local?.chat && local.chat.lastActiveOrder >= row.lastActiveOrder)
    const stages = fresh ? stageOrigins(row.reference, local!) : [...new Map([
      ...row.unresolvedStages, ...(local ? stageOrigins(row.reference, local) : []),
    ].map(origin => [origin.stageId, origin])).values()]
    const reasons = local ? attentionReasons(local) : []
    if (!fresh && ['running', 'failed', 'interrupted', 'cancelled'].includes(row.lastTurnStatus ?? '')) reasons.push('Unfinished turn')
    if (stages.length) reasons.push('Prepared changes waiting')
    if (!reasons.length) return []
    const reason = [...new Set(reasons)].join(' · ')
    return row.owner.kind !== 'notes' ? [{ reference: row.reference, owner: row.owner, reason }]
      : stages.map(origin => ({ reference: row.reference, owner: { kind: 'record' as const, sessionId: row.reference.sessionId, record: origin.record }, reason: 'Prepared changes from Notes', origin }))
  })
}
export function referenceKey(reference: ChatRef) { return JSON.stringify([reference.sessionId, reference.draftId]) }

export function stageOrigins(reference: ChatRef, snapshot: ChatSnapshot) {
  return (snapshot.chat?.proposals ?? []).flatMap(proposal => proposal.state.kind === 'staged' && proposal.target.kind !== 'session'
    ? [{ reference, proposalId: proposal.id, stageId: proposal.state.stage.id, record: { kind: proposal.target.kind, recordId: proposal.target.snapshot.recordId } }] : [])
}

export function captureAvailableRecordContext(sessionId: string, record: ConversationRecord, records: RecordWorkspace, source: { state: RecordLoadState; ids: ReadonlySet<string> | null }) {
  if (source.state !== 'ready') throw new Error('Reload the original source before sending a new message.')
  if (!source.ids?.has(record.recordId)) throw new Error('The original source is no longer available.')
  return captureRecordContext(sessionId, record, records)
}
