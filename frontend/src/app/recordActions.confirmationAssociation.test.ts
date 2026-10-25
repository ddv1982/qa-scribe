import { stageOrigin } from './proposalStage.testSupport'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { draftFixture, findingFixture } from '../test/fixtures'
import { createRecordActionCoordination } from './recordActions.coordination'
import type { RecordPersistenceContext } from './recordPersistence'
import { editorValue, recordWriteGuard } from './recordWriteGuards'
import { cleanupControllerTest, deferred, setupControllerTest } from './useAppController.testHarness'

type Kind = 'finding' | 'draft'
const kinds = ['finding', 'draft'] as const
beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

async function subject(kind: Kind, superseded = false) {
  const a = kind === 'finding' ? findingFixture({ title: 'A' }) : draftFixture({ title: 'A' })
  const b = { ...a, title: 'B' }
  const table = kind === 'finding' ? 'findings' : 'drafts'
  const base = await recordWriteGuard(a, table)
  const confirmed = await recordWriteGuard(b, table)
  const stage = { origin: stageOrigin(kind, a.id, 'completed-stage', a.sessionId), id: 'completed-stage', before: editorValue(a), after: editorValue(b), storedBaseToken: base.expectedStoredBase }
  const ctx: RecordPersistenceContext = {
    session: { activeSessionIdRef: { current: a.sessionId } },
    records: {
      draftsRef: { current: [] }, findingsRef: { current: [] }, savedDraftsRef: { current: [] }, savedFindingsRef: { current: [] },
      dirtyDraftIdsRef: { current: new Set() }, dirtyFindingIdsRef: { current: new Set() },
      setDrafts: vi.fn(), setFindings: vi.fn(), setTestwareDraftCount: vi.fn(), setFindingCount: vi.fn(),
    },
    importedAttachments: { register: vi.fn(), remember: vi.fn(), pending: () => [], clear: vi.fn(), forget: vi.fn() },
    feedback: { setError: vi.fn(), setNotice: vi.fn(), setBusyAction: vi.fn() },
    materializeInlineImages: async document => ({ document, importedAttachmentIds: [] }),
    cleanupMaterializedAttachments: async () => true,
  }
  const c = createRecordActionCoordination(ctx)
  const generation = 'aiRunId' in a ? c.reserveDraftIntent(a.id, 'save', a) : c.reserveFindingIntent(a.id, 'save', a)
  if (superseded) {
    if ('aiRunId' in a) c.reserveDraftIntent(a.id, 'discard', a)
    else c.reserveFindingIntent(a.id, 'discard', a)
  }
  c.bindStage(kind, a.id, a.sessionId, stage)
  const key = `${kind}:${a.id}`
  const source = c.latestWriteGuards.get(key)!
  const intent = kind === 'finding' ? c.findingIntents.get(a.id)! : c.draftIntents.get(a.id)!
  const confirm = (record = b) => 'aiRunId' in record
    ? c.confirmedWrite({ record, kind: 'draft', guard: source, generation })
    : c.confirmedWrite({ record, kind: 'finding', guard: source, generation })
  return { a, b, c, ctx, key, stage, source, intent, confirmed, confirm }
}

function holdHash(index: number, failure?: Error) {
  const reached = deferred<void>()
  const release = deferred<void>()
  const digest = crypto.subtle.digest.bind(crypto.subtle)
  let calls = 0
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    const hold = ++calls === index
    const hash = await digest(algorithm, data)
    if (hold) {
      reached.resolve()
      await release.promise
      if (failure) throw failure
    }
    return hash
  })
  return { reached, release }
}

