import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, vi } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { draftFixture, entryFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { recordStorage, type RecordKind, type RecordPatch, type RecordValue } from './recordSaveGuards.storage.testSupport'
import { deferred, getTauriMock, getTauriWindowMock, sessionNoteStateFixture, useAppController } from './useAppController.testHarness'

export const recordKinds = ['draft', 'finding'] as const
export const richBody = (text: string) => richEditorDocumentToStoredBody(richEditorDocumentFromPlainText(text))

export async function openSaveGuardSubject(kind: RecordKind, withSecondRecord = false) {
  const api = getTauriMock()
  const initial = kind === 'draft' ? draftFixture({ title: 'S0', ...richBody('Body S0') }) : findingFixture({ title: 'S0', ...richBody('Body S0') })
  const secondId = kind === 'draft' ? 'draft-2' : 'finding-2'
  const second = kind === 'draft' ? draftFixture({ id: secondId, title: 'Y0', ...richBody('Body Y0') })
    : findingFixture({ id: secondId, title: 'Y0', ...richBody('Body Y0') })
  const storage = recordStorage(initial, kind, withSecondRecord ? [second] : [])
  const storedRows = () => (withSecondRecord ? [initial.id, second.id] : [initial.id]).filter(id => storage.has(id)).map(id => storage.read(id))
  const update = kind === 'draft' ? api.updateDraft : api.updateFinding
  update.mockImplementation(storage.write)
  api.listDrafts.mockImplementation((sessionId: string) => Promise.resolve(kind === 'draft' && sessionId === initial.sessionId ? storedRows() : []))
  api.listFindings.mockImplementation((sessionId: string) => Promise.resolve(kind === 'finding' && sessionId === initial.sessionId ? storedRows() : []))
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.activeSession?.id).toBe(initial.sessionId))
  act(() => hook.result.current.setActiveView(kind === 'draft' ? 'testware' : 'findings'))
  function current(id = initial.id) {
    const record = (kind === 'draft' ? hook.result.current.testwareDrafts : hook.result.current.findings).find(row => row.id === id)
    if (!record) throw new Error(`Missing open fixture record ${id}`)
    return record
  }
  await waitFor(() => expect(current()).toEqual(initial))
  function editRecord(id: string, title: string, body = `Body ${title}`) {
    act(() => {
      const patch = { title, ...richBody(body) }
      if (kind === 'draft') hook.result.current.updateLocalDraft(id, patch)
      else hook.result.current.updateLocalFinding(id, patch)
    })
  }
  function save(id = initial.id) {
    if (kind === 'draft') {
      const record = hook.result.current.testwareDrafts.find(row => row.id === id)
      if (!record) throw new Error(`Missing open Draft ${id}`)
      return hook.result.current.handleSaveDraft(record)
    }
    const record = hook.result.current.findings.find(row => row.id === id)
    if (!record) throw new Error(`Missing open Finding ${id}`)
    return hook.result.current.handleSaveFinding(record)
  }
  async function canonicalize(title: string) {
    if (kind === 'draft') {
      const base = hook.result.current.testwareDrafts[0]
      await hook.result.current.canonicalizeGeneratedDraft({ ...base, title, ...richBody(`Body ${title}`) }, base)
    } else {
      const base = hook.result.current.findings[0]
      await hook.result.current.canonicalizeGeneratedFinding({ ...base, title, ...richBody(`Body ${title}`) }, base)
    }
  }
  api.openSessionNoteState.mockImplementation((sessionId: string) => Promise.resolve(sessionNoteStateFixture({
    session: sessionFixture({ id: sessionId, title: `Session ${sessionId}` }),
    noteEntry: entryFixture({ sessionId, id: `entry-${sessionId}` }),
  })))
  return { ...hook, kind, api, initial, secondId, update, storage, current, editRecord,
    edit: (title: string, body = `Body ${title}`) => editRecord(initial.id, title, body), save, canonicalize,
    flush: () => hook.result.current.saveAllPendingChanges() }
}

export type SaveGuardSubject = Awaited<ReturnType<typeof openSaveGuardSubject>>

export async function saveAcceptedRecord(subject: SaveGuardSubject, title: string) {
  subject.edit(title)
  await act(async () => { expect(await subject.save()).toBe(true) })
  expect(subject.storage.read().title).toBe(title)
  expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
}

export async function holdExplicitSave(subject: SaveGuardSubject, boundary: 'before-commit' | 'after-commit') {
  const reached = deferred<void>()
  const release = deferred<void>()
  const acknowledged = deferred<void>()
  subject.update.mockImplementation(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    await acknowledged.promise
    return subject.storage.write(id, patch, guard)
  })
  subject.update.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    let committed: RecordValue | undefined
    if (boundary === 'after-commit') committed = await subject.storage.write(id, patch, guard)
    reached.resolve()
    await release.promise
    return committed ?? subject.storage.write(id, patch, guard)
  })
  subject.edit('S1')
  let pending!: Promise<boolean>
  act(() => { pending = subject.save().finally(() => acknowledged.resolve()) })
  await act(async () => { await reached.promise })
  return { pending, release: () => release.resolve() }
}

export async function observeForcedSaveStart() {
  await act(async () => { await new Promise<void>(resolve => { setTimeout(resolve, 0) }) })
}

export function startForcedSave(subject: SaveGuardSubject, entryPoint: 'flush' | 'navigation' | 'close') {
  const windowMock = getTauriWindowMock()
  const closeEvent = { preventDefault: vi.fn() }
  let pending!: Promise<boolean | void>
  act(() => {
    pending = entryPoint === 'flush' ? subject.flush() : entryPoint === 'navigation'
      ? subject.result.current.openSession(sessionFixture({ id: 'session-2', title: 'Other Session' }))
      : Promise.resolve(windowMock.closeRequestedHandler()?.(closeEvent))
  })
  return { pending, windowMock, closeEvent }
}
