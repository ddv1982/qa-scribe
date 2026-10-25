import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { cleanupControllerTest, deferred, setupControllerTest } from './useAppController.testHarness'
import { observeForcedSaveStart, openSaveGuardSubject, recordKinds } from './recordSaveGuards.testSupport'
import { canonicalBody, canonicalizeRecord, captureGeneration, discardRecord, generatedRecord, holdForcedOwner } from './recordSaveGuards.owner.testSupport'
import type { RecordPatch } from './recordSaveGuards.storage.testSupport'

beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it.each(recordKinds)('%s canonicalizes a generated missing baseline before saving the newer dirty editor', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const completeGeneration = await captureGeneration(subject)
  const owner = await holdForcedOwner(subject)
  const generated = generatedRecord(subject)
  completeGeneration(generated)
  await waitFor(() => expect(subject.current(generated.id).title).toBe('Generated G'))
  subject.editRecord(generated.id, 'Edited Y2')
  try {
    await observeForcedSaveStart()
    expect(subject.update).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { owner.release(); expect(await owner.pending).toBe(true) })
  }
  const writes = subject.storage.requests.filter(request => request.before.id === generated.id)
  expect(writes.map(request => request.patch.title)).toEqual(['Generated G', 'Edited Y2'])
  expect(subject.storage.read(generated.id).title).toBe('Edited Y2')
  expect(subject.storage.read(generated.id).body).toBe('<p>Body Edited Y2</p>')
  expect(subject.current(generated.id).title).toBe('Edited Y2')
  expect(subject.result.current.error).toBeNull()
  expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds)('%s processes an unloaded canonical ticket after the last initial dirty row', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const owner = await holdForcedOwner(subject)
  const generated = generatedRecord(subject)
  subject.storage.external(generated)
  let canonical!: Promise<void>
  act(() => { canonical = canonicalizeRecord(subject, canonicalBody(generated, 'Canonical Y'), generated) })
  try {
    await observeForcedSaveStart()
    expect(subject.update).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { owner.release(); expect(await owner.pending).toBe(true); await canonical })
  }
  expect(subject.storage.read(generated.id).title).toBe('Canonical Y')
  expect(subject.current(generated.id).body).toBe('<p>Body Canonical Y</p>')
  expect(subject.result.current.error).toBeNull()
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds)('%s includes a ticket arriving during another canonical acknowledgement', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const owner = await holdForcedOwner(subject)
  const y = generatedRecord(subject)
  const z = generatedRecord(subject, 'generated-Z')
  subject.storage.external(y); subject.storage.external(z)
  const reached = deferred<void>(); const release = deferred<void>()
  subject.update.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    const row = await subject.storage.write(id, patch, guard)
    reached.resolve(); await release.promise
    return row
  })
  let first!: Promise<void>; let second!: Promise<void>
  act(() => { first = canonicalizeRecord(subject, canonicalBody(y, 'Canonical Y'), y) })
  await act(async () => { owner.release(); await reached.promise })
  try {
    act(() => { second = canonicalizeRecord(subject, canonicalBody(z, 'Canonical Z'), z) })
    await observeForcedSaveStart()
    expect(subject.update).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => { release.resolve(); expect(await owner.pending).toBe(true); await Promise.all([first, second]) })
  }
  expect(subject.storage.requests.map(request => request.patch.title)).toEqual(['Owner X', 'Canonical Y', 'Canonical Z'])
  expect(subject.storage.read(z.id).body).toBe('<p>Body Canonical Z</p>')
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds)('%s retires a canonical ticket replaced by a public Discard without reinstalling its base', async kind => {
  const subject = await openSaveGuardSubject(kind, true)
  const owner = await holdForcedOwner(subject)
  const base = subject.current(subject.secondId)
  let canonical!: Promise<void>
  act(() => { canonical = canonicalizeRecord(subject, canonicalBody(base, 'Stale canonical Y'), base) })
  discardRecord(subject, subject.secondId)
  await act(async () => { owner.release(); expect(await owner.pending).toBe(true); await canonical })
  expect(subject.update).toHaveBeenCalledTimes(1)
  expect(subject.storage.read(subject.secondId).title).toBe('Y0')
  subject.editRecord(subject.secondId, 'Later Y')
  await act(async () => { expect(await subject.save(subject.secondId)).toBe(true) })
  expect(subject.storage.read(subject.secondId).title).toBe('Later Y')
})

