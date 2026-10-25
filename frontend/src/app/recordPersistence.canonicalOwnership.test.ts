import { afterEach, beforeEach, expect, it } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { cleanupControllerTest, deferred, setupControllerTest } from './useAppController.testHarness'
import { createOwnerBoundary } from './recordSaveGuards.boundary.testSupport'
import { editorValue, recordWriteGuard } from './recordWriteGuards'
import type { RecordPatch } from './recordSaveGuards.storage.testSupport'

beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

const holders = ['intent', 'saved', 'pin', 'stage', 'delete'] as const
it.each((['draft', 'finding'] as const).flatMap(kind => holders.map(holder => ({ kind, holder }))))(
  '$kind canonical ticket cannot overwrite a replacement $holder owner with identical content', async ({ kind, holder }) => {
    const subject = createOwnerBoundary(kind)
    const command = kind === 'draft' ? subject.api.updateDraft : subject.api.updateFinding
    const reached = deferred<void>(); const release = deferred<void>()
    command.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
      reached.resolve(); await release.promise
      return subject.storage.write(id, patch, guard)
    })
    const owner = subject.persistence.saveDirtyRecordsNow()
    await reached.promise
    const target = subject.second
    const canonical = 'aiRunId' in target
      ? subject.persistence.drafts.canonicalizeGeneratedDraft({ ...target, title: 'Obsolete canonical' }, target)
      : subject.persistence.findings.canonicalizeGeneratedFinding({ ...target, title: 'Obsolete canonical' }, target)
    const coordination = subject.persistence.coordination
    const key = `${kind}:${target.id}`
    if (holder === 'intent' || holder === 'delete') {
      if ('aiRunId' in target) coordination.reserveDraftIntent(target.id, holder === 'delete' ? 'delete' : 'discard', target)
      else coordination.reserveFindingIntent(target.id, holder === 'delete' ? 'delete' : 'discard', target)
    } else if (holder === 'saved') {
      if ('aiRunId' in target) subject.ctx.records.savedDraftsRef.current = [subject.ctx.records.savedDraftsRef.current[0], { ...target }]
      else subject.ctx.records.savedFindingsRef.current = [subject.ctx.records.savedFindingsRef.current[0], { ...target }]
    } else if (holder === 'pin') {
      coordination.latestWriteGuards.set(key, await recordWriteGuard(target, kind === 'draft' ? 'drafts' : 'findings'))
    } else {
      const value = editorValue(target)
      coordination.proposalStages.set(key, { id: 'replacement-stage', before: value, after: value, storedBaseToken: '' })
    }
    try {
      expect(command).toHaveBeenCalledOnce()
    } finally {
      release.resolve()
      expect(await owner).toBe(true)
      await canonical
    }
    expect(command).toHaveBeenCalledOnce()
    expect(subject.storage.read(target.id)).toEqual(target)
    expect(coordination.hasPendingRecordCompensations()).toBe(false)
  },
)

it.each(['draft', 'finding'] as const)('%s absent baseline admission preserves an existing pin, stage, delete, and foreign Session', async kind => {
  const subject = createOwnerBoundary(kind)
  const command = kind === 'draft' ? subject.api.updateDraft : subject.api.updateFinding
  const reached = deferred<void>(); const release = deferred<void>()
  command.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    reached.resolve(); await release.promise
    return subject.storage.write(id, patch, guard)
  })
  const owner = subject.persistence.saveDirtyRecordsNow()
  await reached.promise
  const pinTarget = subject.second
  const stageTarget = { ...pinTarget, id: 'stage-target' }
  const deletedTarget = { ...pinTarget, id: 'deleted-target' }
  const foreignTarget = { ...pinTarget, id: 'foreign-target', sessionId: 'foreign-session' }
  const coordination = subject.persistence.coordination
  if ('aiRunId' in pinTarget) subject.ctx.records.savedDraftsRef.current = [subject.ctx.records.savedDraftsRef.current[0]]
  else subject.ctx.records.savedFindingsRef.current = [subject.ctx.records.savedFindingsRef.current[0]]
  const pin = await recordWriteGuard(pinTarget, kind === 'draft' ? 'drafts' : 'findings')
  const value = editorValue(stageTarget)
  const stage = { id: 'existing-stage', before: value, after: value, storedBaseToken: pin.expectedStoredBase }
  coordination.latestWriteGuards.set(`${kind}:${pinTarget.id}`, pin)
  coordination.proposalStages.set(`${kind}:${stageTarget.id}`, stage)
  const reserveDelete = (record: typeof pinTarget) => 'aiRunId' in record
    ? coordination.reserveDraftIntent(record.id, 'delete') : coordination.reserveFindingIntent(record.id, 'delete')
  reserveDelete(deletedTarget)
  const canonicalize = (record: typeof pinTarget) => 'aiRunId' in record
    ? subject.persistence.drafts.canonicalizeGeneratedDraft(record, record)
    : subject.persistence.findings.canonicalizeGeneratedFinding(record, record)
  const tickets = [canonicalize(pinTarget), canonicalize(stageTarget), canonicalize(deletedTarget), canonicalize(foreignTarget)]
  try {
    const saved = kind === 'draft' ? subject.ctx.records.savedDraftsRef.current : subject.ctx.records.savedFindingsRef.current
    expect(saved.map(record => record.id)).toEqual([subject.record.id])
    expect(coordination.latestWriteGuards.get(`${kind}:${pinTarget.id}`)).toBe(pin)
    expect(coordination.proposalStages.get(`${kind}:${stageTarget.id}`)).toBe(stage)
  } finally {
    reserveDelete(pinTarget); reserveDelete(stageTarget)
    release.resolve()
    expect(await owner).toBe(true)
    await Promise.all(tickets)
  }
  expect(command).toHaveBeenCalledOnce()
  const saved = kind === 'draft' ? subject.ctx.records.savedDraftsRef.current : subject.ctx.records.savedFindingsRef.current
  expect(saved.map(record => record.id)).toEqual([subject.record.id])
})
