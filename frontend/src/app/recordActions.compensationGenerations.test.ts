import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recordWriteGuard } from './recordWriteGuards'
import { cleanupControllerTest, setupControllerTest, deferred } from './useAppController.testHarness'
import { kinds, current, edit, discard, saveCurrent, open, heldCompensation } from './recordActions.compensationGuards.testSupport'

beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it.each(kinds.flatMap(kind => (['ack', 'hash'] as const).map(boundary => ({ kind, boundary }))))('$kind a newer confirmed generation wins over compensation $boundary', async ({ kind, boundary }) => {
  const { result, storage, pending, release, table } = await heldCompensation(kind, boundary)
  act(() => { discard(result.current, kind); edit(result.current, kind, 'Newer saved D', 'Body D') })
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  const newer = storage.read()
  expect(newer.title).toBe('Newer saved D')
  await act(async () => { release.resolve(); await pending })
  expect(storage.read()).toEqual(newer)
  expect(current(result.current, kind).title).toBe('Newer saved D')
  expect(result.current.error).toBeNull()
  expect(result.current.sessionChat.recordWritesPending).toBe(false)
  act(() => edit(result.current, kind, 'Next saved E', 'Body E'))
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  expect(storage.read().title).toBe('Next saved E')
  expect(storage.read().body).toBe('<p>Body E</p>')
  expect(storage.requests.at(-1)?.guard).toEqual(await recordWriteGuard(newer, table))
})

it.each(kinds.flatMap(kind => (['ack', 'hash'] as const).map(boundary => ({ kind, boundary }))))('$kind a failed Save during compensation $boundary does not leave a persistent stale pin', async ({ kind, boundary }) => {
  const { result, record, storage, pending, release, table } = await heldCompensation(kind, boundary)
  await act(async () => { await saveCurrent(result.current, kind) })
  expect(storage.read()).toEqual(record)
  expect(current(result.current, kind).title).toBe('Retained C')
  await act(async () => { release.resolve(); await pending })
  let saved = false
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(saved).toBe(true)
  expect(storage.read().title).toBe('Retained C')
  expect(storage.read().body).toBe('<p>Body C</p>')
  expect(storage.requests.at(-1)?.guard).toEqual(await recordWriteGuard(record, table))
})

it.each(kinds)('%s retires a retry superseded during its initial guard computation', async kind => {
  const { result, storage, save } = await open(kind)
  save.mockRejectedValueOnce(new Error('Synthetic canonicalization failure'))
  await act(async () => {
    if (kind === 'finding') await result.current.canonicalizeGeneratedFinding(result.current.findings[0], result.current.findings[0])
    else await result.current.canonicalizeGeneratedDraft(result.current.testwareDrafts[0], result.current.testwareDrafts[0])
  })
  const reached = deferred<void>(); const release = deferred<void>()
  const digest = crypto.subtle.digest.bind(crypto.subtle)
  let armed = true
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    const hold = armed; if (hold) armed = false
    const value = await digest(algorithm, data)
    if (hold) { reached.resolve(); await release.promise }
    return value
  })
  let retry!: Promise<boolean>
  act(() => { retry = result.current.retryAllPendingRecordCompensations() })
  await act(async () => { await reached.promise })
  act(() => { discard(result.current, kind); edit(result.current, kind, 'New generation D', 'Body D') })
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  await act(async () => { release.resolve(); expect(await retry).toBe(true) })
  expect(storage.read().title).toBe('New generation D')
  expect(storage.read().body).toBe('<p>Body D</p>')
  expect(current(result.current, kind).title).toBe('New generation D')
  expect(storage.requests).toHaveLength(1)
  expect(result.current.error).toBeNull()
  act(() => edit(result.current, kind, 'Saved E', 'Body E'))
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  expect(storage.read().title).toBe('Saved E')
})
