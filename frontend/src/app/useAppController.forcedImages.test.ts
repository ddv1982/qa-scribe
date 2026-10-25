import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { richEditorDocumentFromHtml, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { cleanupControllerTest, deferred, setupControllerTest } from './useAppController.testHarness'
import { observeForcedSaveStart, openSaveGuardSubject, recordKinds, type SaveGuardSubject } from './recordSaveGuards.testSupport'
import { holdForcedOwner } from './recordSaveGuards.owner.testSupport'
import type { RecordPatch } from './recordSaveGuards.storage.testSupport'

beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

function imageEdit(subject: SaveGuardSubject, title: string) {
  const patch = { title, ...richEditorDocumentToStoredBody(richEditorDocumentFromHtml('<p>Current image</p><img src="data:image/png;base64,aGVsbG8=" alt="Evidence">')) }
  act(() => {
    if (subject.kind === 'draft') subject.result.current.updateLocalDraft(subject.initial.id, patch)
    else subject.result.current.updateLocalFinding(subject.initial.id, patch)
  })
}

it.each(recordKinds)('%s joined Save imports only the latest editor image under the owner', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const owner = await holdForcedOwner(subject)
  imageEdit(subject, 'Supplied S2')
  let joined!: Promise<boolean>
  act(() => { joined = subject.save() })
  imageEdit(subject, 'Latest S3')
  try {
    await observeForcedSaveStart()
    expect(subject.api.importClipboardScreenshot).not.toHaveBeenCalled()
    expect(subject.update).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => { owner.release(); expect(await Promise.all([owner.pending, joined])).toEqual([true, true]) })
  }
  expect(subject.api.importClipboardScreenshot).toHaveBeenCalledOnce()
  expect(subject.api.deleteAttachment).not.toHaveBeenCalled()
  expect(subject.storage.read().title).toBe('Latest S3')
  expect(subject.storage.read().body).toContain('qa-scribe-attachment://attachment-1')
  expect(subject.current().bodyJson).toContain('attachment-1')
  expect(subject.storage.requests.some(request => request.patch.title === 'Supplied S2')).toBe(false)
  expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
})

it.each(recordKinds)('%s failed image cleanup releases the owner and a later flush retains current edits', async kind => {
  const subject = await openSaveGuardSubject(kind)
  imageEdit(subject, 'Image S1')
  const reached = deferred<void>()
  const release = deferred<void>()
  subject.update.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    const record = await subject.storage.write(id, patch, guard)
    reached.resolve(); await release.promise
    return record
  })
  subject.api.deleteAttachment.mockResolvedValue(false)
  let owner!: Promise<boolean>; let joined!: Promise<boolean>
  act(() => { owner = subject.result.current.saveDirtyRecordsNow() })
  await act(async () => { await reached.promise })
  subject.edit('Current S2')
  act(() => { joined = subject.save() })
  await act(async () => { release.resolve(); expect(await Promise.all([owner, joined])).toEqual([false, false]) })
  expect(subject.api.deleteAttachment).toHaveBeenCalledWith('attachment-1')
  expect(subject.current().title).toBe('Current S2')
  expect(subject.storage.read().title).toBe('Image S1')
  expect(subject.storage.read().body).toContain('attachment-1')
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
  subject.api.deleteAttachment.mockResolvedValue(true)
  await act(async () => { expect(await subject.flush()).toBe(true) })
  expect(subject.storage.read().title).toBe('Current S2')
  expect(subject.storage.read().body).toBe('<p>Body Current S2</p>')
  expect(subject.result.current.hasPendingSessionEdits()).toBe(false)
})

it.each(recordKinds)('%s Session deletion during image import cleans the late attachment and cannot falsely save', async kind => {
  const subject = await openSaveGuardSubject(kind)
  const imported = deferred<{ id: string; filename: string }>()
  subject.api.importClipboardScreenshot.mockReturnValueOnce(imported.promise)
  imageEdit(subject, 'Pending image')
  let owner!: Promise<boolean>; let joined!: Promise<boolean>
  act(() => { owner = subject.result.current.saveDirtyRecordsNow() })
  await waitFor(() => expect(subject.api.importClipboardScreenshot).toHaveBeenCalledOnce())
  act(() => { joined = subject.save() })
  subject.api.deleteSession.mockImplementation((sessionId: string) => {
    subject.storage.removeSession(sessionId)
    return Promise.resolve({ pendingFiles: 0 })
  })
  subject.api.listSessions.mockResolvedValue([])
  try {
    await act(async () => { await subject.result.current.handleDeleteSession(subject.result.current.activeSession!) })
  } finally {
    await act(async () => { imported.resolve({ id: 'late-image', filename: 'late.png' }); expect(await Promise.all([owner, joined])).toEqual([false, false]) })
  }
  expect(subject.api.deleteAttachment).toHaveBeenCalledWith('late-image')
  expect(subject.storage.has(subject.initial.id)).toBe(false)
  expect(subject.result.current.activeSession).toBeNull()
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
  expect(subject.result.current.hasPendingAttachmentMutations()).toBe(false)
})
