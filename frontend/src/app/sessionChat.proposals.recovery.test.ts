import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { ChatState } from '../bindings'
import { findingFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { editorValue, recordWriteGuard } from './recordWriteGuards'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { open, saveCurrent, currentRecord, storageOutcome, editTitle, discardCurrent } from './sessionChat.proposals.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it('edits made during the Undo status await remain saveable under the original stored base', async () => {
  const { result, record, proposal, after, base } = await open()
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  const undo = deferred<ChatState>(); api.resolveRefinement.mockReturnValueOnce(undo.promise)
  let undoing!: Promise<void>
  act(() => { undoing = result.current.sessionChat.proposalControls!.onAction('proposal-1', 'undo') })
  await waitFor(() => expect(api.resolveRefinement).toHaveBeenCalledTimes(2))
  act(() => result.current.updateLocalFinding(record.id, { title: 'Edit during Undo status' }))
  await act(async () => { undo.resolve(chatFixture({ draftId: 'chat-session-1', proposals: [{ ...proposal, state: { kind: 'undone', stage: { id: 'stage-1', before: proposal.before, after, storedBaseToken: base.expectedStoredBase } } }] })); await undoing })
  expect(result.current.findings[0].title).toBe('Edit during Undo status')
  api.updateFinding.mockResolvedValue(findingFixture({ title: 'Edit during Undo status' }))
  await act(async () => { await result.current.handleSaveFinding(result.current.findings[0]) })
  expect(api.updateFinding).toHaveBeenCalledWith(record.id, expect.objectContaining({ title: 'Edit during Undo status' }), { sessionId: record.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'editor' } })
})

it.each(['finding', 'test_cases_draft'] as const)('%s Conflict then Undo then Save retains B and the original editor base', async kind => {
  const { result, record, base } = await open(kind)
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  const remote = { ...record, title: 'Newer stored title', ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Newer stored body B')) }
  const storage = storageOutcome(remote, kind)
  const save = kind === 'finding' ? api.updateFinding : api.updateDraft
  save.mockImplementation(storage.write)
  await act(async () => { await saveCurrent(result.current, kind) })
  expect(storage.read().title).toBe('Newer stored title')
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'undo') })
  expect(currentRecord(result.current, kind).title).toBe(record.title)
  let saved = true
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(storage.read().title).toBe('Newer stored title')
  expect(storage.read().body).toBe('<p>Newer stored body B</p>')
  expect(storage.read()).toEqual(remote)
  expect(saved).toBe(false)
  expect(save.mock.calls.at(-1)?.[2]).toEqual({ sessionId: record.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'editor' } })
  expect(save).toHaveBeenCalledTimes(2)
})

it.each(['finding', 'test_cases_draft'] as const)('%s retains the old base after conflict, failed Undo status and abandonment', async kind => {
  const { result, record, base } = await open(kind)
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  const remote = { ...record, title: 'Newer stored title', ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Newer stored body B')) }
  const storage = storageOutcome(remote, kind)
  const save = kind === 'finding' ? api.updateFinding : api.updateDraft
  save.mockImplementation(storage.write)
  await act(async () => { await saveCurrent(result.current, kind) })
  let rejectUndo!: (cause: Error) => void
  const status = new Promise<ChatState>((_resolve, reject) => { rejectUndo = reject })
  api.resolveRefinement.mockReturnValueOnce(status)
  let undoing!: Promise<void>
  act(() => { undoing = result.current.sessionChat.proposalControls!.onAction('proposal-1', 'undo') })
  await waitFor(() => expect(api.resolveRefinement).toHaveBeenCalledTimes(2))
  act(() => editTitle(result.current, kind, 'Later local edit during failed Undo'))
  await act(async () => { rejectUndo(new Error('Synthetic Undo status write failed')); await undoing })
  expect(currentRecord(result.current, kind).title).toBe('Later local edit during failed Undo')
  let saved = true
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(storage.read()).toEqual(remote)
  expect(saved).toBe(false)
  expect(save.mock.calls.at(-1)?.[2]).toEqual({ sessionId: record.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'editor' } })
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'abandon') })
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(storage.read().title).toBe('Newer stored title')
  expect(storage.read().body).toBe('<p>Newer stored body B</p>')
  expect(currentRecord(result.current, kind).title).toBe('Later local edit during failed Undo')
  expect(saved).toBe(false)
  expect(save.mock.calls.at(-1)?.[2]).toEqual({ sessionId: record.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'editor' } })
  expect(save).toHaveBeenCalledTimes(3)
})

it.each(['finding', 'test_cases_draft'] as const)('%s explicit Discard releases the old base and permits an edit of B', async kind => {
  const { result, record } = await open(kind)
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  const remote = { ...record, title: 'Newer stored title', ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Newer stored body B')) }
  const storage = storageOutcome(remote, kind)
  const save = kind === 'finding' ? api.updateFinding : api.updateDraft
  save.mockImplementation(storage.write)
  await act(async () => { await saveCurrent(result.current, kind) })
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'undo') })
  act(() => discardCurrent(result.current, kind))
  expect(editorValue(currentRecord(result.current, kind))).toEqual(editorValue(remote))
  act(() => editTitle(result.current, kind, 'Edited after reviewing B'))
  let saved = false
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(storage.read().title).toBe('Edited after reviewing B')
  expect(storage.read().body).toBe('<p>Newer stored body B</p>')
  expect(saved).toBe(true)
  expect(save.mock.calls.at(-1)?.[2]).toEqual(await recordWriteGuard(remote, kind === 'finding' ? 'findings' : 'drafts'))
})
