import type { DraftPatch, FindingPatch, RecordWriteGuard } from '../bindings'
import { findingFixture, draftFixture } from '../test/fixtures'
import { richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RecordWriteConflict, recordWriteGuard } from './recordWriteGuards'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { open, openExact, currentRecord, saveCurrent, storageOutcome, editTitle } from './sessionChat.proposals.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it.each([['finding', false], ['finding', true], ['test_cases_draft', false], ['test_cases_draft', true]] as const)('%s nonconflict Undo remains saveable and confirmed writes advance the base; status failure %s', async (kind, statusFailure) => {
  const { result, record, base } = await open(kind)
  const storage = storageOutcome(record, kind)
  const save = kind === 'finding' ? api.updateFinding : api.updateDraft
  save.mockImplementation(storage.write)
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  if (statusFailure) api.resolveRefinement.mockRejectedValueOnce(new Error('Synthetic Undo status write failed'))
  await act(async () => { await result.current.sessionChat.proposalControls!.onAction('proposal-1', 'undo') })
  act(() => editTitle(result.current, kind, 'Saved after Undo'))
  let saved = false
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(saved).toBe(true)
  expect(storage.read().title).toBe('Saved after Undo')
  expect(save.mock.calls.at(-1)?.[2]).toEqual({ sessionId: record.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'editor' } })
  const nextBase = await recordWriteGuard(storage.read(), kind === 'finding' ? 'findings' : 'drafts')
  act(() => editTitle(result.current, kind, 'Saved after a confirmed write'))
  await act(async () => { saved = await saveCurrent(result.current, kind) })
  expect(saved).toBe(true)
  expect(storage.read().title).toBe('Saved after a confirmed write')
  expect(save.mock.calls.at(-1)?.[2]).toEqual(nextBase)
})


it.each(['finding', 'test_cases_draft'] as const)('%s one Update saves the literal preview and confirms after acknowledgement', async kind => {
  const subject = await openExact(kind)
  const { result, storage, command, after, base, record } = subject
  const write = command.getMockImplementation()!
  const dispatched = deferred<void>(), release = deferred<void>()
  command.mockImplementationOnce(async (...args: [string, FindingPatch | DraftPatch, RecordWriteGuard]) => { const saved = await write(...args); dispatched.resolve(); await release.promise; return saved })
  let saving!: ReturnType<NonNullable<typeof result.current.proposalControls.onUpdate>>
  let repeated!: typeof saving
  act(() => {
    saving = result.current.proposalControls.onUpdate!('proposal-1')
    repeated = result.current.proposalControls.onUpdate!('proposal-1')
  })
  expect(saving).toBe(repeated)
  await act(async () => { await dispatched.promise })
  expect(storage.read().title).toBe('Refined title')
  expect(storage.read().body).toBe('<p>Refined expected result</p>')
  expect(storage.read().bodyJson).toBe(after.documentJson)
  expect(result.current.notice).not.toBe(kind === 'finding' ? 'Finding updated' : 'Test case updated')
  await act(async () => { release.resolve(); expect(await saving).toMatchObject({ kind: 'saved', refresh: 'ok', record: { id: record.id, title: 'Refined title' } }) })
  expect(currentRecord(result.current, kind).body).toBe('<p>Refined expected result</p>')
  expect(result.current.notice).toBe(kind === 'finding' ? 'Finding updated' : 'Test case updated')
  expect(result.current.proposalControls.updated?.has('proposal-1')).toBe(true)
  act(() => { editTitle(result.current, kind, 'Temporary edit after confirmation'); editTitle(result.current, kind, 'Refined title') })
  expect(result.current.proposalControls.updated?.has('proposal-1')).toBe(false)
  expect(command).toHaveBeenCalledOnce()
  expect(command.mock.calls[0][2]).toEqual({ sessionId: record.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'proposal', stageId: 'stage-1' } })
  expect(result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(['finding', 'test_cases_draft'] as const)('%s edit then revert during Stage invalidates Update', async kind => {
  const { result, command, record, storage } = await openExact(kind)
  const resolve = api.resolveRefinement.getMockImplementation()!
  const reached = deferred<void>(), release = deferred<void>()
  api.resolveRefinement.mockImplementationOnce(async request => { reached.resolve(); await release.promise; return resolve(request) })
  let updating!: Promise<unknown>
  act(() => { updating = result.current.proposalControls.onUpdate!('proposal-1') })
  await act(async () => { await reached.promise })
  act(() => { editTitle(result.current, kind, 'Temporary manual edit'); editTitle(result.current, kind, record.title) })
  await act(async () => { release.resolve(); expect(await updating).toMatchObject({ kind: 'failed' }) })
  expect(currentRecord(result.current, kind).title).toBe(record.title)
  expect(storage.read()).toEqual(record)
  expect(command).not.toHaveBeenCalled()
  expect(result.current.proposalControls.errors['proposal-1']).toContain('newer edits are retained')
})

it.each(['finding', 'test_cases_draft'] as const)('%s newer edits after dispatch survive acknowledgement without update success', async kind => {
  const { result, command, storage } = await openExact(kind)
  const write = command.getMockImplementation()!
  const reached = deferred<void>(), release = deferred<void>()
  command.mockImplementationOnce(async (...args: [string, FindingPatch | DraftPatch, RecordWriteGuard]) => { const saved = await write(...args); reached.resolve(); await release.promise; return saved })
  let updating!: Promise<unknown>
  act(() => { updating = result.current.proposalControls.onUpdate!('proposal-1') })
  await act(async () => { await reached.promise })
  act(() => editTitle(result.current, kind, 'Newer manual title'))
  await act(async () => { release.resolve(); expect(await updating).toMatchObject({ kind: 'superseded' }) })
  expect(storage.read().title).toBe('Refined title')
  expect(currentRecord(result.current, kind).title).toBe('Newer manual title')
  expect(result.current.notice).not.toBe(kind === 'finding' ? 'Finding updated' : 'Test case updated')
})

it.each(['finding', 'test_cases_draft'] as const)('%s conflict retains proposed edits and Discard exposes the stored row', async kind => {
  const { result, command, record } = await openExact(kind)
  command.mockRejectedValueOnce(new RecordWriteConflict({ ...record, title: 'Newer stored title' }))
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'conflict', current: { title: 'Newer stored title' } }) })
  expect(currentRecord(result.current, kind).title).toBe('Refined title')
  expect(result.current.proposalControls.errors['proposal-1']).toContain('Stored record changed')
  act(() => { if (kind === 'finding') result.current.discardLocalFinding(result.current.findings[0]); else result.current.discardLocalDraft(result.current.testwareDrafts[0]) })
  expect(currentRecord(result.current, kind).title).toBe('Newer stored title')
})

