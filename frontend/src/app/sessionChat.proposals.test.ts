import '@testing-library/jest-dom/vitest'
import { createElement } from 'react'
import { AppChat } from './AppChat'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { BeginRecordChatRequest, ChatRef, ChatState } from '../bindings'
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
  act(() => result.current.askAi.onSelectRecord(null))
  await act(async () => { staging.resolve(chatFixture({ draftId: 'chat-session-1', proposals: [{ ...proposal, state: { kind: 'staged', stage: { id: 'stage-1', before: proposal.before, after, storedBaseToken: base.expectedStoredBase } } }] })); await applying })
  expect(result.current.findings[0].title).toBe(proposal.before.title)
  expect(result.current.sessionChat.proposalControls?.errors['proposal-1']).toContain('selection changed while preparing')
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

it('rejects a Stage result after record selection A to B to A', async () => {
  const { result, record, proposal, after, base } = await open()
  const staging = deferred<ChatState>(); api.resolveRefinement.mockReturnValueOnce(staging.promise)
  let applying!: Promise<void>
  act(() => { applying = result.current.sessionChat.proposalControls!.onAction(proposal.id, 'stage') })
  await waitFor(() => expect(api.resolveRefinement).toHaveBeenCalledOnce())
  act(() => {
    result.current.askAi.onSelectRecord({ kind: 'finding', recordId: 'B', title: 'Other record', unsaved: false })
    result.current.askAi.onSelectRecord({ kind: 'finding', recordId: record.id, title: record.title, unsaved: false })
  })
  await act(async () => { staging.resolve(chatFixture({ draftId: 'chat-session-1', proposals: [{ ...proposal, state: { kind: 'staged', stage: { id: 'stage-1', before: proposal.before, after, storedBaseToken: base.expectedStoredBase } } }] })); await applying })
  expect(result.current.findings[0].title).toBe(record.title)
  expect(result.current.findings[0].body).toBe(record.body)
  expect(result.current.sessionChat.proposalControls!.errors[proposal.id]).toContain('selection changed')
  expect(result.current.sessionChat.chat?.proposals?.[0].state.kind).toBe('abandoned')
})

it('a repeated same-record selection notification does not invalidate Apply', async () => {
  const { result, record, proposal, after, base } = await open()
  const staging = deferred<ChatState>(); api.resolveRefinement.mockReturnValueOnce(staging.promise)
  let applying!: Promise<void>
  act(() => { applying = result.current.sessionChat.proposalControls!.onAction(proposal.id, 'stage') })
  await waitFor(() => expect(api.resolveRefinement).toHaveBeenCalledOnce())
  act(() => result.current.askAi.onSelectRecord({ kind: 'finding', recordId: record.id, title: record.title, unsaved: false }))
  await act(async () => { staging.resolve(chatFixture({ draftId: 'chat-session-1', proposals: [{ ...proposal, state: { kind: 'staged', stage: { id: 'stage-1', before: proposal.before, after, storedBaseToken: base.expectedStoredBase } } }] })); await applying })
  expect(result.current.findings[0].title).toBe(after.title)
  expect(result.current.findings[0].bodyJson).toBe(after.documentJson)
  expect(result.current.sessionChat.proposalControls!.errors[proposal.id]).toBeUndefined()
})

it('conversation selection A to B to A invalidates an awaited Apply on the same record', async () => {
  const { result, record, proposal, after, base } = await open()
  const original = { sessionId: record.sessionId, draftId: 'chat-session-1' }
  const other = chatFixture({ sessionId: record.sessionId, draftId: 'conversation-B', owner: { kind: 'record', sessionId: record.sessionId, record: { kind: 'finding', recordId: record.id } } })
  const exactRead = api.getConversation.getMockImplementation()!
  api.getConversation.mockImplementation(reference => reference.draftId === other.draftId ? Promise.resolve(other) : exactRead(reference))
  const staging = deferred<ChatState>(); api.resolveRefinement.mockReturnValueOnce(staging.promise)
  let applying!: Promise<void>
  act(() => { applying = result.current.sessionChat.proposalControls!.onAction(proposal.id, 'stage') })
  await waitFor(() => expect(api.resolveRefinement).toHaveBeenCalledOnce())
  await act(async () => { await result.current.conversations.select({ sessionId: record.sessionId, draftId: other.draftId }); await result.current.conversations.select(original) })
  await act(async () => { staging.resolve(chatFixture({ draftId: original.draftId, proposals: [{ ...proposal, state: { kind: 'staged', stage: { id: 'stage-1', before: proposal.before, after, storedBaseToken: base.expectedStoredBase } } }] })); await applying })
  expect(result.current.findings[0].title).toBe(record.title)
  expect(result.current.findings[0].body).toBe(record.body)
  expect(result.current.sessionChat.proposalControls!.errors[proposal.id]).toContain('selection changed')
})


