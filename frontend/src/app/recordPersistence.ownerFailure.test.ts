import { editorValue, recordWriteGuard } from './recordWriteGuards'
import { stageOrigin } from './proposalStage.testSupport'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { richEditorDocumentFromStoredBody, richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { cleanupControllerTest, deferred, setupControllerTest } from './useAppController.testHarness'
import { storageOutcome } from './sessionChat.proposals.testSupport'
import { createOwnerBoundary } from './recordSaveGuards.boundary.testSupport'

beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each(['draft', 'finding'] as const)('%s unexpected owner-selection error fails visibly and releases the next pass', async kind => {
  const subject = createOwnerBoundary(kind)
  const original = subject.ctx.records.dirtyDraftIdsRef
  Object.defineProperty(subject.ctx.records, 'dirtyDraftIdsRef', { configurable: true, get: () => { throw new Error('Unexpected selection failure') } })
  expect(await subject.persistence.saveDirtyRecordsNow()).toBe(false)
  expect(subject.ctx.feedback.setError).toHaveBeenCalledWith('Something went wrong: Unexpected selection failure')
  expect(subject.persistence.coordination.hasPendingRecordCompensations()).toBe(false)
  Object.defineProperty(subject.ctx.records, 'dirtyDraftIdsRef', { configurable: true, value: original })
  expect(await subject.persistence.saveDirtyRecordsNow()).toBe(true)
  expect(subject.storage.read().title).toBe(subject.record.title)
  expect(subject.persistence.coordination.hasPendingRecordCompensations()).toBe(false)
  expect(richEditorDocumentFromStoredBody(subject.storage.read())).toEqual(richEditorDocumentFromStoredBody(subject.record))
})

async function exactBoundary(kind: 'draft' | 'finding') {
  const subject = createOwnerBoundary(kind)
  const body = richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Reviewed expected result'))
  const reviewed = { ...subject.record, title: 'Reviewed title', ...body }
  if ('aiRunId' in reviewed) subject.ctx.records.draftsRef.current = [reviewed]
  else subject.ctx.records.findingsRef.current = [reviewed]
  const base = await recordWriteGuard(subject.record, kind === 'draft' ? 'drafts' : 'findings')
  const origin = stageOrigin(kind, reviewed.id, 'exact-stage')
  subject.persistence.coordination.bindStage(kind, reviewed.id, reviewed.sessionId, { id: origin.stageId, origin, before: editorValue(subject.record), after: editorValue(reviewed), storedBaseToken: base.expectedStoredBase })
  const storage = storageOutcome(subject.record, kind === 'finding' ? 'finding' : 'test_cases_draft')
  const command = kind === 'draft' ? subject.api.updateDraft : subject.api.updateFinding
  command.mockImplementation(storage.write)
  return { ...subject, storage, reviewed, origin, command }
}

it.each((['draft', 'finding'] as const).flatMap(kind => (['guard', 'materialization', 'settlement'] as const).map(boundary => ({ kind, boundary }))))(
  '$kind exact save rechecks freshness at $boundary and releases ownership', async ({ kind, boundary }) => {
  const subject = await exactBoundary(kind)
  let current = true
  const reached = deferred<void>(), release = deferred<void>()
  const cleanup: string[][] = []
  if (boundary === 'materialization') subject.ctx.materializeInlineImages = async document => {
    reached.resolve(); await release.promise
    return { document, importedAttachmentIds: ['imported-during-update'] }
  }
  if (boundary === 'settlement') subject.ctx.importedAttachments.pending = () => ['stale-import']
  subject.ctx.cleanupMaterializedAttachments = async ids => {
    cleanup.push(ids)
    if (boundary === 'settlement' && ids.includes('stale-import')) { reached.resolve(); await release.promise }
    return true
  }
  const saving = subject.persistence.persistProposalExact({ record: subject.reviewed, origin: subject.origin, isCurrent: () => current })
  if (boundary !== 'guard') await reached.promise
  current = false; release.resolve()
  expect(await saving).toMatchObject({ kind: 'superseded' })
  expect(subject.storage.read().title).toBe(boundary === 'settlement' ? 'Reviewed title' : subject.record.title)
  expect(subject.command).toHaveBeenCalledTimes(boundary === 'settlement' ? 1 : 0)
  if (boundary === 'materialization') expect(cleanup).toContainEqual(['imported-during-update'])
  expect(subject.persistence.coordination.hasPendingRecordCompensations()).toBe(false)
  expect((kind === 'draft' ? subject.ctx.records.dirtyDraftIdsRef.current : subject.ctx.records.dirtyFindingIdsRef.current).has(subject.record.id)).toBe(true)
})

it.each(['draft', 'finding'] as const)('%s exact save rejects a forced pass instead of joining a different payload', async kind => {
  const subject = await exactBoundary(kind)
  const forced = subject.persistence.saveDirtyRecordsNow()
  const exact = await subject.persistence.persistProposalExact({ record: subject.reviewed, origin: subject.origin, isCurrent: () => true })
  expect(exact).toMatchObject({ kind: 'failed', message: 'Wait for pending record writes, then retry Update.' })
  expect(await forced).toBe(true)
  expect(subject.command).toHaveBeenCalledOnce()
  expect(subject.storage.read().title).toBe('Reviewed title')
  expect(subject.persistence.coordination.hasPendingRecordCompensations()).toBe(false)
})

it.each((['draft', 'finding'] as const).flatMap(kind => (['incomplete', 'validation', 'notFound'] as const).map(failure => ({ kind, failure }))))('$kind retains acknowledged-save uncertainty after $failure completion failure, then retries without rewriting', async ({ kind, failure }) => {
  const subject = await exactBoundary(kind)
  let pending = ['stale-import']
  subject.ctx.importedAttachments.pending = () => pending
  subject.ctx.importedAttachments.forget = () => { pending = [] }
  subject.ctx.cleanupMaterializedAttachments = () => Promise.resolve(false)
  if (failure !== 'incomplete') vi.spyOn(subject.persistence.coordination, 'confirmedWrite')
    .mockRejectedValueOnce({ kind: failure, message: 'Acknowledged save completion rejected.' })
  const command = { record: subject.reviewed, origin: subject.origin, isCurrent: () => true }
  expect(await subject.persistence.persistProposalExact(command)).toMatchObject({ kind: 'unconfirmed', message: 'The record save was acknowledged, but update completion failed. Your edits are retained. Select Update to check the saved result and retry cleanup.' })
  expect(subject.storage.read().title).toBe('Reviewed title')
  expect(subject.command).toHaveBeenCalledOnce()
  expect((kind === 'draft' ? subject.ctx.records.dirtyDraftIdsRef.current : subject.ctx.records.dirtyFindingIdsRef.current).has(subject.record.id)).toBe(true)
  const after = editorValue(subject.reviewed)
  const guard = await recordWriteGuard(subject.storage.read(), kind === 'draft' ? 'drafts' : 'findings')
  subject.persistence.coordination.bindStage(kind, subject.record.id, subject.record.sessionId, { id: subject.origin.stageId, origin: subject.origin, before: editorValue(subject.record), after, storedBaseToken: guard.expectedStoredBase })
  subject.ctx.cleanupMaterializedAttachments = () => Promise.resolve(true)
  expect(await subject.persistence.persistProposalExact(command, subject.storage.read())).toMatchObject({ kind: 'saved', record: { title: 'Reviewed title' } })
  expect(subject.command).toHaveBeenCalledOnce()
  expect(pending).toEqual([])
  expect(subject.persistence.coordination.hasPendingRecordCompensations()).toBe(false)
})

it.each((['draft', 'finding'] as const).flatMap(kind => [
  { cause: new Error('Transport failed before acknowledgement'), message: 'Something went wrong: Transport failed before acknowledgement' },
  { cause: { kind: 'internal', message: 'Commit status unavailable' }, message: 'Something went wrong: Commit status unavailable' },
  { cause: 'validation: not found after transport failure', message: 'Something went wrong: validation: not found after transport failure' },
  { cause: { kind: 'validation' }, message: 'Something went wrong: [object Object]' },
].map(error => ({ kind, ...error }))))('$kind retains uncertainty for raw $message', async ({ kind, cause, message }) => {
  const subject = await exactBoundary(kind)
  subject.command.mockRejectedValueOnce(cause)
  expect(await subject.persistence.persistProposalExact({ record: subject.reviewed, origin: subject.origin, isCurrent: () => true }))
    .toEqual({ kind: 'unconfirmed', message })
  expect(subject.storage.read()).toEqual(subject.record)
  expect(subject.storage.read()).toMatchObject(kind === 'finding'
    ? { title: 'Checkout returns 500', body: '<p>Payment submission returns a server error.</p>' }
    : { title: 'Checkout test cases', body: '<ol><li>Submit payment.</li></ol>' })
  const local = kind === 'finding' ? subject.ctx.records.findingsRef.current[0] : subject.ctx.records.draftsRef.current[0]
  expect(local).toMatchObject({ title: 'Reviewed title', body: '<p>Reviewed expected result</p>' })
  expect(subject.ctx.feedback.setError).toHaveBeenLastCalledWith(message)
  expect(subject.command).toHaveBeenCalledOnce()
  expect(subject.persistence.coordination.hasPendingRecordCompensations()).toBe(false)
})
