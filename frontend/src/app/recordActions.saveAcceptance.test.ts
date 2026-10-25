import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RecordWriteGuard } from '../bindings'
import { richEditorDocumentFromHtml, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { cleanupControllerTest, setupControllerTest } from './useAppController.testHarness'
import { openSaveGuardSubject, recordKinds, saveAcceptedRecord } from './recordSaveGuards.testSupport'
import type { RecordPatch } from './recordSaveGuards.storage.testSupport'

beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

const failures = [
  { phase: 'transport', acceptance: 'ordinary' },
  { phase: 'backend-validation', acceptance: 'ordinary' },
  { phase: 'materialization', acceptance: 'ordinary' },
  { phase: 'transport', acceptance: 'canonicalization' },
] as const

it.each(recordKinds.flatMap(kind => failures.map(failure => ({ kind, ...failure }))))(
  '$kind retains its $phase error without pending compensation after $acceptance accepts S2', async ({ kind, phase, acceptance }) => {
    const subject = await openSaveGuardSubject(kind)
    await saveAcceptedRecord(subject, 'S1')
    if (acceptance === 'ordinary') await saveAcceptedRecord(subject, 'S2')
    else await act(async () => { await subject.canonicalize('S2') })
    expect(subject.storage.read().title).toBe('S2')
    expect(subject.current().title).toBe('S2')
    subject.edit(phase === 'backend-validation' ? '   ' : 'S3')
    let message = 'Something went wrong: Synthetic editor transport failed before commit'
    if (phase === 'transport') {
      subject.update.mockImplementation(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
        if (guard.origin.kind === 'editor') throw new Error('Synthetic editor transport failed before commit')
        return subject.storage.write(id, patch, guard)
      })
    } else if (phase === 'backend-validation') {
      message = `Something went wrong: ${kind === 'draft' ? 'Draft' : 'Finding'} title is required`
    } else {
      message = 'Something went wrong: Synthetic inline image materialization failed before record IPC'
      subject.api.importClipboardScreenshot.mockRejectedValue(new Error('Synthetic inline image materialization failed before record IPC'))
      act(() => {
        const patch = richEditorDocumentToStoredBody(richEditorDocumentFromHtml('<p>Body S3</p><img src="data:image/png;base64,aGVsbG8=">'))
        if (kind === 'draft') subject.result.current.updateLocalDraft(subject.initial.id, patch)
        else subject.result.current.updateLocalFinding(subject.initial.id, patch)
      })
    }
    const retained = subject.current()
    const stored = subject.storage.read()
    await act(async () => { expect(await subject.save()).toBe(false) })
    expect(subject.current()).toEqual(retained)
    expect(subject.storage.read()).toEqual(stored)
    expect(subject.result.current.hasPendingSessionEdits()).toBe(true)
    expect.soft(subject.result.current.error).toBe(message)
    expect.soft(subject.result.current.hasPendingRecordCompensations()).toBe(false)
    expect.soft(subject.result.current.sessionChat.recordWritesPending).toBe(false)
    await act(async () => { expect(await subject.flush()).toBe(false) })
    expect(subject.current()).toEqual(retained)
    expect(subject.storage.read().title).toBe('S2')
    expect(subject.storage.read().body).toBe('<p>Body S2</p>')
    expect.soft(subject.result.current.error).toBe(message)
    expect.soft(subject.result.current.hasPendingRecordCompensations()).toBe(false)
  },
)

it.each(recordKinds)('%s preserves a transport error after one successful Save without pending compensation', async kind => {
  const subject = await openSaveGuardSubject(kind)
  await saveAcceptedRecord(subject, 'S1')
  subject.edit('Retained S2')
  subject.update.mockImplementation(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    if (guard.origin.kind === 'editor') throw new Error('Synthetic editor failure')
    return subject.storage.write(id, patch, guard)
  })
  await act(async () => { expect(await subject.save()).toBe(false) })
  await act(async () => { expect(await subject.flush()).toBe(false) })
  expect(subject.current().title).toBe('Retained S2')
  expect(subject.current().body).toBe('<p>Body Retained S2</p>')
  expect(subject.storage.read().title).toBe('S1')
  expect(subject.result.current.error).toBe('Something went wrong: Synthetic editor failure')
  expect(subject.result.current.hasPendingSessionEdits()).toBe(true)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(recordKinds)('%s protects the committed record when its Save acknowledgement is lost', async kind => {
  const subject = await openSaveGuardSubject(kind)
  await saveAcceptedRecord(subject, 'S1')
  await saveAcceptedRecord(subject, 'S2')
  subject.edit('Committed S3')
  subject.update.mockImplementationOnce(async (id: string, patch: RecordPatch, guard: RecordWriteGuard) => {
    await subject.storage.write(id, patch, guard)
    throw new Error('Synthetic acknowledgement lost after commit')
  })
  await act(async () => { expect(await subject.save()).toBe(false) })
  expect(subject.storage.read().title).toBe('Committed S3')
  expect(subject.storage.read().body).toBe('<p>Body Committed S3</p>')
  expect(subject.current().title).toBe('Committed S3')
  expect(subject.result.current.error).toBe('Stored record changed. Your local changes are retained. Use Discard to review the latest saved record before requesting another refinement.')
  expect(subject.result.current.hasPendingSessionEdits()).toBe(true)
  expect(subject.result.current.hasPendingRecordCompensations()).toBe(false)
})