it.each(kinds.flatMap(kind => (['resolve', 'reject'] as const).map(outcome => ({ kind, outcome }))))(
  '$kind retires only its association before the restore hash can $outcome', async ({ kind, outcome }) => {
    const s = await subject(kind, true)
    const otherKey = `${kind}:other-record`
    const otherStage = { ...s.stage, id: 'other-stage', origin: stageOrigin(kind, 'other-record', 'other-stage', s.a.sessionId) }
    s.c.bindStage(kind, 'other-record', s.a.sessionId, otherStage)
    const otherGuard = s.c.latestWriteGuards.get(otherKey)
    expect(otherGuard).toEqual({ sessionId: s.a.sessionId, expectedStoredBase: s.stage.storedBaseToken, origin: { kind: 'proposal', stageId: 'other-stage' } })
    s.ctx.session.activeSessionIdRef.current = 'another-active-session'
    const boundary = holdHash(2, outcome === 'reject' ? new Error('restore hash failed') : undefined)
    const pending = s.confirm()
    await boundary.reached.promise
    const lease = s.c.latestWriteGuards.get(s.key)
    expect(lease).toEqual(s.confirmed)
    expect(lease).not.toBe(s.source)
    expect(s.c.proposalStages.has(s.key)).toBe(false)
    expect(s.c.proposalStages.get(otherKey)).toBe(otherStage)
    expect(s.c.latestWriteGuards.get(otherKey)).toBe(otherGuard)
    expect(s.intent.restore).toBe(s.a)
    expect(s.intent.expected).toBeUndefined()
    boundary.release.resolve()
    if (outcome === 'reject') {
      await expect(pending).rejects.toThrow('restore hash failed')
      expect(s.intent.expected).toBeUndefined()
    } else {
      await pending
      expect(s.intent.expected?.origin).toEqual({ kind: 'compensation', stageId: s.stage.id, restoredBase: s.source.expectedStoredBase })
    }
    expect(s.c.latestWriteGuards.get(s.key)).toBe(lease)
    expect(s.c.proposalStages.has(s.key)).toBe(false)
    expect(s.intent.restore).toBe(s.a)
    expect(s.ctx.feedback.setError).not.toHaveBeenCalled()
    expect(s.ctx.records.setDrafts).not.toHaveBeenCalled()
    expect(s.ctx.records.setFindings).not.toHaveBeenCalled()
  },
)

it.each(kinds)('%s preserves the association and Proposal pin when the first hash rejects', async kind => {
  const s = await subject(kind)
  vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('saved hash failed'))
  await expect(s.confirm()).rejects.toThrow('saved hash failed')
  expect(s.c.proposalStages.get(s.key)).toBe(s.stage)
  expect(s.c.latestWriteGuards.get(s.key)).toBe(s.source)
  expect(s.intent.expected).toBeUndefined()
})

it.each(kinds.flatMap(kind => (['association', 'guard'] as const).map(replacement => ({ kind, replacement }))))(
  '$kind cannot retire a replacement $replacement during the first hash', async ({ kind, replacement }) => {
    const s = await subject(kind)
    const boundary = holdHash(1)
    const pending = s.confirm()
    await boundary.reached.promise
    const association = replacement === 'association' ? { ...s.stage } : s.stage
    const guard = replacement === 'guard' ? { ...s.source } : s.source
    s.c.proposalStages.set(s.key, association)
    s.c.latestWriteGuards.set(s.key, guard)
    expect(guard.expectedStoredBase).toBe(s.source.expectedStoredBase)
    boundary.release.resolve()
    await pending
    expect(s.c.proposalStages.get(s.key)).toBe(association)
    expect(s.c.latestWriteGuards.get(s.key)).toEqual(s.confirmed)
  },
)

it.each(kinds)('%s requires the dispatched stage ID as well as the captured association', async kind => {
  const s = await subject(kind)
  const unrelated = { ...s.stage, id: 'unrelated-stage' }
  s.c.proposalStages.set(s.key, unrelated)
  await s.confirm()
  expect(s.c.proposalStages.get(s.key)).toBe(unrelated)
  expect(s.c.latestWriteGuards.get(s.key)).toEqual(s.confirmed)
})

