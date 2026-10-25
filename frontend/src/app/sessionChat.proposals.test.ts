import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { ChatState } from '../bindings'
import { findingFixture } from '../test/fixtures'
import { editorValue, RecordWriteConflict } from './recordWriteGuards'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest } from './useAppController.testHarness'
import { open } from './sessionChat.proposals.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each(['finding', 'test_cases_draft'] as const)('applies %s locally once and sends the canonical body trio and pinned base only on Save', async kind => {
  const { result, record, after, base } = await open(kind)
  await act(async () => { await result.current.sessionChat.proposalControls?.onAction('proposal-1', 'stage') })
  let edited = kind === 'finding' ? result.current.findings[0] : result.current.testwareDrafts[0]
  expect(result.current.askAi.context).toMatchObject({ unsaved: true })
  expect(edited.title).toBe('Refined title')
  expect(edited.body).toBe('<p>Refined expected result</p>')
  expect(edited.bodyJson).toBe(after.documentJson)
  expect(api.updateFinding).not.toHaveBeenCalled(); expect(api.updateDraft).not.toHaveBeenCalled()
  await act(async () => { await result.current.sessionChat.proposalControls?.onAction('proposal-1', 'stage') })
  edited = kind === 'finding' ? result.current.findings[0] : result.current.testwareDrafts[0]
  expect(edited.body).toBe('<p>Refined expected result</p>')
  const save = kind === 'finding' ? api.updateFinding : api.updateDraft
  save.mockResolvedValue({ ...record, title: after.title, body: edited.body, bodyJson: edited.bodyJson, bodyFormat: edited.bodyFormat })
  await act(async () => { if (kind === 'finding') await result.current.handleSaveFinding(result.current.findings[0]); else await result.current.handleSaveDraft(result.current.testwareDrafts[0]) })
  expect(save).toHaveBeenCalledWith(record.id, expect.objectContaining({ body: '<p>Refined expected result</p>', bodyJson: after.documentJson, bodyFormat: 'tiptap_json' }), { sessionId: record.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'proposal', stageId: 'stage-1' } })
})

