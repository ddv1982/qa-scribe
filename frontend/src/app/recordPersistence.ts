import type { RecordWorkspace, SessionWorkspace, WorkflowFeedback } from './types'
import type { ImportedAttachments } from './importedAttachments'
import type { InlineImageMaterialization } from './attachmentActions'
import type { RichEditorDocument } from '../editor/editorDocument'
import type { Draft, Finding, StageOrigin } from '../bindings'
import { editorKey, editorValue } from './recordWriteGuards'
import { formatError } from '../ui/format'
import { createRecordActionCoordination } from './recordActions.coordination'
import { createDraftPersistence } from './recordPersistence.drafts'
import { createFindingPersistence } from './recordPersistence.findings'
import { useStableCapability } from './useStableCapability'

export type RecordPersistenceContext = {
  importedAttachments: ImportedAttachments
  session: Pick<SessionWorkspace, 'activeSessionIdRef'>
  records: Pick<RecordWorkspace, 'dirtyDraftIdsRef' | 'dirtyFindingIdsRef' | 'draftsRef' | 'findingsRef' | 'savedDraftsRef' | 'savedFindingsRef' | 'setDrafts' | 'setFindings' | 'setTestwareDraftCount' | 'setFindingCount'>
  feedback: WorkflowFeedback
  materializeInlineImages: (document: RichEditorDocument, options?: { entryId?: string | null; isCurrent?: () => boolean }) => Promise<InlineImageMaterialization>
  cleanupMaterializedAttachments: (attachmentIds: string[]) => Promise<boolean>
}

export type SavedRecord = Finding | Draft
export type ProposalSaveResult =
  | { kind: 'saved'; record: SavedRecord }
  | { kind: 'superseded'; committed: SavedRecord | null }
  | { kind: 'conflict'; current: SavedRecord }
  | { kind: 'failed'; message: string }
  | { kind: 'unconfirmed'; message: string }
export type ExactProposalSave = { record: SavedRecord; origin: StageOrigin; isCurrent: () => boolean }
export type ExactSaveOperation = {
  isCurrent: (generation: number) => boolean
  dispatched: boolean
  acknowledged?: SavedRecord
  settled?: SavedRecord
  conflict?: SavedRecord
  message?: string
}

type RecordPersistResult = 'saved' | 'superseded' | 'failed'
type CanonicalTicket = {
  stillOwnsTarget: () => boolean
  runRaw: () => Promise<RecordPersistResult>
  complete: () => void
}
type ForcedPass = {
  sessionId: string | null
  completion: Promise<boolean>
  canonical: CanonicalTicket[]
  rescanRequested: boolean
}

