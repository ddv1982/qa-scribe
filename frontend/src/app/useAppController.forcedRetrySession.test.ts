import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { cleanupControllerTest, deferred, setupControllerTest } from './useAppController.testHarness'
import { holdExplicitSave, observeForcedSaveStart, openSaveGuardSubject, recordKinds } from './recordSaveGuards.testSupport'
import { canonicalizeRecord, captureGeneration, generatedRecord, holdForcedOwner } from './recordSaveGuards.owner.testSupport'
import type { RecordPatch } from './recordSaveGuards.storage.testSupport'

beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it.each(recordKinds.flatMap(kind => ([1, 2] as const).map(hash => ({ kind, hash }))))(
  '$kind drains an admitted retry through hash $hash and starts a later retry after owner completion', async ({ kind, hash }) => {
    const subject = await openSaveGuardSubject(kind)
    subject.update.mockRejectedValueOnce(new Error('Canonical transport unavailable'))
    await act(async () => { await canonicalizeRecord(subject, subject.current()) })
    expect(subject.result.current.hasPendingRecordCompensations()).toBe(true)
    const reached = deferred<void>(); const release = deferred<void>()
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let hashes = 0
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      const hold = ++hashes === hash
      const value = await digest(algorithm, data)
      if (hold) { reached.resolve(); await release.promise }
      return value
    })
    let retry!: Promise<boolean>; let owner!: Promise<boolean>; let later!: Promise<boolean>
    let ownerSettled = false; let laterSettled = false
    act(() => { retry = subject.result.current.retryAllPendingRecordCompensations() })
    await act(async () => { await reached.promise })
    try {
      act(() => { owner = subject.result.current.saveDirtyRecordsNow().then(value => { ownerSettled = true; return value }) })
      act(() => { later = subject.result.current.retryPendingRecordCompensations(subject.initial.sessionId).then(value => { laterSettled = true; return value }) })
      await observeForcedSaveStart()
      expect(ownerSettled).toBe(false)
      expect(laterSettled).toBe(false)
      expect(subject.update).toHaveBeenCalledTimes(hash === 1 ? 1 : 2)
    } finally {
      await act(async () => { release.resolve(); expect(await Promise.all([retry, owner, later])).toEqual([true, true, true]) })
    }
    expect(subject.storage.read().title).toBe('S0')
    expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
    expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
  },
)

it.each(recordKinds.flatMap(kind => (['drain', 'write'] as const).map(boundary => ({ kind, boundary }))))(
  '$kind Session deletion during owner $boundary cannot resume the old row or report a joined Save successful', async ({ kind, boundary }) => {
    const subject = await openSaveGuardSubject(kind)
    const held = boundary === 'drain' ? await holdExplicitSave(subject, 'after-commit') : await holdForcedOwner(subject)
    let owner!: Promise<boolean>
    if (boundary === 'drain') act(() => { owner = subject.result.current.saveDirtyRecordsNow() })
    else owner = held.pending
    let joined!: Promise<boolean>
    act(() => { joined = subject.save() })
    subject.api.deleteSession.mockImplementation((sessionId: string) => {
      subject.storage.removeSession(sessionId)
      return Promise.resolve({ pendingFiles: 0 })
    })
    subject.api.listSessions.mockResolvedValue([])
    try {
      const session = subject.result.current.activeSession!
      await act(async () => { await subject.result.current.handleDeleteSession(session) })
      expect(subject.result.current.activeSession).toBeNull()
      expect(subject.result.current.testwareDrafts).toEqual([])
      expect(subject.result.current.findings).toEqual([])
    } finally {
      await act(async () => { held.release(); await held.pending; expect(await Promise.all([owner, joined])).toEqual([false, false]) })
    }
    expect(subject.storage.has(subject.initial.id)).toBe(false)
    expect(subject.update).toHaveBeenCalledTimes(1)
    expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
    await act(async () => { expect(await subject.result.current.saveDirtyRecordsNow()).toBe(true) })
  },
)

it.each(recordKinds)('%s Session deletion during canonical acknowledgement settles the ticket and its joined Save', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const complete = await captureGeneration(subject)
  const owner = await holdForcedOwner(subject)
  const generated = generatedRecord(subject)
  const reached = deferred<void>(); const release = deferred<void>()
  subject.update.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    const row = await subject.storage.write(id, patch, guard)
    reached.resolve(); await release.promise
    return row
  })
  complete(generated)
  await act(async () => { owner.release(); await reached.promise })
  subject.editRecord(generated.id, 'Current Y2')
  let joined!: Promise<boolean>
  act(() => { joined = subject.save(generated.id) })
  subject.api.deleteSession.mockImplementation((sessionId: string) => {
    subject.storage.removeSession(sessionId)
    return Promise.resolve({ pendingFiles: 0 })
  })
  subject.api.listSessions.mockResolvedValue([])
  try {
    await act(async () => { await subject.result.current.handleDeleteSession(subject.result.current.activeSession!) })
  } finally {
    await act(async () => { release.resolve(); expect(await Promise.all([owner.pending, joined])).toEqual([false, false]) })
  }
  expect(subject.result.current.activeSession).toBeNull()
  expect(subject.result.current.testwareDrafts).toEqual([])
  expect(subject.result.current.findings).toEqual([])
  expect(subject.storage.has(generated.id)).toBe(false)
  expect(subject.update).toHaveBeenCalledTimes(2)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})
