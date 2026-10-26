import { afterEach, beforeEach, expect, it } from 'vitest'
import { richEditorDocumentFromStoredBody } from '../editor/editorDocument'
import { cleanupControllerTest, setupControllerTest } from './useAppController.testHarness'
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
