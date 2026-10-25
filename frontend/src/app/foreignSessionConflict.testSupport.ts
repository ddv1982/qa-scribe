import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import type { Draft, DraftPatch, Finding, FindingPatch, RecordWriteGuard } from '../bindings'
import { draftFixture, entryFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { recordWriteGuard, RecordWriteConflict } from './recordWriteGuards'
import { deferred, getTauriMock, sessionNoteStateFixture, useAppController } from './useAppController.testHarness'

export type RecordKind = 'draft' | 'finding'
export const recordKinds = ['draft', 'finding'] as const
export const richBody = (text: string) => richEditorDocumentToStoredBody(richEditorDocumentFromPlainText(text))
type RecordValue = Draft | Finding
type WritePatch = DraftPatch | FindingPatch
type Controller = ReturnType<typeof useAppController>
export type WriteRequest = {
  id: string
  patch: WritePatch
  guard: RecordWriteGuard
  actualBase: string
  before: RecordValue
  after: RecordValue
  outcome: 'saved' | 'restored-noop' | 'conflict'
}

export const currentRecord = (controller: Controller, kind: RecordKind) => kind === 'draft' ? controller.testwareDrafts[0] : controller.findings[0]
export const saveCurrentRecord = (controller: Controller, kind: RecordKind) => kind === 'draft'
  ? controller.handleSaveDraft(controller.testwareDrafts[0])
  : controller.handleSaveFinding(controller.findings[0])
export function editCurrentRecord(controller: Controller, kind: RecordKind, title: string, body: string) {
  const patch = { title, ...richBody(body) }
  if (kind === 'draft') controller.updateLocalDraft(controller.testwareDrafts[0].id, patch)
  else controller.updateLocalFinding(controller.findings[0].id, patch)
}

export async function openConflictSubject(kind: RecordKind) {
  const api = getTauriMock()
  const initial = kind === 'draft' ? draftFixture({ title: 'Saved A', ...richBody('Body A') }) : findingFixture({ title: 'Saved A', ...richBody('Body A') })
  const draftTwo = draftFixture({ id: 'draft-2', sessionId: 'session-2', title: 'B Draft', ...richBody('B Draft body') })
  const findingTwo = findingFixture({ id: 'finding-2', sessionId: 'session-2', title: 'B Finding', ...richBody('B Finding body') })
  const table = kind === 'draft' ? 'drafts' as const : 'findings' as const
  const rows = new Map<string, RecordValue>([[initial.id, initial], [kind === 'draft' ? draftTwo.id : findingTwo.id, kind === 'draft' ? draftTwo : findingTwo]])
  const requests: WriteRequest[] = []
  async function transact(id: string, patch: WritePatch, guard: RecordWriteGuard) {
    const before = rows.get(id)!
    expect(before).toBeDefined()
    expect(guard.sessionId).toBe(before.sessionId)
    expect(guard.origin.kind === 'editor' || (guard.origin.kind === 'compensation' && guard.origin.stageId === null)).toBe(true)
    const actualBase = (await recordWriteGuard(before, table)).expectedStoredBase
    let after = before
    let outcome: WriteRequest['outcome'] = 'saved'
    if (actualBase !== guard.expectedStoredBase) {
      outcome = guard.origin.kind === 'compensation' && guard.origin.restoredBase === actualBase ? 'restored-noop' : 'conflict'
    } else {
      after = {
        ...before, title: patch.title ?? before.title, body: patch.body ?? before.body,
        bodyJson: patch.bodyJson === undefined ? before.bodyJson : patch.bodyJson,
        bodyFormat: patch.bodyFormat === undefined ? before.bodyFormat : patch.bodyFormat,
        metadataJson: patch.metadataJson === undefined ? before.metadataJson : patch.metadataJson,
      }
      if (!('aiRunId' in after) && 'kind' in patch) after = { ...after, kind: patch.kind ?? after.kind }
      if (guard.origin.kind === 'compensation') expect((await recordWriteGuard(after, table)).expectedStoredBase).toBe(guard.origin.restoredBase)
      rows.set(id, after)
    }
    requests.push({ id, patch, guard, actualBase, before, after, outcome })
    return { record: { ...after }, outcome }
  }
  async function write(id: string, patch: WritePatch, guard: RecordWriteGuard) {
    const result = await transact(id, patch, guard)
    if (result.outcome === 'conflict') throw new RecordWriteConflict(result.record)
    return result.record
  }
  const update = kind === 'draft' ? api.updateDraft : api.updateFinding
  update.mockImplementation(write)
  api.listDrafts.mockImplementation((sessionId: string) => Promise.resolve(sessionId === 'session-2' ? [rows.get(draftTwo.id) ?? draftTwo] : kind === 'draft' ? [rows.get(initial.id)] : []))
  api.listFindings.mockImplementation((sessionId: string) => Promise.resolve(sessionId === 'session-2' ? [rows.get(findingTwo.id) ?? findingTwo] : kind === 'finding' ? [rows.get(initial.id)] : []))
  let note = entryFixture()
  api.updateEntry.mockImplementation((id: string, patch: object) => {
    expect(id).toBe(note.id)
    expect(note.sessionId).toBe('session-1')
    note = { ...note, ...patch }
    return Promise.resolve({ ...note })
  })
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.activeSession?.id).toBe('session-1'))
  act(() => hook.result.current.setActiveView(kind === 'draft' ? 'testware' : 'findings'))
  await waitFor(() => expect(currentRecord(hook.result.current, kind)).toEqual(initial))
  async function openSessionTwo() {
    vi.useRealTimers()
    const sessionTwo = sessionFixture({ id: 'session-2', title: 'Session Two' })
    api.openSessionNoteState.mockImplementationOnce((sessionId: string) => {
      expect(sessionId).toBe('session-2')
      return Promise.resolve(sessionNoteStateFixture({ session: sessionTwo, noteEntry: entryFixture({ id: 'entry-2', sessionId: 'session-2' }), testwareDraftCount: 1, findingCount: 1 }))
    })
    await act(async () => { await hook.result.current.openSession(sessionTwo) })
    expect(hook.result.current.activeSession?.id).toBe('session-2')
    await act(async () => {
      await hook.result.current.loadDraftsForSession('session-2')
      await hook.result.current.loadFindingsForSession('session-2')
    })
    expect(hook.result.current.testwareDrafts).toEqual([draftTwo])
    expect(hook.result.current.findings).toEqual([findingTwo])
  }
  return { ...hook, api, initial, draftTwo, findingTwo, table, requests, update, transact, write, openSessionTwo, stored: (id = initial.id) => rows.get(id)! }
}

