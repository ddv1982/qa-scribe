import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { cleanupControllerTest, deferred, setupControllerTest } from './useAppController.testHarness'
import { observeForcedSaveStart, openSaveGuardSubject, recordKinds } from './recordSaveGuards.testSupport'
import { discardRecord, holdForcedOwner } from './recordSaveGuards.owner.testSupport'
import type { RecordPatch } from './recordSaveGuards.storage.testSupport'

beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it.each(recordKinds.flatMap(kind => (['ack', 'hash'] as const).map(boundary => ({ kind, boundary }))))(
  '$kind joins a newer Save behind forced compensation $boundary without replaying the supplied snapshot', async ({ kind, boundary }) => {
    const subject = await openSaveGuardSubject(kind)
    const saved = deferred<void>(); const releaseSave = deferred<void>()
    const compensated = deferred<void>(); const releaseCompensation = deferred<void>()
    let armHash = false
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    if (boundary === 'hash') vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      const hold = armHash; armHash = false
      const hash = await digest(algorithm, data)
      if (hold) { compensated.resolve(); await releaseCompensation.promise }
      return hash
    })
    subject.update.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
      const row = await subject.storage.write(id, patch, guard)
      saved.resolve(); await releaseSave.promise
      return row
    })
    subject.update.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
      const row = await subject.storage.write(id, patch, guard)
      if (boundary === 'hash') armHash = true
      else { compensated.resolve(); await releaseCompensation.promise }
      return row
    })
    subject.edit('Committed B')
    let forced!: Promise<boolean>
    let joined!: Promise<boolean>
    let settled = false
    act(() => { forced = subject.result.current.saveDirtyRecordsNow() })
    await act(async () => { await saved.promise })
    discardRecord(subject); subject.edit('C before compensation')
    await act(async () => { releaseSave.resolve() })
    let outcomes: boolean[] = []
    try {
      await act(async () => { await compensated.promise })
      discardRecord(subject); subject.edit('Supplied D')
      act(() => { joined = subject.save().then(result => { settled = true; return result }) })
      subject.edit('Latest E')
      await observeForcedSaveStart()
      expect(subject.update).toHaveBeenCalledTimes(2)
      expect(settled).toBe(false)
      expect(subject.storage.read().title).toBe('S0')
    } finally {
      await act(async () => { releaseSave.resolve(); releaseCompensation.resolve(); outcomes = await Promise.all([forced, joined]) })
    }
    expect(outcomes).toEqual([true, true])
    expect(subject.storage.read().title).toBe('Latest E')
    expect(subject.storage.read().body).toBe('<p>Body Latest E</p>')
    expect(subject.current().title).toBe('Latest E')
    expect(subject.storage.requests.some(request => request.patch.title === 'Supplied D')).toBe(false)
    expect(subject.result.current.error).toBeNull()
    expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
    expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
    subject.edit('Later F')
    await act(async () => { expect(await subject.save()).toBe(true) })
    expect(subject.storage.read().title).toBe('Later F')
  },
)

it.each(recordKinds)('%s joined Save cannot report saved while its target has a terminal pending delete', async kind => {
  const subject = await openSaveGuardSubject(kind, true)
  const owner = await holdForcedOwner(subject)
  let joined!: Promise<boolean>
  act(() => { joined = subject.save(subject.secondId) })
  const deletion = deferred<void>()
  const remove = (id: string) => deletion.promise.then(() => { subject.storage.remove(id) })
  subject.api.deleteDraft.mockImplementation(remove); subject.api.deleteFinding.mockImplementation(remove)
  act(() => {
    if (kind === 'draft') subject.result.current.requestDeleteDraft(subject.result.current.testwareDrafts.find(row => row.id === subject.secondId)!)
    else subject.result.current.requestDeleteFinding(subject.result.current.findings.find(row => row.id === subject.secondId)!)
  })
  let deleted!: Promise<void>
  act(() => { deleted = subject.result.current.confirmDelete() })
  try {
    await act(async () => { owner.release(); expect(await owner.pending).toBe(true); expect(await joined).toBe(false) })
    expect(subject.storage.has(subject.secondId)).toBe(true)
    expect(subject.update).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { deletion.resolve(); await deleted })
  }
  expect(subject.storage.has(subject.secondId)).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})