it.each(recordKinds)('%s dispositions queued canonical work after a dirty write fails and releases ownership', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const owner = await holdForcedOwner(subject, true)
  const generated = generatedRecord(subject)
  subject.storage.external(generated)
  let canonical!: Promise<void>
  act(() => { canonical = canonicalizeRecord(subject, canonicalBody(generated, 'Canonical Y'), generated) })
  subject.storage.external({ ...subject.initial, title: 'Foreign X' })
  await act(async () => { owner.release(); expect(await owner.pending).toBe(false); await canonical })
  expect(subject.storage.read(generated.id).title).toBe('Canonical Y')
  expect(subject.storage.read().title).toBe('Foreign X')
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
  discardRecord(subject)
  subject.edit('Recovered X')
  await act(async () => { expect(await subject.result.current.saveDirtyRecordsNow()).toBe(true) })
  expect(subject.storage.read().title).toBe('Recovered X')
})

it.each(recordKinds)('%s reports a canonical foreign conflict without rebasing or stranding the ticket', async kind => {
  const subject = await openSaveGuardSubject(kind, true)
  const owner = await holdForcedOwner(subject)
  const base = subject.current(subject.secondId)
  let canonical!: Promise<void>
  act(() => { canonical = canonicalizeRecord(subject, canonicalBody(base, 'Rejected Y'), base) })
  subject.storage.external({ ...base, title: 'Foreign Y' })
  await act(async () => { owner.release(); expect(await owner.pending).toBe(false); await canonical })
  expect(subject.storage.read(subject.secondId).title).toBe('Foreign Y')
  expect(subject.current(subject.secondId).title).toBe('Y0')
  expect(subject.result.current.error).toContain('Stored record changed')
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds)('%s retires a canonical ticket after the same target has already been accepted by the owner', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const owner = await holdForcedOwner(subject)
  let canonical!: Promise<void>
  act(() => { canonical = canonicalizeRecord(subject, canonicalBody(subject.initial, 'Obsolete canonical'), subject.initial) })
  await act(async () => { owner.release(); expect(await owner.pending).toBe(true); await canonical })
  expect(subject.update).toHaveBeenCalledTimes(1)
  expect(subject.storage.read().title).toBe('Owner X')
  subject.edit('Later S2')
  await act(async () => { expect(await subject.save()).toBe(true) })
  expect(subject.storage.read().title).toBe('Later S2')
})

it.each(recordKinds)('%s deletes a queued canonical target without replaying it or falsely completing its joined Save', async kind => {
  const subject = await openSaveGuardSubject(kind, true)
  const owner = await holdForcedOwner(subject)
  const target = subject.current(subject.secondId)
  let canonical!: Promise<void>; let joined!: Promise<boolean>
  act(() => {
    canonical = canonicalizeRecord(subject, canonicalBody(target, 'Deleted canonical'), target)
    joined = subject.save(subject.secondId)
  })
  const remove = (id: string) => { subject.storage.remove(id); return Promise.resolve() }
  subject.api.deleteDraft.mockImplementation(remove); subject.api.deleteFinding.mockImplementation(remove)
  try {
    act(() => {
      if (kind === 'draft') subject.result.current.requestDeleteDraft(subject.result.current.testwareDrafts.find(row => row.id === subject.secondId)!)
      else subject.result.current.requestDeleteFinding(subject.result.current.findings.find(row => row.id === subject.secondId)!)
    })
    await act(async () => { await subject.result.current.confirmDelete() })
  } finally {
    await act(async () => { owner.release(); expect(await owner.pending).toBe(true); await canonical; expect(await joined).toBe(false) })
  }
  expect(subject.update).toHaveBeenCalledTimes(1)
  expect(subject.storage.has(subject.secondId)).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds)('%s canonical failure settles its ticket and allows a later owner to recover current content', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const owner = await holdForcedOwner(subject)
  const target = generatedRecord(subject)
  subject.storage.external(target)
  subject.update.mockRejectedValueOnce(new Error('Canonical Y unavailable'))
  let canonical!: Promise<void>
  act(() => { canonical = canonicalizeRecord(subject, canonicalBody(target, 'Canonical Y'), target) })
  await act(async () => { owner.release(); expect(await owner.pending).toBe(false); await canonical })
  expect(subject.storage.read(target.id).title).toBe('Generated G')
  expect(subject.current(target.id).title).toBe('Canonical Y')
  expect(subject.result.current.error).toContain('Canonical Y unavailable')
  await act(async () => { expect(await subject.result.current.saveDirtyRecordsNow()).toBe(true) })
  expect(subject.storage.read(target.id).title).toBe('Canonical Y')
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})
