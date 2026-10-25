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

async function subject(kind: Kind) {
  const a = kind === 'finding' ? findingFixture({ title: 'A' }) : draftFixture({ title: 'A' })
  const b = { ...a, title: 'B' }
  const table = kind === 'finding' ? 'findings' : 'drafts'
  const base = await recordWriteGuard(a, table)
  const confirmed = await recordWriteGuard(b, table)
  const stage = { id: 'completed-stage', before: editorValue(a), after: editorValue(b), storedBaseToken: base.expectedStoredBase }
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
  if ('aiRunId' in a) c.reserveDraftIntent(a.id, 'save', a)
  else c.reserveFindingIntent(a.id, 'save', a)
  c.bindStage(kind, a.id, a.sessionId, stage)
  const key = `${kind}:${a.id}`
  const source = c.latestWriteGuards.get(key)!
  const intent = kind === 'finding' ? c.findingIntents.get(a.id)! : c.draftIntents.get(a.id)!
  return { a, b, c, ctx, key, stage, source, intent, confirmed }
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
    const s = await subject(kind)
    const otherKey = `${kind}:other-record`
    s.c.bindStage(kind, 'other-record', s.a.sessionId, s.stage)
    const otherGuard = s.c.latestWriteGuards.get(otherKey)
    s.ctx.session.activeSessionIdRef.current = 'another-active-session'
    const boundary = holdHash(2, outcome === 'reject' ? new Error('restore hash failed') : undefined)
    const pending = s.c.confirmedWrite(s.b, kind, s.source)
    await boundary.reached.promise
    const lease = s.c.latestWriteGuards.get(s.key)
    expect(lease).toEqual(s.confirmed)
    expect(lease).not.toBe(s.source)
    expect(s.c.proposalStages.has(s.key)).toBe(false)
    expect(s.c.proposalStages.get(otherKey)).toBe(s.stage)
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
  await expect(s.c.confirmedWrite(s.b, kind, s.source)).rejects.toThrow('saved hash failed')
  expect(s.c.proposalStages.get(s.key)).toBe(s.stage)
  expect(s.c.latestWriteGuards.get(s.key)).toBe(s.source)
  expect(s.intent.expected).toBeUndefined()
})

it.each(kinds.flatMap(kind => (['association', 'guard'] as const).map(replacement => ({ kind, replacement }))))(
  '$kind cannot retire a replacement $replacement during the first hash', async ({ kind, replacement }) => {
    const s = await subject(kind)
    const boundary = holdHash(1)
    const pending = s.c.confirmedWrite(s.b, kind, s.source)
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
  await s.c.confirmedWrite(s.b, kind, s.source)
  expect(s.c.proposalStages.get(s.key)).toBe(unrelated)
  expect(s.c.latestWriteGuards.get(s.key)).toEqual(s.confirmed)
})

it.each(kinds)('%s cannot retire an association for a different confirmed Session', async kind => {
  const s = await subject(kind)
  await s.c.confirmedWrite({ ...s.b, sessionId: 'different-session' }, kind, s.source)
  expect(s.c.proposalStages.get(s.key)).toBe(s.stage)
  expect(s.c.latestWriteGuards.get(s.key)?.sessionId).toBe('different-session')
  expect(s.intent.restore).toBe(s.a)
})