it.each(['finding', 'test_cases_draft'] as const)('%s unknown acknowledgement reconciles exact saved origin without another write', async kind => {
  const { result, command, storage } = await openExact(kind)
  const write = command.getMockImplementation()!
  command.mockImplementationOnce(async (...args: [string, FindingPatch | DraftPatch, RecordWriteGuard]) => { await write(...args); throw new Error('Transport lost acknowledgement') })
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'unconfirmed' }) })
  expect(currentRecord(result.current, kind).title).toBe('Refined title')
  if (kind === 'finding') api.listFindings.mockResolvedValue([storage.read()])
  else api.listDrafts.mockResolvedValue([storage.read()])
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'saved', refresh: 'ok' }) })
  expect(command).toHaveBeenCalledOnce()
  expect(result.current.notice).toBe(kind === 'finding' ? 'Finding updated' : 'Test case updated')
  expect(result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(['finding', 'test_cases_draft'] as const)('%s a confirmed save reports failed refresh distinctly', async kind => {
  const { result, command, storage } = await openExact(kind)
  const write = command.getMockImplementation()!
  command.mockImplementationOnce(async (...args: [string, FindingPatch | DraftPatch, RecordWriteGuard]) => {
    const saved = await write(...args)
    api.getConversation.mockRejectedValue(new Error('Conversation refresh unavailable'))
    return saved
  })
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'saved', refresh: 'failed' }) })
  expect(storage.read().title).toBe('Refined title')
  expect(currentRecord(result.current, kind).title).toBe('Refined title')
  expect(result.current.notice).toContain('Save confirmed, but conversation refresh failed')
  expect(result.current.proposalControls.errors['proposal-1']).toContain('Do not submit Update again')
})


it.each(['finding', 'test_cases_draft'] as const)('%s Update preserves existing managed record images', async kind => {
  const body = richEditorDocumentToStoredBody({ schemaVersion: 1, doc: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Original evidence' }] },
    { type: 'image', attrs: { attachmentId: 'evidence-1', src: 'qa-scribe-attachment://evidence-1', alt: 'Original evidence' } },
  ] } })
  const original = kind === 'finding' ? findingFixture(body) : draftFixture(body)
  const { result, storage } = await openExact(kind, original)
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'saved' }) })
  expect(JSON.parse(storage.read().bodyJson!)).toEqual({ schemaVersion: 1, doc: { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Refined expected result' }] },
    { type: 'image', attrs: { attachmentId: 'evidence-1', src: 'qa-scribe-attachment://evidence-1', alt: 'Original evidence' } },
  ] } })
  expect(currentRecord(result.current, kind).bodyJson).toBe(storage.read().bodyJson)
})

it.each(['finding', 'test_cases_draft'] as const)('%s a failed dispatch is checked before an explicit safe retry', async kind => {
  const { result, command, storage, record } = await openExact(kind)
  command.mockRejectedValueOnce(new Error('Transport failed before acknowledgement'))
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'unconfirmed' }) })
  expect(currentRecord(result.current, kind).title).toBe('Refined title')
  expect(storage.read()).toEqual(record)
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'failed', message: 'No saved update was found. Your edits are retained. Select Update again to retry the exact proposal.' }) })
  expect(command).toHaveBeenCalledOnce()
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'saved' }) })
  expect(storage.read().title).toBe('Refined title')
  expect(command).toHaveBeenCalledTimes(2)
})

