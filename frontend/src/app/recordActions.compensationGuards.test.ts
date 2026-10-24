import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DraftPatch, FindingPatch, RecordWriteGuard } from '../bindings'
import { draftFixture, findingFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { recordWriteGuard, RecordWriteConflict } from './recordWriteGuards'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

type Kind = 'finding' | 'test_cases_draft'
type Controller = ReturnType<typeof useAppController>
type RecordValue = ReturnType<typeof findingFixture> | ReturnType<typeof draftFixture>
type WritePatch = FindingPatch | DraftPatch
const kinds = ['finding', 'test_cases_draft'] as const
const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

function current(controller: Controller, kind: Kind) { return kind === 'finding' ? controller.findings[0] : controller.testwareDrafts[0] }
function edit(controller: Controller, kind: Kind, title: string, body = title) {
  const patch = { title, ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText(body)) }
  if (kind === 'finding') controller.updateLocalFinding('finding-1', patch)
  else controller.updateLocalDraft('draft-1', patch)
}
function discard(controller: Controller, kind: Kind) {
  if (kind === 'finding') controller.discardLocalFinding(controller.findings[0])
  else controller.discardLocalDraft(controller.testwareDrafts[0])
}
async function saveCurrent(controller: Controller, kind: Kind) {
  return kind === 'finding' ? controller.handleSaveFinding(controller.findings[0]) : controller.handleSaveDraft(controller.testwareDrafts[0])
}
function stored(kind: Kind, initial: RecordValue) {
  let row = initial
  let writes = 0
  const table = kind === 'finding' ? 'findings' : 'drafts'
  const requests: Array<{ patch: WritePatch; guard: RecordWriteGuard }> = []
  async function write(_id: string, patch: WritePatch, guard: RecordWriteGuard) {
    requests.push({ patch, guard })
    const currentBase = await recordWriteGuard(row, table)
    if (guard.origin.kind === 'compensation' && guard.origin.restoredBase === currentBase.expectedStoredBase) return { ...row }
    if (guard.sessionId !== row.sessionId || guard.expectedStoredBase !== currentBase.expectedStoredBase) throw new RecordWriteConflict({ ...row })
    const next = { ...row, title: patch.title ?? row.title, body: patch.body ?? row.body,
      bodyJson: patch.bodyJson === undefined ? row.bodyJson : patch.bodyJson,
      bodyFormat: patch.bodyFormat === undefined ? row.bodyFormat : patch.bodyFormat,
      metadataJson: patch.metadataJson === undefined ? row.metadataJson : patch.metadataJson }
    if (guard.origin.kind === 'compensation') {
      const nextBase = await recordWriteGuard(next, table)
      if (nextBase.expectedStoredBase !== guard.origin.restoredBase) throw new Error('Compensation does not match its pinned restored record')
    }
    row = next; writes += 1
    return { ...row }
  }
  return { write, read: () => row, requests, writes: () => writes, external: (value: RecordValue) => { row = value } }
}
async function open(kind: Kind) {
  const initial = { title: 'Saved A', body: '<p>Body A</p>', metadataJson: '{"unknown":{"retained":true}}' }
  const record = kind === 'finding' ? findingFixture(initial) : draftFixture(initial)
  const storage = stored(kind, record)
  api.listFindings.mockResolvedValue(kind === 'finding' ? [record] : [])
  api.listDrafts.mockResolvedValue(kind === 'test_cases_draft' ? [record] : [])
  const save = kind === 'finding' ? api.updateFinding : api.updateDraft
  save.mockImplementation(storage.write)
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.activeSession?.id).toBe('session-1'))
  await act(async () => { hook.result.current.setActiveView(kind === 'finding' ? 'findings' : 'testware') })
  await waitFor(() => expect(current(hook.result.current, kind)?.title).toBe('Saved A'))
  return { ...hook, record, storage, save, table: kind === 'finding' ? 'findings' as const : 'drafts' as const }
}
async function heldSave(kind: Kind) {
  const subject = await open(kind)
  const committed = deferred<void>(); const acknowledge = deferred<void>()
  subject.save.mockImplementationOnce(async (id: string, patch: WritePatch, guard: RecordWriteGuard) => {
    const row = await subject.storage.write(id, patch, guard)
    committed.resolve(); await acknowledge.promise
    return row
  })
  act(() => edit(subject.result.current, kind, 'Committed B', 'Body B'))
  let pending!: Promise<boolean>
  act(() => { pending = subject.result.current.saveDirtyRecordsNow() })
  await act(async () => { await committed.promise })
  expect(subject.storage.read().title).toBe('Committed B')
  expect(subject.storage.read().body).toBe('<p>Body B</p>')
  act(() => { discard(subject.result.current, kind); edit(subject.result.current, kind, 'Retained C', 'Body C') })
  return { ...subject, acknowledge, pending }
}

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

async function heldCompensation(kind: Kind, boundary: 'ack' | 'hash') {
  const subject = await heldSave(kind)
  const reached = deferred<void>(); const release = deferred<void>()
  let armed = false
  if (boundary === 'hash') {
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      const hold = armed; if (hold) armed = false
      const value = await digest(algorithm, data)
      if (hold) { reached.resolve(); await release.promise }
      return value
    })
  }
  subject.save.mockImplementationOnce(async (id: string, patch: WritePatch, guard: RecordWriteGuard) => {
    const row = await subject.storage.write(id, patch, guard)
    if (boundary === 'hash') armed = true
    else { reached.resolve(); await release.promise }
    return row
  })
  act(() => subject.acknowledge.resolve())
  await act(async () => { await reached.promise })
  expect(subject.storage.read()).toEqual(subject.record)
  return { ...subject, release }
}

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