export async function holdFirstRecordSave(kind: RecordKind, sameCanonical = false) {
  const subject = await openConflictSubject(kind)
  const committed = deferred<void>()
  const acknowledge = deferred<void>()
  subject.update.mockImplementationOnce(async (id: string, patch: WritePatch, guard: RecordWriteGuard) => {
    const record = await subject.write(id, patch, guard)
    committed.resolve()
    await acknowledge.promise
    return record
  })
  vi.useFakeTimers()
  act(() => {
    subject.result.current.setNoteBody(richEditorDocumentFromPlainText('Earlier scheduled Note autosave'))
    editCurrentRecord(subject.result.current, kind, sameCanonical ? 'Saved A' : 'Committed B', sameCanonical ? 'Body A' : 'Body B')
  })
  let pending!: Promise<boolean>
  act(() => { pending = saveCurrentRecord(subject.result.current, kind) })
  await act(async () => { await committed.promise })
  expect(subject.result.current.isBusy).toBe(true)
  await act(async () => { await vi.advanceTimersByTimeAsync(850) })
  expect(subject.api.updateEntry).toHaveBeenCalledTimes(1)
  expect(subject.result.current.isBusy).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(true)
  return { ...subject, acknowledge, pending }
}

export async function holdLatestRecordResult(kind: RecordKind, mode: 'conflict' | 'generic-error' | 'same-canonical' = 'conflict') {
  const subject = await holdFirstRecordSave(kind, mode === 'same-canonical')
  act(() => {
    if (kind === 'draft') subject.result.current.discardLocalDraft(subject.result.current.testwareDrafts[0])
    else subject.result.current.discardLocalFinding(subject.result.current.findings[0])
  })
  expect(currentRecord(subject.result.current, kind)).toEqual(subject.initial)
  expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
  const computed = deferred<void>()
  const deliver = deferred<void>()
  subject.update.mockImplementationOnce(async (id: string, patch: WritePatch, guard: RecordWriteGuard) => {
    const result = await subject.transact(id, patch, guard)
    expect(result.outcome).toBe(mode === 'same-canonical' ? 'saved' : 'conflict')
    computed.resolve()
    await deliver.promise
    if (mode === 'generic-error') throw new Error('Synthetic late record transport failure')
    if (result.outcome === 'conflict') throw new RecordWriteConflict(result.record)
    return result.record
  })
  let latest!: Promise<boolean>
  act(() => { latest = saveCurrentRecord(subject.result.current, kind) })
  await act(async () => { await computed.promise })
  expect(subject.result.current.isBusy).toBe(true)
  await act(async () => {
    subject.acknowledge.resolve()
    expect(await subject.pending).toBe(false)
  })
  expect(subject.stored()).toEqual(subject.initial)
  expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
  expect(subject.result.current.isBusy).toBe(false)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(true)
  async function deliverLatest() {
    await act(async () => {
      deliver.resolve()
      expect(await latest).toBe(false)
    })
    expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
    expect(subject.result.current.sessionChat.recordWritesPending).toBe(false)
  }
  return { ...subject, deliverLatest }
}
