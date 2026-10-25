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
