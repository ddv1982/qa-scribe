import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { cleanupControllerTest, deferred, getTauriWindowMock, setupControllerTest } from './useAppController.testHarness'
import { observeForcedSaveStart, openSaveGuardSubject, recordKinds, startForcedSave, type SaveGuardSubject } from './recordSaveGuards.testSupport'
import type { RecordPatch } from './recordSaveGuards.storage.testSupport'

beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

async function holdForcedRow(subject: SaveGuardSubject) {
  const reached = deferred<void>()
  const release = deferred<void>()
  const acknowledged = deferred<void>()
  subject.update.mockImplementation(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    await acknowledged.promise
    return subject.storage.write(id, patch, guard)
  })
  subject.update.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    reached.resolve()
    await release.promise
    const saved = await subject.storage.write(id, patch, guard)
    acknowledged.resolve()
    return saved
  })
  let pending!: Promise<boolean>
  act(() => { pending = subject.result.current.saveDirtyRecordsNow() })
  await act(async () => { await reached.promise })
  return { pending, release: () => release.resolve() }
}

it.each(recordKinds)('%s simultaneous direct dirty-record saves join one forced pass', async kind => {
  const subject = await openSaveGuardSubject(kind)
  subject.edit('S1')
  const first = await holdForcedRow(subject)
  let second!: Promise<boolean>
  let outcomes: boolean[] = []
  try {
    act(() => { second = subject.result.current.saveDirtyRecordsNow() })
    await observeForcedSaveStart()
    expect.soft(subject.update).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { first.release(); outcomes = await Promise.all([first.pending, second]) })
  }
  expect.soft(outcomes).toEqual([true, true])
  expect.soft(subject.update).toHaveBeenCalledTimes(1)
  expect(subject.storage.read().title).toBe('S1')
  expect(subject.storage.read().body).toBe('<p>Body S1</p>')
  expect.soft(subject.result.current.error).toBeNull()
  expect.soft(subject.result.current.hasPendingSessionEdits()).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds)('%s admits an explicit Save started after a forced row dispatch without an own-write conflict', async kind => {
  const subject = await openSaveGuardSubject(kind)
  subject.edit('S1')
  const forced = await holdForcedRow(subject)
  subject.edit('Latest S2')
  let explicit!: Promise<boolean>
  let outcomes: boolean[] = []
  try {
    act(() => { explicit = subject.save() })
    await observeForcedSaveStart()
    expect.soft(subject.update).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { forced.release(); outcomes = await Promise.all([forced.pending, explicit]) })
  }
  expect.soft(outcomes).toEqual([true, true])
  expect.soft(subject.storage.read().title).toBe('Latest S2')
  expect.soft(subject.storage.read().body).toBe('<p>Body Latest S2</p>')
  expect(subject.current().title).toBe('Latest S2')
  expect(subject.current().body).toBe('<p>Body Latest S2</p>')
  expect.soft(subject.result.current.error).toBeNull()
  expect.soft(subject.result.current.hasPendingSessionEdits()).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds.flatMap(kind => (['direct', 'flush', 'navigation', 'new-session', 'close'] as const).map(entryPoint => ({ kind, entryPoint }))))(
  '$kind $entryPoint X/Y pass persists latest Y2 when an explicit Y1 Save starts during X', async ({ kind, entryPoint }) => {
  const subject = await openSaveGuardSubject(kind, true)
  const reachedX = deferred<void>()
  const releaseX = deferred<void>()
  const releaseY = deferred<void>()
  subject.update.mockImplementation(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    if (id === subject.initial.id) {
      reachedX.resolve()
      await releaseX.promise
    } else await releaseY.promise
    return subject.storage.write(id, patch, guard)
  })
  subject.edit(' X1 ', 'Body X1')
  subject.editRecord(subject.secondId, 'Y1')
  let forced!: Promise<boolean | void>
  let explicit!: Promise<boolean>
  let forcedResult: boolean | void = undefined
  let explicitResult: boolean | undefined
  if (entryPoint === 'direct') act(() => { forced = subject.result.current.saveDirtyRecordsNow() })
  else if (entryPoint === 'new-session') act(() => { forced = subject.result.current.handleNewSession() })
  else forced = startForcedSave(subject, entryPoint).pending
  await act(async () => { await reachedX.promise })
  try {
    act(() => { explicit = subject.save(subject.secondId) })
    subject.editRecord(subject.secondId, 'Y2')
    await act(async () => { releaseX.resolve() })
    await waitFor(() => expect(subject.current().title).toBe('X1'))
    await observeForcedSaveStart()
  } finally {
    await act(async () => {
      releaseX.resolve(); releaseY.resolve()
      const results = await Promise.all([forced, explicit])
      forcedResult = results[0]
      explicitResult = results[1]
    })
  }
  if (entryPoint === 'direct' || entryPoint === 'flush') expect.soft(forcedResult).toBe(true)
  expect(explicitResult).toBe(true)
  if (entryPoint === 'navigation' || entryPoint === 'new-session') expect(subject.result.current.activeSession?.id).toBe('session-1')
  if (entryPoint === 'new-session') expect(subject.api.createSession).not.toHaveBeenCalled()
  if (entryPoint === 'close') expect(getTauriWindowMock().currentWindow.destroy).toHaveBeenCalledOnce()
  expect(subject.storage.read().title).toBe('X1')
  expect.soft(subject.storage.read(subject.secondId).title).toBe('Y2')
  expect.soft(subject.storage.read(subject.secondId).body).toBe('<p>Body Y2</p>')
  expect(subject.current(subject.secondId).title).toBe('Y2')
  expect(subject.current(subject.secondId).body).toBe('<p>Body Y2</p>')
  expect.soft(subject.result.current.error).toBeNull()
  expect.soft(subject.result.current.hasPendingSessionEdits()).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
  },
)