it('rechecks the editor after stage persistence and retains the newer title with a nearby rejection reason', async () => {
  const { result, record, proposal, after, base } = await open()
  const staging = deferred<ChatState>()
  api.resolveRefinement.mockReturnValueOnce(staging.promise)
  let applying!: Promise<void>
  act(() => { applying = result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  await waitFor(() => expect(api.resolveRefinement).toHaveBeenCalled())
  act(() => result.current.updateLocalFinding(record.id, { title: 'Newer local title' }))
  await act(async () => { staging.resolve(chatFixture({ draftId: 'chat-session-1', proposals: [{ ...proposal, state: { kind: 'staged', stage: { id: 'stage-1', before: proposal.before, after, storedBaseToken: base.expectedStoredBase } } }] })); await applying })
  expect(result.current.findings[0].title).toBe('Newer local title')
  expect(result.current.sessionChat.proposalControls?.errors['proposal-1']).toContain('editor changed while preparing')
  expect(api.updateFinding).not.toHaveBeenCalled()
})

it('rejects navigation during the await and never writes the newly selected record', async () => {
  const { result, proposal, after, base } = await open()
  const staging = deferred<ChatState>(); api.resolveRefinement.mockReturnValueOnce(staging.promise)
  let applying!: Promise<void>
  act(() => { applying = result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  await waitFor(() => expect(api.resolveRefinement).toHaveBeenCalled())
  act(() => result.current.askAi.detach())
  await act(async () => { staging.resolve(chatFixture({ draftId: 'chat-session-1', proposals: [{ ...proposal, state: { kind: 'staged', stage: { id: 'stage-1', before: proposal.before, after, storedBaseToken: base.expectedStoredBase } } }] })); await applying })
  expect(result.current.findings[0].title).toBe(proposal.before.title)
  expect(result.current.sessionChat.proposalControls?.errors['proposal-1']).toContain('Select the original record')
})

it('Undo restores the literal before value and Dismiss never mutates a record', async () => {
  const { result, proposal } = await open()
  await act(async () => { await result.current.sessionChat.proposalControls?.onAction('proposal-1', 'stage') })
  await act(async () => { await result.current.sessionChat.proposalControls?.onAction('proposal-1', 'undo') })
  expect(editorValue(result.current.findings[0])).toEqual(proposal.before)
  expect(api.updateFinding).not.toHaveBeenCalled()
})

it('failed Save keeps the proposal-derived editor and conflict Discard exposes the newer stored row', async () => {
  const { result } = await open()
  await act(async () => { await result.current.sessionChat.proposalControls?.onAction('proposal-1', 'stage') })
  api.updateFinding.mockRejectedValueOnce(new Error('Synthetic disk full'))
  await act(async () => { await result.current.handleSaveFinding(result.current.findings[0]) })
  expect(result.current.findings[0].title).toBe('Refined title')
  api.updateFinding.mockRejectedValueOnce(new RecordWriteConflict({ ...findingFixture(), title: 'Newer stored title' }))
  await act(async () => { await result.current.handleSaveFinding(result.current.findings[0]) })
  expect(result.current.findings[0].title).toBe('Refined title')
  expect(result.current.sessionChat.proposalControls?.errors['proposal-1']).toContain('Use the record editor Discard')
  act(() => result.current.discardLocalFinding(result.current.findings[0]))
  expect(result.current.findings[0].title).toBe('Newer stored title')
})

it('abandons an uninstalled prepared stage after stale rejection and saves newer edits normally', async () => {
  const { result, record, proposal, after, base } = await open()
  const staging = deferred<ChatState>(); api.resolveRefinement.mockReturnValueOnce(staging.promise)
  let applying!: Promise<void>
  act(() => { applying = result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  await waitFor(() => expect(api.resolveRefinement).toHaveBeenCalled())
  act(() => result.current.updateLocalFinding(record.id, { title: 'Newer retained edit' }))
  await act(async () => { staging.resolve(chatFixture({ draftId: 'chat-session-1', proposals: [{ ...proposal, state: { kind: 'staged', stage: { id: 'stage-1', before: proposal.before, after, storedBaseToken: base.expectedStoredBase } } }] })); await applying })
  expect(result.current.findings[0].title).toBe('Newer retained edit')
  expect(result.current.sessionChat.chat?.proposals?.[0].state.kind).toBe('abandoned')
  api.updateFinding.mockResolvedValue(findingFixture({ title: 'Newer retained edit' }))
  await act(async () => { await result.current.handleSaveFinding(result.current.findings[0]) })
  expect(api.updateFinding).toHaveBeenCalledWith(record.id, expect.objectContaining({ title: 'Newer retained edit' }), { sessionId: record.sessionId, expectedStoredBase: base.expectedStoredBase, origin: { kind: 'editor' } })
  expect(result.current.sessionChat.captureRestart?.()).not.toBeNull()
})

it('a newer Discard intent wins even when it restores the identical before-content', async () => {
  const { result, proposal, after, base } = await open()
  const staging = deferred<ChatState>(); api.resolveRefinement.mockReturnValueOnce(staging.promise)
  let applying!: Promise<void>
  act(() => { applying = result.current.sessionChat.proposalControls!.onAction('proposal-1', 'stage') })
  await waitFor(() => expect(api.resolveRefinement).toHaveBeenCalled())
  act(() => result.current.discardLocalFinding(result.current.findings[0]))
  await act(async () => { staging.resolve(chatFixture({ draftId: 'chat-session-1', proposals: [{ ...proposal, state: { kind: 'staged', stage: { id: 'stage-1', before: proposal.before, after, storedBaseToken: base.expectedStoredBase } } }] })); await applying })
  expect(editorValue(result.current.findings[0])).toEqual(proposal.before)
  expect(result.current.sessionChat.chat?.proposals?.[0].state.kind).toBe('abandoned')
  expect(api.updateFinding).not.toHaveBeenCalled()
})