it.each(['held', 'rejected'] as const)('visible Notes dismisses its rendered proposal while Notes selection is %s behind a record chat', async selection => {
  const { result, record, proposal, setConversation, readConversation, setChat } = await open()
  setChat({ ...result.current.sessionChat.chat!, mode: 'chat', messages: [{ id: proposal.assistantMessageId, turnId: 'notes-turn', role: 'assistant', text: 'A legacy Notes suggestion.', images: [], status: 'completed', errorMessage: null, aiRunId: null, createdAt: 'saved' }] })
  await act(async () => { await result.current.sessionChat.onRefresh!() })
  const reference = { sessionId: record.sessionId, draftId: 'record-selected-behind-notes' }
  const row = chatFixture({ ...reference, owner: { kind: 'record', sessionId: record.sessionId, record: { kind: 'finding', recordId: record.id } }, mode: 'chat' })
  setConversation(row)
  await act(async () => { await result.current.conversations.select(reference) })
  const held = deferred<void>()
  const activate = api.activateConversation.getMockImplementation()!
  api.activateConversation.mockImplementation(async (ref: ChatRef) => {
    if (ref.draftId === 'chat-session-1') {
      if (selection === 'held') await held.promise
      throw new Error('Synthetic Notes activation rejected')
    }
    return activate(ref)
  })
  await act(async () => { result.current.setActiveView('sessions'); result.current.setSessionMode('chat') })
  const view = () => createElement(AppChat, { c: result.current, modelSelectionControl: null, onConfigureAi: () => {} })
  const rendered = render(view())
  const panel = within(screen.getByRole('complementary', { name: 'Notes AI chat' }))
  expect(panel.getByRole('region', { name: `Local refinement for ${record.title}` })).toHaveTextContent('Not applied.')
  fireEvent.click(panel.getByRole('button', { name: 'Review refinement' }))
  fireEvent.click(panel.getByRole('button', { name: 'Dismiss proposal' }))
  await waitFor(() => expect(readConversation('chat-session-1').proposals?.[0].state.kind).toBe('dismissed'))
  rendered.rerender(view())
  expect(panel.getByRole('region', { name: `Local refinement for ${record.title}` })).toHaveTextContent('Dismissed.')
  expect(readConversation(reference.draftId)).toEqual(row)
  expect(result.current.sessionChat.chat?.proposals?.[0].id).toBe(proposal.id)
  expect(result.current.sessionChat.proposalControls?.errors[proposal.id]).toBeUndefined()
  expect(result.current.findings[0].title).toBe(record.title)
  expect(api.updateFinding).not.toHaveBeenCalled()
  await act(async () => { held.resolve() })
})