it.each(['finding', 'test_cases_draft'] as const)('%s recovered unbound Stage saves the reviewed snapshot', async kind => {
  const { result, proposal, base, setChat, command, storage } = await openExact(kind)
  setChat({ ...result.current.sessionChat.chat!, proposals: [{ ...proposal, state: { kind: 'staged', stage: { id: 'recovered-stage', before: proposal.before, after: proposal.after, storedBaseToken: base.expectedStoredBase } } }] })
  await act(async () => { await result.current.conversations.bind({ sessionId: proposal.target.kind === 'session' ? '' : proposal.target.snapshot.sessionId, draftId: 'chat-session-1' }).refresh() })
  expect(result.current.proposalControls.preparedOnly?.has(proposal.id)).toBe(true)
  await act(async () => { expect(await result.current.proposalControls.onUpdate!(proposal.id)).toMatchObject({ kind: 'saved' }) })
  expect(storage.read().title).toBe('Refined title')
  expect(command.mock.calls[0][2]).toMatchObject({ origin: { kind: 'proposal', stageId: 'recovered-stage' } })
})

it.each(['finding', 'test_cases_draft'] as const)('%s navigation after dispatch suppresses success and leaves the new selection alone', async kind => {
  const { result, command, storage } = await openExact(kind)
  const write = command.getMockImplementation()!
  const reached = deferred<void>(), release = deferred<void>()
  command.mockImplementationOnce(async (...args: [string, FindingPatch | DraftPatch, RecordWriteGuard]) => { const saved = await write(...args); reached.resolve(); await release.promise; return saved })
  let updating!: Promise<unknown>
  act(() => { updating = result.current.proposalControls.onUpdate!('proposal-1') })
  await act(async () => { await reached.promise })
  act(() => result.current.askAi.onSelectRecord({ kind, recordId: 'another-record', title: 'Another record', unsaved: false }))
  await act(async () => { release.resolve(); expect(await updating).toMatchObject({ kind: 'superseded' }) })
  expect(storage.read().title).toBe('Refined title')
  expect(result.current.askAi.context).toMatchObject({ recordId: 'another-record' })
  expect(result.current.notice).not.toBe(kind === 'finding' ? 'Finding updated' : 'Test case updated')
})

it('explains an unresolved prepared change when cleanup fails without replacing the record', async () => {
  const { result, command, record, storage } = await openExact('finding')
  const resolve = api.resolveRefinement.getMockImplementation()!
  const reached = deferred<void>(), release = deferred<void>()
  api.resolveRefinement.mockImplementationOnce(async request => { reached.resolve(); await release.promise; return resolve(request) })
    .mockRejectedValueOnce(new Error('Prepared change cleanup failed'))
  let updating!: Promise<unknown>
  act(() => { updating = result.current.proposalControls.onUpdate!('proposal-1') })
  await act(async () => { await reached.promise })
  act(() => editTitle(result.current, 'finding', 'Newer manual title'))
  await act(async () => { release.resolve(); expect(await updating).toMatchObject({ kind: 'failed' }) })
  expect(storage.read()).toEqual(record)
  expect(currentRecord(result.current, 'finding').title).toBe('Newer manual title')
  expect(command).not.toHaveBeenCalled()
  expect(result.current.proposalControls.errors['proposal-1']).toContain('The prepared change remains unresolved')
  expect(result.current.proposalControls.pending.size).toBe(0)
})

it.each(['finding', 'test_cases_draft'] as const)('%s a superseded retry retains the already installed proposal for later Save', async kind => {
  const { result, command, storage, record } = await openExact(kind)
  command.mockRejectedValueOnce(new Error('Write rejected before commit'))
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'unconfirmed' }) })
  if (kind === 'finding') api.listFindings.mockResolvedValue([storage.read()])
  else api.listDrafts.mockResolvedValue([storage.read()])
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'failed' }) })
  const resolve = api.resolveRefinement.getMockImplementation()!
  const reached = deferred<void>(), release = deferred<void>()
  api.resolveRefinement.mockImplementationOnce(async request => { reached.resolve(); await release.promise; return resolve(request) })
  let retry!: Promise<unknown>
  act(() => { retry = result.current.proposalControls.onUpdate!('proposal-1') })
  await act(async () => { await reached.promise })
  act(() => editTitle(result.current, kind, 'Newer manual title during retry'))
  await act(async () => { release.resolve(); expect(await retry).toMatchObject({ kind: 'failed' }) })
  const scope = api.resolveRefinement.mock.calls[0][0].scope
  const chat = await api.getConversation({ sessionId: record.sessionId, draftId: scope.draftId })
  expect(chat.proposals?.[0].state.kind).toBe('staged')
  expect(currentRecord(result.current, kind).title).toBe('Newer manual title during retry')
  expect(storage.read()).toEqual(record)
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  expect(storage.read().title).toBe('Newer manual title during retry')
})