export function createRecordPersistence(ctx: RecordPersistenceContext) {
  let activePass: ForcedPass | null = null
  const coordination = createRecordActionCoordination(ctx, () => activePass !== null)
  const draftActions = createDraftPersistence(ctx, coordination)
  const findingActions = createFindingPersistence(ctx, coordination)

  function persistDraft(record: Draft): Promise<RecordPersistResult> {
    if (!activePass) return draftActions.persistDraft(record)
    return joinOrdinarySave(activePass, 'draft', record.id, record.sessionId)
  }

  function persistFinding(record: Finding): Promise<RecordPersistResult> {
    if (!activePass) return findingActions.persistFinding(record)
    return joinOrdinarySave(activePass, 'finding', record.id, record.sessionId)
  }

  async function persistProposalExact(command: ExactProposalSave, acknowledged?: SavedRecord): Promise<ProposalSaveResult> {
    const { record, origin } = command
    const kind = origin.record.kind === 'finding' ? 'finding' : 'draft'
    const key = `${kind}:${record.id}`
    const stage = coordination.proposalStages.get(key)
    const pinned = coordination.latestWriteGuards.get(key)
    const savedBase = (kind === 'finding' ? ctx.records.savedFindingsRef.current : ctx.records.savedDraftsRef.current).find(row => row.id === record.id)
    const generation = (kind === 'finding' ? coordination.findingIntents : coordination.draftIntents).get(record.id)?.generation ?? 0
    if (activePass || coordination.hasPendingRecordCompensations()) return { kind: 'failed', message: 'Wait for pending record writes, then retry Update.' }
    if (acknowledged && (acknowledged.id !== record.id || acknowledged.sessionId !== record.sessionId
      || editorKey(editorValue(acknowledged)) !== editorKey(editorValue(record)))) return { kind: 'failed', message: 'The confirmed record differs from this proposal.' }
    if (!command.isCurrent() || !stage || stage.origin.proposalId !== origin.proposalId || stage.id !== origin.stageId
      || stage.origin.reference.draftId !== origin.reference.draftId || record.sessionId !== origin.reference.sessionId
      || origin.record.recordId !== record.id || editorKey(editorValue(record)) !== editorKey(stage.after)) {
      return { kind: 'superseded', committed: null }
    }
    const operation: ExactSaveOperation = {
      dispatched: false, acknowledged,
      isCurrent: reserved => reserved === generation + 1 && command.isCurrent()
        && (operation.acknowledged !== undefined || (coordination.proposalStages.get(key) === stage
          && coordination.latestWriteGuards.get(key) === pinned
          && (kind === 'finding' ? ctx.records.savedFindingsRef.current : ctx.records.savedDraftsRef.current).find(row => row.id === record.id) === savedBase)),
    }
    const result = await ('aiRunId' in record
      ? draftActions.persistDraft(record, operation)
      : findingActions.persistFinding(record, operation))
    if (operation.conflict) return { kind: 'conflict', current: operation.conflict }
    if (result === 'saved' && operation.settled) return { kind: 'saved', record: operation.settled }
    if (result === 'superseded') return { kind: 'superseded', committed: operation.acknowledged ?? null }
    return { kind: operation.dispatched || operation.acknowledged ? 'unconfirmed' : 'failed',
      message: operation.acknowledged
        ? 'The record save was acknowledged, but update completion failed. Your edits are retained. Select Update to check the saved result and retry cleanup.'
        : operation.message ?? 'Update could not finish. Your local changes are retained. Retry after reviewing the record.' }
  }

  function joinOrdinarySave(owner: ForcedPass, kind: 'draft' | 'finding', id: string, sessionId: string): Promise<RecordPersistResult> {
    if (owner.sessionId !== sessionId) return Promise.resolve('superseded')
    owner.rescanRequested = true
    return owner.completion.then(succeeded => {
      if (!succeeded) return 'failed'
      if (owner.sessionId !== sessionId || ctx.session.activeSessionIdRef.current !== sessionId) return 'superseded'
      const records = kind === 'draft' ? ctx.records.draftsRef.current : ctx.records.findingsRef.current
      const saved = kind === 'draft' ? ctx.records.savedDraftsRef.current : ctx.records.savedFindingsRef.current
      const dirty = kind === 'draft' ? ctx.records.dirtyDraftIdsRef.current : ctx.records.dirtyFindingIdsRef.current
      const intent = kind === 'draft' ? coordination.draftIntents.get(id) : coordination.findingIntents.get(id)
      if (intent?.kind === 'delete') return 'superseded'
      if (intent?.compensationPending) return 'failed'
      if (!records.some(record => record.id === id && record.sessionId === sessionId)
        || !saved.some(record => record.id === id && record.sessionId === sessionId)) return 'superseded'
      return dirty.has(id) ? 'failed' : 'saved'
    })
  }

  function canonicalize(record: Draft | Finding, storedBase: Draft | Finding, kind: 'draft' | 'finding', runRaw: () => Promise<RecordPersistResult>): Promise<void> {
    const owner = activePass
    if (!owner) return runRaw().then(() => undefined)
    const key = `${kind}:${record.id}`
    const intentFor = () => kind === 'draft' ? coordination.draftIntents.get(record.id) : coordination.findingIntents.get(record.id)
    const savedFor = () => (kind === 'draft' ? ctx.records.savedDraftsRef.current : ctx.records.savedFindingsRef.current).find(row => row.id === record.id)
    if (record.sessionId === owner.sessionId && ctx.session.activeSessionIdRef.current === owner.sessionId
      && storedBase.id === record.id && storedBase.sessionId === record.sessionId
      && !savedFor() && intentFor()?.kind !== 'delete'
      && !coordination.latestWriteGuards.has(key) && !coordination.proposalStages.has(key)) {
      if (kind === 'draft' && 'aiRunId' in storedBase) {
        ctx.records.savedDraftsRef.current = coordination.replaceRecord(ctx.records.savedDraftsRef.current, storedBase)
      } else if (kind === 'finding' && !('aiRunId' in storedBase)) {
        ctx.records.savedFindingsRef.current = coordination.replaceRecord(ctx.records.savedFindingsRef.current, storedBase)
      }
    }
    const intent = intentFor()
    const saved = savedFor()
    const pin = coordination.latestWriteGuards.get(key)
    const stage = coordination.proposalStages.get(key)
    owner.rescanRequested = true
    return new Promise<void>(complete => {
      owner.canonical.push({ runRaw, complete, stillOwnsTarget: () =>
        ctx.session.activeSessionIdRef.current === owner.sessionId && record.sessionId === owner.sessionId
        && intentFor() === intent && intentFor()?.kind !== 'delete' && savedFor() === saved
        && coordination.latestWriteGuards.get(key) === pin && coordination.proposalStages.get(key) === stage })
    })
  }

  async function drainCanonical(owner: ForcedPass): Promise<boolean> {
    let succeeded = true
    while (owner.canonical.length > 0) {
      const ticket = owner.canonical.shift()!
      try {
        if (ticket.stillOwnsTarget() && await ticket.runRaw() === 'failed') succeeded = false
      } finally { ticket.complete() }
    }
    return succeeded
  }

  async function runForcedPass(owner: ForcedPass): Promise<boolean> {
    let failed = false
    let allSaved = true
    const sameSession = () => ctx.session.activeSessionIdRef.current === owner.sessionId
    try {
      await coordination.waitForPendingRecordWrites()
      if (!sameSession()) return false
      do {
        owner.rescanRequested = false
        while (owner.canonical.length > 0) {
          if (!await drainCanonical(owner)) failed = true
        }
        if (!sameSession()) return false
        const targets = [
          ...Array.from(ctx.records.dirtyDraftIdsRef.current, id => ({ kind: 'draft' as const, id })),
          ...Array.from(ctx.records.dirtyFindingIdsRef.current, id => ({ kind: 'finding' as const, id })),
        ]
        for (const target of targets) {
          while (owner.canonical.length > 0) {
            if (!await drainCanonical(owner)) failed = true
          }
          if (!sameSession()) return false
          if (failed) break
          let result: RecordPersistResult
          if (target.kind === 'draft') {
            if (!ctx.records.dirtyDraftIdsRef.current.has(target.id)) continue
            const row = ctx.records.draftsRef.current.find(record => record.id === target.id && record.sessionId === owner.sessionId)
            if (!row) { failed = true; break }
            result = await draftActions.persistDraft(row)
          } else {
            if (!ctx.records.dirtyFindingIdsRef.current.has(target.id)) continue
            const row = ctx.records.findingsRef.current.find(record => record.id === target.id && record.sessionId === owner.sessionId)
            if (!row) { failed = true; break }
            result = await findingActions.persistFinding(row)
          }
          if (!sameSession()) return false
          failed = result === 'failed'
          allSaved = result === 'saved' && allSaved
        }
        while (owner.canonical.length > 0) {
          if (!await drainCanonical(owner)) failed = true
        }
        if (!sameSession()) return false
      } while (!failed && owner.rescanRequested)
      if (!failed && allSaved) ctx.feedback.setNotice('Pending record edits saved')
      return !failed
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
      return false
    } finally {
      for (const ticket of owner.canonical.splice(0)) ticket.complete()
      if (activePass === owner) {
        activePass = null
        coordination.events.onChanged()
      }
    }
  }

  function saveDirtyRecordsNow(): Promise<boolean> {
    const sessionId = ctx.session.activeSessionIdRef.current
    if (activePass) return activePass.sessionId === sessionId ? activePass.completion : Promise.resolve(false)
    const owner: ForcedPass = {
      sessionId, canonical: [], rescanRequested: false,
      completion: Promise.resolve().then(() => runForcedPass(owner)),
    }
    activePass = owner
    coordination.events.onChanged()
    return owner.completion
  }

  function retryWhenAdmitted(retry: () => Promise<boolean>): Promise<boolean> {
    if (activePass) return waitThenRetry(retry)
    const finish = coordination.beginRecordOperation()
    return retry().finally(finish)
  }

  async function waitThenRetry(retry: () => Promise<boolean>): Promise<boolean> {
    while (activePass) await activePass.completion
    return retryWhenAdmitted(retry)
  }

  return {
    coordination, saveDirtyRecordsNow, persistProposalExact,
    drafts: { persistDraft, canonicalizeGeneratedDraft: (record: Draft, storedBase: Draft) => canonicalize(record, storedBase, 'draft', () => draftActions.canonicalizeGeneratedDraft(record, storedBase)) },
    findings: { persistFinding, canonicalizeGeneratedFinding: (record: Finding, storedBase: Finding) => canonicalize(record, storedBase, 'finding', () => findingActions.canonicalizeGeneratedFinding(record, storedBase)) },
    retryPendingRecordCompensations: (sessionId: string) => retryWhenAdmitted(() => coordination.retryPendingRecordCompensations(sessionId)),
    retryAllPendingRecordCompensations: () => retryWhenAdmitted(coordination.retryAllPendingRecordCompensations),
  }
}

export type RecordPersistence = ReturnType<typeof createRecordPersistence>

export function useRecordPersistence(ctx: RecordPersistenceContext) {
  return useStableCapability(ctx, createRecordPersistence)
}