it.each(kinds)('%s cannot retire an association for a different confirmed Session', async kind => {
  const s = await subject(kind)
  await s.confirm({ ...s.b, sessionId: 'different-session' })
  expect(s.c.proposalStages.get(s.key)).toBe(s.stage)
  expect(s.c.latestWriteGuards.get(s.key)?.sessionId).toBe('different-session')
  expect(s.intent.restore).toBe(s.a)
})

it.each(kinds)('%s matching acceptance installs the canonical restore and null-stage compensation with one hash', async kind => {
  const s = await subject(kind)
  const digest = vi.spyOn(crypto.subtle, 'digest')
  await s.confirm()
  const accepted = kind === 'finding' ? s.c.findingIntents.get(s.b.id) : s.c.draftIntents.get(s.b.id)
  expect(accepted?.restore).toBe(s.b)
  expect(accepted?.expected).toEqual({ ...s.confirmed, origin: { kind: 'compensation', stageId: null, restoredBase: s.confirmed.expectedStoredBase } })
  expect(digest).toHaveBeenCalledOnce()
  expect(s.c.proposalStages.has(s.key)).toBe(false)
})

it.each(kinds)('%s binding preserves an older editor pin after a newer server snapshot', async kind => {
  const s = await subject(kind)
  s.c.releaseStage(kind, s.a.id, s.source, s.stage.id)
  const pinned = s.c.latestWriteGuards.get(s.key)!
  const newer = { ...s.stage, id: 'newer-snapshot', storedBaseToken: s.confirmed.expectedStoredBase, origin: { ...s.stage.origin, stageId: 'newer-snapshot' } }
  s.c.bindStage(kind, s.a.id, s.a.sessionId, newer)
  expect(s.c.latestWriteGuards.get(s.key)?.expectedStoredBase).toBe(pinned.expectedStoredBase)
  expect(s.c.latestWriteGuards.get(s.key)?.expectedStoredBase).not.toBe(newer.storedBaseToken)
  expect(s.c.proposalStages.get(s.key)).toBe(newer)
})

it.each(kinds)('%s stale release leaves both association and write guard unchanged', async kind => {
  const s = await subject(kind)
  const association = s.c.proposalStages.get(s.key)
  const guard = s.c.latestWriteGuards.get(s.key)
  s.c.releaseStage(kind, s.a.id, s.confirmed, 'unbound-competitor')
  expect(s.c.proposalStages.get(s.key)).toBe(association)
  expect(s.c.latestWriteGuards.get(s.key)).toBe(guard)
  expect(() => s.c.bindStage(kind, s.a.id, s.a.sessionId, { ...s.stage, id: 'competitor', origin: { ...s.stage.origin, stageId: 'competitor' } })).toThrow('already bound')
  expect(s.c.proposalStages.get(s.key)).toBe(association)
  expect(s.c.latestWriteGuards.get(s.key)).toBe(guard)
})

it.each(kinds)('%s confirmation notifies the dispatched origin after association replacement', async kind => {
  const s = await subject(kind)
  const changed = vi.fn(); s.c.subscribeChanges(changed)
  const replacement = { ...s.stage, id: 'replacement-stage', origin: { ...s.stage.origin, stageId: 'replacement-stage', proposalId: 'replacement-proposal', reference: { ...s.stage.origin.reference, draftId: 'other-conversation' } } }
  s.c.proposalStages.set(s.key, replacement)
  if ('aiRunId' in s.b) {
    const write = { record: s.b, kind: 'draft' as const, guard: s.source, generation: 1, stageOrigin: s.stage.origin }
    await s.c.confirmedWrite(write)
  } else {
    const write = { record: s.b, kind: 'finding' as const, guard: s.source, generation: 1, stageOrigin: s.stage.origin }
    await s.c.confirmedWrite(write)
  }
  expect(changed).toHaveBeenCalledWith(kind, s.a.id, 'saved', s.stage.origin)
  expect(changed).not.toHaveBeenCalledWith(kind, s.a.id, 'saved', replacement.origin)
  expect(s.c.proposalStages.get(s.key)).toBe(replacement)
})
