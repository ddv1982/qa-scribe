import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { sessionFixture } from '../test/fixtures'
import { recordWriteGuard } from './recordWriteGuards'
import { cleanupControllerTest, setupControllerTest } from './useAppController.testHarness'
import { holdExplicitSave, observeForcedSaveStart, openSaveGuardSubject, recordKinds, richBody, startForcedSave } from './recordSaveGuards.testSupport'
import { storedRecordBase } from './recordSaveGuards.storage.testSupport'

beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

const schedules = [
  { boundary: 'before-commit', entryPoint: 'flush' },
  { boundary: 'after-commit', entryPoint: 'flush' },
  { boundary: 'before-commit', entryPoint: 'navigation' },
  { boundary: 'before-commit', entryPoint: 'close' },
] as const

it.each(recordKinds.flatMap(kind => schedules.map(schedule => ({ kind, ...schedule }))))(
  '$kind $entryPoint waits for an explicit Save acknowledgement held $boundary before saving S2', async ({ kind, boundary, entryPoint }) => {
    const subject = await openSaveGuardSubject(kind)
    const first = await holdExplicitSave(subject, boundary)
    subject.edit('Retained S2')
    const forced = startForcedSave(subject, entryPoint)
    let outcome: boolean | void = undefined
    try {
      await observeForcedSaveStart()
      expect.soft(subject.update).toHaveBeenCalledTimes(1)
      expect.soft(subject.api.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
      expect.soft(forced.windowMock.currentWindow.destroy).not.toHaveBeenCalled()
    } finally {
      await act(async () => { first.release(); await first.pending; outcome = await forced.pending })
    }
    expect.soft(subject.storage.read().title).toBe('Retained S2')
    expect.soft(subject.storage.read().body).toBe('<p>Body Retained S2</p>')
    expect.soft(subject.result.current.error).toBeNull()
    expect.soft(subject.result.current.hasPendingSessionEdits()).toBe(false)
    expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
    if (entryPoint === 'flush') expect.soft(outcome).toBe(true)
    else if (entryPoint === 'navigation') expect.soft(subject.result.current.activeSession?.id).toBe('session-2')
    else {
      expect(forced.closeEvent.preventDefault).toHaveBeenCalledOnce()
      expect.soft(forced.windowMock.currentWindow.destroy).toHaveBeenCalledOnce()
    }
    if (entryPoint !== 'navigation') {
      expect(subject.current().title).toBe('Retained S2')
      expect(subject.current().body).toBe('<p>Body Retained S2</p>')
    }
  },
)

it.each(recordKinds)('%s forced flush recaptures edits made while an explicit Save acknowledgement is pending', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const first = await holdExplicitSave(subject, 'after-commit')
  subject.edit('S2')
  const forced = startForcedSave(subject, 'flush')
  let outcome: boolean | void = undefined
  try {
    await observeForcedSaveStart()
    expect.soft(subject.update).toHaveBeenCalledTimes(1)
    subject.edit('Latest S3')
  } finally {
    await act(async () => { first.release(); await first.pending; outcome = await forced.pending })
  }
  expect.soft(outcome).toBe(true)
  expect.soft(subject.update).toHaveBeenCalledTimes(2)
  expect.soft(subject.storage.read().title).toBe('Latest S3')
  expect.soft(subject.storage.read().body).toBe('<p>Body Latest S3</p>')
  expect(subject.current().title).toBe('Latest S3')
  expect(subject.current().body).toBe('<p>Body Latest S3</p>')
  expect.soft(subject.result.current.error).toBeNull()
  expect.soft(subject.result.current.hasPendingSessionEdits()).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds)('%s ignores an obsolete Session destination after waiting for an explicit Save', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const first = await holdExplicitSave(subject, 'after-commit')
  subject.edit('Retained S2')
  const obsolete = startForcedSave(subject, 'navigation')
  let latest!: Promise<void>
  try {
    await observeForcedSaveStart()
    expect.soft(subject.update).toHaveBeenCalledTimes(1)
    act(() => { latest = subject.result.current.openSession(sessionFixture({ id: 'session-3', title: 'Latest Session' })) })
    await observeForcedSaveStart()
    expect.soft(subject.update).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { first.release(); await first.pending; await Promise.all([obsolete.pending, latest]) })
  }
  expect(subject.api.openSessionNoteState).not.toHaveBeenCalledWith('session-2')
  expect.soft(subject.result.current.activeSession?.id).toBe('session-3')
  expect.soft(subject.storage.read().title).toBe('Retained S2')
  expect.soft(subject.storage.read().body).toBe('<p>Body Retained S2</p>')
  expect.soft(subject.result.current.error).toBeNull()
  expect.soft(subject.result.current.hasPendingSessionEdits()).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds)('%s preserves a foreign write and its own rejected Editor base', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const guard = await recordWriteGuard(subject.initial, kind === 'draft' ? 'drafts' : 'findings')
  expect(guard.expectedStoredBase).toBe(storedRecordBase(subject.initial, kind))
  subject.storage.external({ ...subject.initial, title: 'Foreign S9', ...richBody('Foreign body S9') })
  subject.edit('Retained S1')
  await act(async () => { expect(await subject.flush()).toBe(false) })
  expect(subject.storage.read().title).toBe('Foreign S9')
  expect(subject.storage.read().body).toBe('<p>Foreign body S9</p>')
  expect(subject.current().title).toBe('Retained S1')
  expect(subject.current().body).toBe('<p>Body Retained S1</p>')
  expect(subject.storage.requests[0].guard).toEqual(guard)
  expect(subject.result.current.error).toBe('Stored record changed. Your local changes are retained. Use Discard to review the latest saved record before requesting another refinement.')
  expect(subject.result.current.hasPendingSessionEdits()).toBe(true)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})
