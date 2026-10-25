import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import type { DraftPatch, FindingPatch, RecordWriteGuard } from '../bindings'
import { draftFixture, findingFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { recordWriteGuard, RecordWriteConflict } from './recordWriteGuards'
import { deferred, getTauriMock, useAppController } from './useAppController.testHarness'

type Kind = 'finding' | 'test_cases_draft'

type Controller = ReturnType<typeof useAppController>

type RecordValue = ReturnType<typeof findingFixture> | ReturnType<typeof draftFixture>

export type WritePatch = FindingPatch | DraftPatch

export const kinds = ['finding', 'test_cases_draft'] as const

const api = getTauriMock()

export function current(controller: Controller, kind: Kind) { return kind === 'finding' ? controller.findings[0] : controller.testwareDrafts[0] }

export function edit(controller: Controller, kind: Kind, title: string, body = title) {
  const patch = { title, ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText(body)) }
  if (kind === 'finding') controller.updateLocalFinding('finding-1', patch)
  else controller.updateLocalDraft('draft-1', patch)
}

export function discard(controller: Controller, kind: Kind) {
  if (kind === 'finding') controller.discardLocalFinding(controller.findings[0])
  else controller.discardLocalDraft(controller.testwareDrafts[0])
}

export async function saveCurrent(controller: Controller, kind: Kind) {
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

export async function open(kind: Kind) {
  const initial = { title: 'Saved A', body: '<p>Body A</p>', metadataJson: '{"unknown":{"retained":true}}' }
  const record = kind === 'finding' ? findingFixture(initial) : draftFixture(initial)
  const storage = stored(kind, record)
  api.listFindings.mockResolvedValue(kind === 'finding' ? [record] : [])
  api.listDrafts.mockResolvedValue(kind === 'test_cases_draft' ? [record] : [])
  const save = kind === 'finding' ? api.updateFinding : api.updateDraft
  save.mockImplementation(storage.write)
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.activeSession?.id).toBe('session-1'))
  // oxlint-disable-next-line typescript/require-await -- Preserve the original async act boundary after moving from the exempt test file.
  await act(async () => { hook.result.current.setActiveView(kind === 'finding' ? 'findings' : 'testware') })
  await waitFor(() => expect(current(hook.result.current, kind)?.title).toBe('Saved A'))
  return { ...hook, record, storage, save, table: kind === 'finding' ? 'findings' as const : 'drafts' as const }
}

export async function heldSave(kind: Kind) {
  const subject = await open(kind)
  const committed = deferred<void>(); const acknowledge = deferred<void>()
  subject.save.mockImplementationOnce(async (id: string, patch: WritePatch, guard: RecordWriteGuard) => {
    const row = await subject.storage.write(id, patch, guard)
    committed.resolve(); await acknowledge.promise
    return row
  })
  act(() => edit(subject.result.current, kind, 'Committed B', 'Body B'))
  let pending!: Promise<boolean>
  act(() => { pending = saveCurrent(subject.result.current, kind) })
  await act(async () => { await committed.promise })
  expect(subject.storage.read().title).toBe('Committed B')
  expect(subject.storage.read().body).toBe('<p>Body B</p>')
  act(() => { discard(subject.result.current, kind); edit(subject.result.current, kind, 'Retained C', 'Body C') })
  return { ...subject, acknowledge, pending }
}

export async function heldCompensation(kind: Kind, boundary: 'ack' | 'hash') {
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
