import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanupControllerTest, setupControllerTest } from './useAppController.testHarness'
import { openSaveGuardSubject, recordKinds } from './recordSaveGuards.testSupport'
import { canonicalBody, canonicalizeRecord, captureGeneration, discardRecord, generatedRecord, holdForcedOwner } from './recordSaveGuards.owner.testSupport'
import { storedRecordBase } from './recordSaveGuards.storage.testSupport'

beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it.each(recordKinds)('%s Discard of fresh generation preserves the known backend baseline when its queued canonical ticket retires', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const complete = await captureGeneration(subject)
  const owner = await holdForcedOwner(subject)
  const generated = generatedRecord(subject)
  try {
    complete(generated)
    await waitFor(() => expect(subject.current(generated.id).bodyFormat).toBe('tiptap_json'))
    discardRecord(subject, generated.id)
    expect.soft(subject.current(generated.id)).toEqual(generated)
  } finally {
    await act(async () => { owner.release(); expect(await owner.pending).toBe(true) })
  }
  expect(subject.storage.requests.filter(request => request.before.id === generated.id)).toEqual([])
  expect(subject.storage.read(generated.id)).toEqual(generated)
  subject.editRecord(generated.id, 'Edited after Discard', 'Later valid body')
  let saved: boolean | undefined
  await act(async () => { saved = await subject.save(generated.id) })
  expect.soft(saved).toBe(true)
  expect.soft(subject.storage.read(generated.id).title).toBe('Edited after Discard')
  expect.soft(subject.storage.read(generated.id).body).toBe('<p>Later valid body</p>')
  expect(subject.current(generated.id).title).toBe('Edited after Discard')
  expect(subject.current(generated.id).body).toBe('<p>Later valid body</p>')
  expect.soft(subject.result.current.error).toBeNull()
  expect.soft(subject.result.current.hasPendingSessionEdits()).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds)('%s keeps a foreign replacement protected when generation supplied an earlier known baseline', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const complete = await captureGeneration(subject)
  const owner = await holdForcedOwner(subject)
  const generated = generatedRecord(subject)
  complete(generated)
  const foreign = canonicalBody(generated, 'Foreign replacement')
  subject.storage.external(foreign)
  await act(async () => { owner.release(); expect(await owner.pending).toBe(false) })
  const rejected = subject.storage.requests.find(request => request.before.id === generated.id)!
  expect(rejected.outcome).toBe('conflict')
  expect(rejected.guard.expectedStoredBase).toBe(storedRecordBase(generated, kind))
  subject.editRecord(generated.id, 'Retained local edit')
  await act(async () => { expect(await subject.save(generated.id)).toBe(false) })
  expect(subject.storage.read(generated.id)).toEqual(foreign)
  expect(subject.storage.requests.at(-1)?.guard).toBe(rejected.guard)
  expect(subject.current(generated.id).title).toBe('Retained local edit')
  expect(subject.result.current.error).toContain('Stored record changed')
})

it.each(recordKinds)('%s never replaces an existing saved baseline with a stale canonical argument at admission', async kind => {
  const subject = await openSaveGuardSubject(kind, true)
  const owner = await holdForcedOwner(subject)
  const existing = subject.current(subject.secondId)
  const stale = { ...generatedRecord(subject, existing.id), title: 'Stale supplied G' }
  let canonical!: Promise<void>
  act(() => { canonical = canonicalizeRecord(subject, canonicalBody(stale, 'Queued canonical'), stale) })
  try {
    discardRecord(subject, existing.id)
    expect(subject.current(existing.id)).toEqual(existing)
  } finally {
    await act(async () => { owner.release(); expect(await owner.pending).toBe(true); await canonical })
  }
  expect(subject.update).toHaveBeenCalledOnce()
  subject.editRecord(existing.id, 'Valid later edit')
  await act(async () => { expect(await subject.save(existing.id)).toBe(true) })
  expect(subject.storage.requests.at(-1)?.guard.expectedStoredBase).toBe(storedRecordBase(existing, kind))
  expect(subject.storage.read(existing.id).title).toBe('Valid later edit')
})

it.each(recordKinds)('%s same-content Discard still retires the exact queued canonical owner', async kind => {
  const subject = await openSaveGuardSubject(kind, true)
  const owner = await holdForcedOwner(subject)
  const existing = subject.current(subject.secondId)
  let canonical!: Promise<void>
  act(() => { canonical = canonicalizeRecord(subject, { ...existing }, { ...existing }) })
  discardRecord(subject, existing.id)
  await act(async () => { owner.release(); expect(await owner.pending).toBe(true); await canonical })
  expect(subject.update).toHaveBeenCalledOnce()
  expect(subject.storage.read(existing.id)).toEqual(existing)
  subject.editRecord(existing.id, 'Same-content successor')
  await act(async () => { expect(await subject.save(existing.id)).toBe(true) })
  expect(subject.storage.read(existing.id).title).toBe('Same-content successor')
  expect(subject.result.current.error).toBeNull()
})

it.each(recordKinds)('%s fresh generated deletion stays terminal for queued and later canonical requests', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const complete = await captureGeneration(subject)
  const owner = await holdForcedOwner(subject)
  const generated = generatedRecord(subject)
  complete(generated)
  await waitFor(() => expect(subject.current(generated.id).title).toBe('Generated G'))
  const remove = (id: string) => { subject.storage.remove(id); return Promise.resolve() }
  subject.api.deleteDraft.mockImplementation(remove); subject.api.deleteFinding.mockImplementation(remove)
  let stale!: Promise<void>
  try {
    act(() => {
      if (kind === 'draft') subject.result.current.requestDeleteDraft(subject.result.current.testwareDrafts.find(row => row.id === generated.id)!)
      else subject.result.current.requestDeleteFinding(subject.result.current.findings.find(row => row.id === generated.id)!)
    })
    await act(async () => { await subject.result.current.confirmDelete() })
    act(() => { stale = canonicalizeRecord(subject, canonicalBody(generated, 'Deleted stale request'), generated) })
  } finally {
    await act(async () => { owner.release(); expect(await owner.pending).toBe(true); await stale })
  }
  await act(async () => { await canonicalizeRecord(subject, canonicalBody(generated, 'Still deleted'), generated) })
  expect(subject.storage.has(generated.id)).toBe(false)
  expect(subject.update).toHaveBeenCalledOnce()
  expect(subject.result.current.testwareDrafts.some(row => row.id === generated.id)).toBe(false)
  expect(subject.result.current.findings.some(row => row.id === generated.id)).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})
