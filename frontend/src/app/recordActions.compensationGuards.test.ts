import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { recordWriteGuard } from './recordWriteGuards'
import { cleanupControllerTest, setupControllerTest } from './useAppController.testHarness'
import { kinds, current, edit, saveCurrent, heldSave, heldCompensation } from './recordActions.compensationGuards.testSupport'
import type { WritePatch } from './recordActions.compensationGuards.testSupport'

beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it.each(kinds)('%s saves C against confirmed restored A after B acknowledgement and compensation', async kind => {
  const { result, record, storage, acknowledge, pending, table } = await heldSave(kind)
  await act(async () => { acknowledge.resolve(); await pending })
  expect(storage.read()).toEqual(record)
  expect(current(result.current, kind).title).toBe('Retained C')
  expect(current(result.current, kind).body).toBe('<p>Body C</p>')
  let saved = false
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(storage.read().title).toBe('Retained C')
  expect(storage.read().body).toBe('<p>Body C</p>')
  expect(saved).toBe(true)
  expect(storage.requests.at(-1)?.guard).toEqual(await recordWriteGuard(record, table))
})

it.each(kinds.flatMap(kind => (['ack', 'hash'] as const).map(boundary => ({ kind, boundary }))))('$kind keeps edits made during compensation $boundary and saves against restored A', async ({ kind, boundary }) => {
  const { result, record, storage, pending, release, table } = await heldCompensation(kind, boundary)
  act(() => edit(result.current, kind, 'Later C', 'Later body C'))
  await act(async () => { release.resolve(); await pending })
  expect(storage.read()).toEqual(record)
  expect(current(result.current, kind).title).toBe('Later C')
  let saved = false
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(saved).toBe(true)
  expect(storage.read().title).toBe('Later C')
  expect(storage.read().body).toBe('<p>Later body C</p>')
  expect(storage.requests.at(-1)?.guard).toEqual(await recordWriteGuard(record, table))
})

it.each(kinds.flatMap(kind => [false, true].map(lostAck => ({ kind, lostAck }))))('$kind compensation retry converges after lost acknowledgement $lostAck', async ({ kind, lostAck }) => {
  const { result, record, storage, save, acknowledge, pending, table } = await heldSave(kind)
  save.mockImplementationOnce(async (id: string, patch: WritePatch, guard: RecordWriteGuard) => {
    if (lostAck) await storage.write(id, patch, guard)
    throw new Error('Synthetic compensation transport failure')
  })
  await act(async () => { acknowledge.resolve(); await pending })
  expect(storage.read().title).toBe(lostAck ? 'Saved A' : 'Committed B')
  expect(current(result.current, kind).title).toBe('Retained C')
  await act(async () => { expect(await result.current.retryAllPendingRecordCompensations()).toBe(true) })
  expect(storage.read()).toEqual(record)
  expect(storage.writes()).toBe(2)
  expect(storage.requests.at(-1)?.guard.origin.kind).toBe('compensation')
  let saved = false
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(saved).toBe(true)
  expect(storage.read().title).toBe('Retained C')
  expect(storage.read().body).toBe('<p>Body C</p>')
  expect(storage.requests.at(-1)?.guard).toEqual(await recordWriteGuard(record, table))
})

it.each(kinds)('%s compensation conflict retains its old base and never adopts a second client', async kind => {
  const { result, storage, save, acknowledge, pending, table } = await heldSave(kind)
  const committed = storage.read()
  const secondClient = { ...committed, title: 'Second client D', body: '<p>Body D</p>' }
  save.mockImplementationOnce(async (id: string, patch: WritePatch, guard: RecordWriteGuard) => {
    storage.external(secondClient)
    return storage.write(id, patch, guard)
  })
  await act(async () => { acknowledge.resolve(); await pending })
  expect(storage.read()).toEqual(secondClient)
  expect(current(result.current, kind).title).toBe('Retained C')
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(false) })
    expect(storage.read().title).toBe('Second client D')
    expect(storage.read().body).toBe('<p>Body D</p>')
    expect(storage.requests.at(-1)?.guard).toEqual(await recordWriteGuard(committed, table))
  }
})
