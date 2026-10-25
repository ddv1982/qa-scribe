import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { recordWriteGuard, RecordWriteConflict } from './recordWriteGuards'
import { cleanupControllerTest, getTauriMock, setupControllerTest, deferred } from './useAppController.testHarness'
import { kinds, current, edit, discard, saveCurrent, open, heldSave, heldCompensation } from './recordActions.compensationGuards.testSupport'
import type { WritePatch } from './recordActions.compensationGuards.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it.each(kinds)('%s a retired compensation conflict cannot replace a newer confirmed saved ref', async kind => {
  const { result, record, storage, save, acknowledge, pending } = await heldSave(kind)
  const reached = deferred<void>(); const release = deferred<void>()
  const remote = { ...record, title: 'Second client D', ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Body D')) }
  save.mockImplementationOnce(async (id: string, patch: WritePatch, guard: RecordWriteGuard) => {
    storage.external(remote)
    try { return await storage.write(id, patch, guard) }
    catch (cause) { reached.resolve(); await release.promise; throw cause }
  })
  act(() => acknowledge.resolve())
  await act(async () => { await reached.promise })
  await act(async () => {
    if (kind === 'finding') { api.listFindings.mockResolvedValue([remote]); await result.current.loadFindingsForSession(record.sessionId, { force: true, replace: true }) }
    else { api.listDrafts.mockResolvedValue([remote]); await result.current.loadDraftsForSession(record.sessionId, { force: true, replace: true }) }
  })
  act(() => { discard(result.current, kind); edit(result.current, kind, 'Confirmed E', 'Body E') })
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  const confirmed = storage.read()
  await act(async () => { release.resolve(); await pending })
  expect(storage.read()).toEqual(confirmed)
  expect(current(result.current, kind).title).toBe('Confirmed E')
  expect(result.current.error).toBeNull()
  act(() => edit(result.current, kind, 'Confirmed F', 'Body F'))
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  expect(storage.read().title).toBe('Confirmed F')
  expect(storage.read().body).toBe('<p>Body F</p>')
})

it.each(kinds)('%s a delayed failed Save cannot replace a newer confirmed base', async kind => {
  const { result, storage, save, pending, release } = await heldCompensation(kind, 'ack')
  const failed = deferred<void>(); const releaseFailure = deferred<void>()
  save.mockImplementationOnce(async (id: string, patch: WritePatch, guard: RecordWriteGuard) => {
    try { return await storage.write(id, patch, guard) }
    catch (cause) { failed.resolve(); await releaseFailure.promise; throw cause }
  })
  let earlierSave!: Promise<boolean>
  act(() => { earlierSave = saveCurrent(result.current, kind) })
  await act(async () => { await failed.promise })
  await act(async () => { release.resolve(); await pending })
  act(() => { discard(result.current, kind); edit(result.current, kind, 'Confirmed D', 'Body D') })
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  const confirmed = storage.read()
  await act(async () => { releaseFailure.resolve(); await earlierSave })
  expect(storage.read()).toEqual(confirmed)
  expect(current(result.current, kind).title).toBe('Confirmed D')
  act(() => edit(result.current, kind, 'Saved E after delayed failure', 'Body E'))
  let saved = false
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(saved).toBe(true)
  expect(storage.read().title).toBe('Saved E after delayed failure')
  expect(storage.read().body).toBe('<p>Body E</p>')
})

it.each(kinds)('%s keeps the newer failure visible and saves edits made after that failure', async kind => {
  const { result, storage, pending, release } = await heldCompensation(kind, 'ack')
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(false) })
  const error = result.current.error
  expect(error).toContain('Stored record changed')
  act(() => edit(result.current, kind, 'Later retained C', 'Later body C'))
  await act(async () => { release.resolve(); await pending })
  expect(storage.read().title).toBe('Saved A')
  expect(current(result.current, kind).title).toBe('Later retained C')
  expect(result.current.error).toBe(error)
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  expect(storage.read().title).toBe('Later retained C')
  expect(storage.read().body).toBe('<p>Later body C</p>')
})

it.each(kinds)('%s never adopts a second client after a confirmed restore', async kind => {
  const { result, record, storage, pending, release, table } = await heldCompensation(kind, 'ack')
  const remote = { ...record, title: 'Remote D', body: '<p>Remote body D</p>' }
  storage.external(remote)
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(false) })
  await act(async () => { release.resolve(); await pending })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(false) })
    expect(storage.read()).toEqual(remote)
    expect(current(result.current, kind).title).toBe('Retained C')
    expect(storage.requests.at(-1)?.guard).toEqual(await recordWriteGuard(record, table))
  }
})

it.each(kinds)('%s ignores a retired canonicalization conflict after a newer confirmed Save', async kind => {
  const { result, record, storage, save } = await open(kind)
  const reached = deferred<void>(); const release = deferred<void>()
  save.mockImplementationOnce(async () => { reached.resolve(); await release.promise; throw new RecordWriteConflict(record) })
  let pending!: Promise<void>
  act(() => { pending = kind === 'finding'
    ? result.current.canonicalizeGeneratedFinding(result.current.findings[0], result.current.findings[0])
    : result.current.canonicalizeGeneratedDraft(result.current.testwareDrafts[0], result.current.testwareDrafts[0]) })
  await act(async () => { await reached.promise })
  act(() => edit(result.current, kind, 'Confirmed D', 'Body D'))
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  const confirmed = storage.read()
  await act(async () => { release.resolve(); await pending })
  expect(storage.read()).toEqual(confirmed)
  expect(result.current.error).toBeNull()
  act(() => edit(result.current, kind, 'Next E', 'Body E'))
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  expect(storage.read().title).toBe('Next E')
  expect(storage.read().body).toBe('<p>Body E</p>')
})