it.each(['finding', 'test_cases_draft'] as const)('rendered %s Apply keeps its exact reference when the engine selection differs', async kind => {
  const { result, record, proposal, setConversation, readConversation } = await open(kind)
  const message = { id: proposal.assistantMessageId, turnId: 'record-turn', role: 'assistant' as const, text: 'A record suggestion.', images: [], status: 'completed' as const, errorMessage: null, aiRunId: null, createdAt: 'saved' }
  api.beginRecordChat.mockImplementation(async (request: BeginRecordChatRequest) => {
    const row = chatFixture({ ...request, owner: { kind: 'record', sessionId: request.sessionId, record: request.record }, mode: 'chat', proposals: [proposal], messages: [message] })
    setConversation(row)
    return row
  })
  await act(async () => { await result.current.askAi.onAskAi({ kind, recordId: record.id, title: record.title, unsaved: false }) })
  const reference = result.current.askAi.reference!
  await act(async () => { await result.current.conversations.select({ sessionId: record.sessionId, draftId: 'chat-session-1' }) })
  const view = () => createElement(AppChat, { c: result.current, modelSelectionControl: null, onConfigureAi: () => {} })
  const rendered = render(view())
  const panel = within(screen.getByRole('complementary', { name: 'Ask AI' }))
  fireEvent.click(panel.getByRole('button', { name: 'Apply to editor' }))
  await waitFor(() => expect((kind === 'finding' ? result.current.findings : result.current.testwareDrafts)[0].title).toBe('Refined title'))
  rendered.rerender(view())
  expect(panel.queryByRole('button', { name: 'Apply to editor' })).not.toBeInTheDocument()
  expect(readConversation(reference.draftId).proposals?.[0].state.kind).toBe('staged')
  expect(readConversation('chat-session-1').proposals?.[0].state.kind).toBe('offered')
  expect(result.current.proposalControls.errors[proposal.id]).toBeUndefined()
  expect(api.updateFinding).not.toHaveBeenCalled()
  expect(api.updateDraft).not.toHaveBeenCalled()
})

it('rendered legacy Notes recovery classifies and abandons its prepared stage despite an unrelated engine selection', async () => {
  const { result, record, proposal, after, base, setChat, setConversation, readConversation } = await open()
  const reference = { sessionId: record.sessionId, draftId: 'chat-session-1' }
  const stage = { id: 'legacy-stage', before: proposal.before, after, storedBaseToken: base.expectedStoredBase }
  setChat(chatFixture({ ...reference, mode: 'chat', proposals: [{ ...proposal, state: { kind: 'staged', stage } }],
    messages: [{ id: proposal.assistantMessageId, turnId: 'legacy-turn', role: 'assistant', text: 'A legacy Notes suggestion.', images: [], status: 'completed', errorMessage: null, aiRunId: null, createdAt: 'saved' }] }))
  const fallback = findingFixture({ id: 'fallback', title: 'Unrelated fallback' })
  api.listFindings.mockResolvedValue([fallback])
  await act(async () => { await result.current.loadFindingsForSession(record.sessionId, { force: true, replace: true }) })
  act(() => result.current.askAi.onSelectRecord({ kind: 'finding', recordId: fallback.id, title: fallback.title, unsaved: false }))
  await act(async () => { await result.current.askAi.openStage({ reference, proposalId: proposal.id, stageId: stage.id, record: { kind: 'finding', recordId: record.id } }) })
  const other = chatFixture({ sessionId: record.sessionId, draftId: 'other-record', owner: { kind: 'record', sessionId: record.sessionId, record: { kind: 'finding', recordId: fallback.id } } })
  setConversation(other)
  await act(async () => { await result.current.conversations.select(other) })
  const view = () => createElement(AppChat, { c: result.current, modelSelectionControl: null, onConfigureAi: () => {} })
  const rendered = render(view())
  const panel = within(screen.getByRole('complementary', { name: 'Ask AI' }))
  expect(panel.getByRole('region', { name: `Local refinement for ${record.title}` })).toHaveTextContent('Recovered suggestion awaiting review.')
  fireEvent.click(panel.getByRole('button', { name: 'Review refinement' }))
  expect(panel.getByRole('button', { name: 'Apply to editor' })).toBeDisabled()
  expect(panel.getByRole('button', { name: 'Undo refinement' })).toBeDisabled()
  fireEvent.click(panel.getByRole('button', { name: 'Keep current edits' }))
  await waitFor(() => expect(readConversation(reference.draftId).proposals?.[0].state.kind).toBe('abandoned'))
  rendered.rerender(view())
  expect(panel.getByRole('region', { name: `Local refinement for ${record.title}` })).toHaveTextContent('Prepared change abandoned.')
  expect(result.current.findings[0]).toEqual(fallback)
  expect(readConversation(other.draftId)).toEqual(other)
  expect(api.updateFinding).not.toHaveBeenCalled()
})
