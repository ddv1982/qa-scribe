import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { RecordWriteConflict, recordWriteGuard } from './recordWriteGuards'
import { cleanupControllerTest, setupControllerTest } from './useAppController.testHarness'
import { currentRecord, editCurrentRecord, holdFirstRecordSave, holdLatestRecordResult, recordKinds, richBody, saveCurrentRecord } from './foreignSessionConflict.testSupport'

beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each(recordKinds.flatMap(kind => (['conflict', 'generic-error', 'same-canonical'] as const).map(mode => ({ kind, mode }))))(
  '$kind keeps B clean when a late A result is $mode', async ({ kind, mode }) => {
    const subject = await holdLatestRecordResult(kind, mode)
    await subject.openSessionTwo()
    expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
    expect(subject.result.current.hasPendingRecordCompensations()).toBe(true)
    await subject.deliverLatest()
    expect(subject.result.current.testwareDrafts).toEqual([subject.draftTwo])
    expect(subject.result.current.findings).toEqual([subject.findingTwo])
    expect(subject.stored()).toEqual(subject.initial)
    expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
    if (mode === 'conflict') {
      expect(subject.result.current.error).toBe('A Save from another Session reported a conflict. Reopen its Session to review the latest saved record.')
      expect(subject.requests.map(request => request.outcome)).toEqual(['saved', 'conflict', 'saved'])
    } else if (mode === 'generic-error') {
      expect(subject.result.current.error).toContain('Synthetic late record transport failure')
      expect(subject.requests.map(request => request.outcome)).toEqual(['saved', 'conflict', 'saved', 'restored-noop'])
    } else {
      expect(subject.result.current.error).toBeNull()
      expect(subject.requests.map(request => request.outcome)).toEqual(['saved', 'saved', 'saved'])
    }
    const writesBefore = subject.requests.length
    await act(async () => { expect(await subject.result.current.saveDirtyRecordsNow()).toBe(true) })
    expect(subject.requests).toHaveLength(writesBefore)
    expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
  },
)

it.each(recordKinds)('%s accepts an earlier same-content write and preserves newer C after B opens', async kind => {
  const subject = await holdFirstRecordSave(kind, true)
  act(() => editCurrentRecord(subject.result.current, kind, 'Newest C', 'Body C'))
  await act(async () => { expect(await saveCurrentRecord(subject.result.current, kind)).toBe(true) })
  expect(subject.stored().title).toBe('Newest C')
  expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
  await subject.openSessionTwo()
  await act(async () => {
    subject.acknowledge.resolve()
    expect(await subject.pending).toBe(false)
  })
  expect(subject.stored()).toEqual({ ...subject.initial, title: 'Newest C', ...richBody('Body C') })
  expect(subject.result.current.testwareDrafts).toEqual([subject.draftTwo])
  expect(subject.result.current.findings).toEqual([subject.findingTwo])
  expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
  expect(subject.result.current.error).toBeNull()
  expect(subject.requests.map(request => request.outcome)).toEqual(['saved', 'saved', 'restored-noop'])
})

it.each(recordKinds)('%s preserves a legitimate B edit until its own bounded save', async kind => {
  const subject = await holdLatestRecordResult(kind)
  await subject.openSessionTwo()
  const original = currentRecord(subject.result.current, kind)
  act(() => editCurrentRecord(subject.result.current, kind, 'Unsaved B edit', 'B edited body'))
  const edited = { ...original, title: 'Unsaved B edit', ...richBody('B edited body') }
  expect(subject.result.current.hasPendingSessionEdits()).toBe(true)
  await subject.deliverLatest()
  expect(currentRecord(subject.result.current, kind)).toEqual(edited)
  expect(subject.result.current.hasPendingSessionEdits()).toBe(true)
  expect(subject.stored(original.id)).toEqual(original)
  const writesBefore = subject.requests.length
  await act(async () => { expect(await subject.result.current.saveDirtyRecordsNow()).toBe(true) })
  expect(subject.requests).toHaveLength(writesBefore + 1)
  expect(subject.requests.at(-1)?.id).toBe(original.id)
  expect(subject.requests.at(-1)?.guard.sessionId).toBe('session-2')
  expect(subject.stored(original.id)).toEqual(edited)
  expect(currentRecord(subject.result.current, kind)).toEqual(edited)
  expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
  expect(subject.stored()).toEqual(subject.initial)
})

it.each(recordKinds)('%s keeps owned conflict behavior without rebasing the pinned guard', async kind => {
  const subject = await holdLatestRecordResult(kind)
  await subject.deliverLatest()
  expect(subject.result.current.activeSession?.id).toBe('session-1')
  expect(currentRecord(subject.result.current, kind)).toEqual(subject.initial)
  expect(subject.result.current.hasPendingSessionEdits()).toBe(true)
  expect(subject.result.current.error).toBe(new RecordWriteConflict(subject.initial).message)
  const initialGuard = await recordWriteGuard(subject.initial, subject.table)
  const rejectedBase = subject.requests[1].before
  expect((await recordWriteGuard(rejectedBase, subject.table)).expectedStoredBase).not.toBe(initialGuard.expectedStoredBase)
  await act(async () => { expect(await subject.result.current.saveDirtyRecordsNow()).toBe(true) })
  expect(subject.requests.at(-1)?.guard).toEqual(initialGuard)
  expect(subject.stored()).toEqual(subject.initial)
  expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
})
