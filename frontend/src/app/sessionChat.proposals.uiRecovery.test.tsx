import '@testing-library/jest-dom/vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import type { BeginRecordChatRequest, DraftPatch, FindingPatch, RecordWriteGuard } from '../bindings'
import { AppChat } from './AppChat'
import { sessionFixture, entryFixture } from '../test/fixtures'
import { chatFixture } from './useSessionChat.testSupport'
import { ChatProposalReview } from '../views/ChatProposalReview'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest } from './useAppController.testHarness'
import { openExact, currentRecord, editTitle, saveCurrent } from './sessionChat.proposals.testSupport'

const api = getTauriMock()
beforeEach(setupControllerTest)
afterEach(() => { cleanupControllerTest(); vi.restoreAllMocks() })

it.each(['finding', 'test_cases_draft'] as const)('%s lost acknowledgement retains a reachable Check update after conversation refresh', async kind => {
  const { result, command, storage, record } = await openExact(kind)
  const write = command.getMockImplementation()!
  command.mockImplementationOnce(async (...args: [string, FindingPatch | DraftPatch, RecordWriteGuard]) => {
    await write(...args)
    throw new Error('Transport lost acknowledgement')
  })
  await act(async () => { expect(await result.current.proposalControls.onUpdate!('proposal-1')).toMatchObject({ kind: 'unconfirmed' }) })
  const view = () => <ChatProposalReview presentation="record" proposal={result.current.sessionChat.chat!.proposals![0]} controls={result.current.proposalControls} />
  const rendered = render(view())
  expect(screen.getByRole('button', { name: 'Check update' })).toBeEnabled()
  await act(async () => { await result.current.conversations.bind({ sessionId: record.sessionId, draftId: 'chat-session-1' }).refresh() })
  rendered.rerender(view())
  expect(storage.read().title).toBe('Refined title')
  expect(command).toHaveBeenCalledOnce()
  expect(result.current.sessionChat.chat!.proposals![0].state.kind).toBe('saved')
  expect(result.current.proposalControls.updated?.has('proposal-1')).toBe(false)
  expect(result.current.proposalControls.errors['proposal-1']).toContain('Transport lost acknowledgement')
  expect(screen.getByRole('button', { name: 'Check update' })).toBeEnabled()
  if (kind === 'finding') api.listFindings.mockResolvedValue([storage.read()])
  else api.listDrafts.mockResolvedValue([storage.read()])
  fireEvent.click(screen.getByRole('button', { name: 'Check update' }))
  await waitFor(() => expect(result.current.proposalControls.updated?.has('proposal-1')).toBe(true))
  rendered.rerender(view())
  expect(screen.getByRole('status')).toHaveTextContent(kind === 'finding' ? 'Finding updated' : 'Test case updated')
  expect(screen.queryByRole('button', { name: /Update finding|Update test case|Check update/ })).not.toBeInTheDocument()
  expect(storage.read().title).toBe('Refined title')
  expect(storage.read().body).toBe('<p>Refined expected result</p>')
  expect(currentRecord(result.current, kind).title).toBe('Refined title')
  expect(currentRecord(result.current, kind).body).toBe('<p>Refined expected result</p>')
  expect(command).toHaveBeenCalledOnce()
  expect(result.current.proposalControls.unconfirmed?.size).toBe(0)
})

it.each(['finding', 'test_cases_draft'] as const)('%s selection round trip during Stage retains the original and does not dispatch', async kind => {
  const { result, command, record, storage } = await openExact(kind)
  const resolve = api.resolveRefinement.getMockImplementation()!
  const reached = deferred<void>(), release = deferred<void>()
  api.resolveRefinement.mockImplementationOnce(async request => { reached.resolve(); await release.promise; return resolve(request) })
  let update!: Promise<unknown>
  act(() => { update = result.current.proposalControls.onUpdate!('proposal-1') })
  await act(async () => { await reached.promise })
  act(() => {
    result.current.askAi.onSelectRecord({ kind, recordId: 'other', title: 'Other', unsaved: false })
    result.current.askAi.onSelectRecord({ kind, recordId: record.id, title: record.title, unsaved: false })
  })
  await act(async () => { release.resolve(); expect(await update).toMatchObject({ kind: 'failed' }) })
  expect(currentRecord(result.current, kind)).toEqual(record)
  expect(storage.read()).toEqual(record)
  expect(command).not.toHaveBeenCalled()
  expect(result.current.hasPendingRecordCompensations()).toBe(false)
})

it.each(['finding', 'test_cases_draft'] as const)('%s edit then revert after dispatch cannot certify Update and remains saveable', async kind => {
  const { result, command, storage } = await openExact(kind)
  const write = command.getMockImplementation()!
  const reached = deferred<void>(), release = deferred<void>()
  command.mockImplementationOnce(async (...args: [string, FindingPatch | DraftPatch, RecordWriteGuard]) => { const saved = await write(...args); reached.resolve(); await release.promise; return saved })
  let update!: Promise<unknown>
  act(() => { update = result.current.proposalControls.onUpdate!('proposal-1') })
  await act(async () => { await reached.promise })
  act(() => { editTitle(result.current, kind, 'Newer then reverted'); editTitle(result.current, kind, 'Refined title') })
  await act(async () => { release.resolve(); expect(await update).toMatchObject({ kind: 'superseded' }) })
  expect(result.current.proposalControls.updated?.has('proposal-1')).toBe(false)
  expect(storage.read().title).toBe('Refined title')
  expect(currentRecord(result.current, kind).title).toBe('Refined title')
  await act(async () => { expect(await saveCurrent(result.current, kind)).toBe(true) })
  expect(result.current.hasPendingRecordCompensations()).toBe(false)
})


it.each(['finding', 'test_cases_draft'] as const)('%s closing and reopening must retain an unconfirmed record update', async kind => {
  const { result, record, proposal, command, setConversation, readConversation, storage } = await openExact(kind)
  let launches = 0
  const message = { id: proposal.assistantMessageId, turnId: 'record-turn', role: 'assistant' as const, text: 'A record suggestion.', images: [], status: 'completed' as const, errorMessage: null, aiRunId: null, createdAt: 'saved' }
  api.beginRecordChat.mockImplementation(async (request: BeginRecordChatRequest) => {
    const row = chatFixture({ ...request, owner: { kind: 'record', sessionId: request.sessionId, record: request.record }, mode: 'chat', proposals: launches++ === 0 ? [proposal] : [], messages: launches === 1 ? [message] : [] })
    setConversation(row)
    return row
  })
  const target = { kind, recordId: record.id, title: record.title, unsaved: false }
  await act(async () => { await result.current.askAi.onAskAi(target) })
  const reference = result.current.askAi.reference!
  const write = command.getMockImplementation()!
  command.mockImplementationOnce(async (...args: [string, FindingPatch | DraftPatch, RecordWriteGuard]) => {
    await write(...args)
    throw new Error('Transport lost acknowledgement')
  })
  const view = () => <AppChat c={result.current} modelSelectionControl={null} onConfigureAi={() => {}} />
  const rendered = render(view())
  const label = kind === 'finding' ? 'Update finding' : 'Update test case'
  const panel = within(screen.getByRole('complementary', { name: 'Ask AI' }))
  fireEvent.click(panel.getByRole('button', { name: label }))
  await waitFor(() => expect(result.current.proposalControls.errors[proposal.id]).toContain('Transport lost acknowledgement'))
  rendered.rerender(view())
  expect(panel.getByRole('button', { name: 'Check update' })).toBeEnabled()
  expect(storage.read().title).toBe('Refined title')
  expect(storage.read().body).toBe('<p>Refined expected result</p>')
  expect(readConversation(reference.draftId).proposals![0].state.kind).toBe('saved')
  api.listChatHistory.mockResolvedValue([{ reference, owner: { kind: 'record', sessionId: record.sessionId, record: { kind, recordId: record.id } }, createdAt: 'saved', lastActiveAt: 'saved', lastActiveOrder: 0, preview: 'A record suggestion.', archived: false, submission: null, hasContent: true, lastTurnStatus: 'completed', unresolvedStages: [] }])
  await act(async () => { await result.current.askAi.close() })
  let reopening!: Promise<void>
  act(() => { reopening = result.current.askAi.onAskAi(target) })
  await waitFor(() => expect(result.current.askAi.revealRequest).not.toBeNull())
  act(() => {
    const request = result.current.askAi.revealRequest!
    result.current.askAi.acknowledgeReveal(request)
  })
  await act(async () => { await reopening })
  rendered.rerender(view())
  expect(command).toHaveBeenCalledOnce()
  expect(result.current.askAi.reference).toEqual(reference)
  expect(panel.getByRole('button', { name: 'Check update' })).toBeEnabled()
  expect(result.current.askAi.recovery).toEqual(expect.arrayContaining([expect.objectContaining({ reference, reason: 'Update confirmation required' })]))
  if (kind === 'finding') api.listFindings.mockResolvedValue([storage.read()])
  else api.listDrafts.mockResolvedValue([storage.read()])
  fireEvent.click(panel.getByRole('button', { name: 'Check update' }))
  await waitFor(() => expect(result.current.proposalControls.unconfirmed?.size).toBe(0))
  rendered.rerender(view())
  expect(panel.getByText(kind === 'finding' ? 'Finding updated' : 'Test case updated')).toBeVisible()
  expect(panel.getByRole('region', { name: `Suggested changes for ${record.title}` })).toHaveTextContent('Refined title')
  expect(panel.getByText('Refined expected result')).toBeVisible()
  expect(command).toHaveBeenCalledOnce()
  expect(result.current.askAi.recovery).toEqual([])
  expect(result.current.proposalControls.errors[proposal.id]).toBeUndefined()
  await act(async () => { await result.current.askAi.close() })
  await act(async () => { await result.current.askAi.onAskAi(target) })
  expect(result.current.askAi.reference).not.toEqual(reference)
  expect(api.beginRecordChat).toHaveBeenCalledTimes(2)
})

it.each(['finding', 'test_cases_draft'] as const)('%s abandons only uninstalled preparation and refreshes its rendered origin', async kind => {
  const { result, command, record, storage, readConversation } = await openExact(kind)
  const resolve = api.resolveRefinement.getMockImplementation()!
  const reached = deferred<void>(), release = deferred<void>()
  api.resolveRefinement.mockImplementationOnce(async request => { reached.resolve(); await release.promise; return resolve(request) })
  const view = () => <ChatProposalReview presentation="record" proposal={result.current.sessionChat.chat!.proposals![0]} controls={result.current.proposalControls} />
  const rendered = render(view())
  fireEvent.click(screen.getByRole('button', { name: kind === 'finding' ? 'Update finding' : 'Update test case' }))
  await act(async () => { await reached.promise })
  act(() => editTitle(result.current, kind, 'Newer manual title'))
  await act(async () => { release.resolve() })
  await waitFor(() => expect(result.current.proposalControls.pending.size).toBe(0))
  rendered.rerender(view())
  expect(readConversation('chat-session-1').proposals![0].state.kind).toBe('abandoned')
  expect(result.current.sessionChat.chat!.proposals![0].state.kind).toBe('abandoned')
  expect(screen.queryByRole('button', { name: /Update finding|Update test case/ })).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Your newer edits are retained')
  expect(currentRecord(result.current, kind).title).toBe('Newer manual title')
  expect(currentRecord(result.current, kind).body).toBe(record.body)
  expect(storage.read()).toEqual(record)
  expect(command).not.toHaveBeenCalled()
})

it.each(['finding', 'test_cases_draft'] as const)('%s refresh failure after abandonment preserves the primary error and known cleanup state', async kind => {
  const { result, command, record, storage, readConversation } = await openExact(kind)
  const resolve = api.resolveRefinement.getMockImplementation()!
  const reached = deferred<void>(), release = deferred<void>()
  api.resolveRefinement.mockImplementationOnce(async request => { reached.resolve(); await release.promise; return resolve(request) })
    .mockImplementationOnce(async request => {
      const abandoned = await resolve(request)
      api.getConversation.mockRejectedValue(new Error('Origin refresh unavailable'))
      return abandoned
    })
  let update!: Promise<unknown>
  act(() => { update = result.current.proposalControls.onUpdate!('proposal-1') })
  await act(async () => { await reached.promise })
  act(() => editTitle(result.current, kind, 'Newer manual title'))
  await act(async () => { release.resolve(); expect(await update).toMatchObject({ kind: 'failed' }) })
  render(<ChatProposalReview presentation="record" proposal={result.current.sessionChat.chat!.proposals![0]} controls={result.current.proposalControls} />)
  expect(readConversation('chat-session-1').proposals![0].state.kind).toBe('abandoned')
  expect(screen.getByRole('alert')).toHaveTextContent('Your newer edits are retained')
  expect(screen.getByRole('alert')).toHaveTextContent('Prepared change was abandoned')
  expect(screen.getByRole('alert')).toHaveTextContent('Origin refresh unavailable')
  expect(screen.getByRole('alert')).not.toHaveTextContent('remains unresolved')
  expect(screen.queryByRole('button', { name: /Update finding|Update test case/ })).not.toBeInTheDocument()
  expect(currentRecord(result.current, kind).title).toBe('Newer manual title')
  expect(storage.read()).toEqual(record)
  expect(command).not.toHaveBeenCalled()
})

it.each(['finding', 'test_cases_draft'] as const)('%s failed recovery read keeps Check update reachable until confirmation', async kind => {
  const { result, command, storage, record } = await openExact(kind)
  const write = command.getMockImplementation()!
  command.mockImplementationOnce(async (...args: [string, FindingPatch | DraftPatch, RecordWriteGuard]) => { await write(...args); throw new Error('Transport lost acknowledgement') })
  await act(async () => { await result.current.proposalControls.onUpdate!('proposal-1') })
  const reference = { sessionId: record.sessionId, draftId: 'chat-session-1' }
  const read = api.getConversation.getMockImplementation()!
  api.getConversation.mockRejectedValueOnce(new Error('Recovery refresh unavailable'))
  const view = () => <ChatProposalReview presentation="record" proposal={result.current.sessionChat.chat!.proposals![0]} controls={result.current.proposalControls} />
  const rendered = render(view())
  fireEvent.click(screen.getByRole('button', { name: 'Check update' }))
  await waitFor(() => expect(result.current.proposalControls.errors['proposal-1']).toContain('Recovery refresh unavailable'))
  rendered.rerender(view())
  expect(screen.getByRole('button', { name: 'Check update' })).toBeEnabled()
  expect(result.current.conversations.attention(record.sessionId).find(entry => entry.reference.draftId === reference.draftId)?.unconfirmedUpdates).toHaveLength(1)
  api.getConversation.mockImplementation(read)
  if (kind === 'finding') api.listFindings.mockResolvedValue([storage.read()])
  else api.listDrafts.mockResolvedValue([storage.read()])
  fireEvent.click(screen.getByRole('button', { name: 'Check update' }))
  await waitFor(() => expect(result.current.proposalControls.unconfirmed?.size).toBe(0))
  rendered.rerender(view())
  expect(screen.getByRole('status')).toHaveTextContent(kind === 'finding' ? 'Finding updated' : 'Test case updated')
  expect(storage.read().body).toBe('<p>Refined expected result</p>')
  expect(command).toHaveBeenCalledOnce()
})

it.each(['finding', 'test_cases_draft'] as const)('%s switching conversations during Check retains only the original recovery', async kind => {
  const { result, command, storage, record, setConversation } = await openExact(kind)
  const write = command.getMockImplementation()!
  command.mockImplementationOnce(async (...args: [string, FindingPatch | DraftPatch, RecordWriteGuard]) => { await write(...args); throw new Error('Transport lost acknowledgement') })
  await act(async () => { await result.current.proposalControls.onUpdate!('proposal-1') })
  const reference = { sessionId: record.sessionId, draftId: 'chat-session-1' }
  const other = { sessionId: record.sessionId, draftId: 'other-conversation' }
  setConversation(chatFixture({ ...other, owner: { kind: 'record', sessionId: record.sessionId, record: { kind, recordId: 'other-record' } }, composer: 'Other conversation input' }))
  const reached = deferred<void>(), release = deferred<void>()
  const read = async () => { reached.resolve(); await release.promise; return [storage.read()] }
  if (kind === 'finding') api.listFindings.mockImplementationOnce(read)
  else api.listDrafts.mockImplementationOnce(read)
  let checking!: Promise<unknown>
  act(() => { checking = result.current.proposalControls.onUpdate!('proposal-1', reference) })
  await act(async () => { await reached.promise })
  await act(async () => { await result.current.conversations.select(other) })
  await act(async () => { release.resolve(); expect(await checking).toMatchObject({ kind: 'failed' }) })
  expect(result.current.proposalControls.unconfirmed?.has('proposal-1')).toBe(true)
  expect(result.current.conversations.attention(record.sessionId).find(entry => entry.reference.draftId === reference.draftId)?.unconfirmedUpdates).toHaveLength(1)
  expect(result.current.conversations.attention(record.sessionId).find(entry => entry.reference.draftId === other.draftId)?.unconfirmedUpdates).toEqual([])
  expect(result.current.conversations.bind(other).snapshot().composer).toBe('Other conversation input')
  expect(result.current.proposalControls.updated?.has('proposal-1')).toBe(false)
  expect(storage.read().title).toBe('Refined title')
  expect(storage.read().body).toBe('<p>Refined expected result</p>')
  expect(command).toHaveBeenCalledOnce()
})


it.each(['finding', 'test_cases_draft'] as const)('%s switching Session during preparation refreshes only the abandoned origin', async kind => {
  const { result, record, command, storage, readConversation, setConversation } = await openExact(kind)
  const resolve = api.resolveRefinement.getMockImplementation()!
  const reached = deferred<void>(), release = deferred<void>()
  api.resolveRefinement.mockImplementationOnce(async request => { reached.resolve(); await release.promise; return resolve(request) })
  let updating!: Promise<unknown>
  act(() => { updating = result.current.proposalControls.onUpdate!('proposal-1') })
  await act(async () => { await reached.promise })
  const nextSession = sessionFixture({ id: 'session-2', title: 'Other Session' })
  api.openSessionNoteState.mockResolvedValueOnce(sessionNoteStateFixture({ session: nextSession, noteEntry: entryFixture({ sessionId: nextSession.id }) }))
  setConversation(chatFixture({ sessionId: nextSession.id, draftId: 'chat-session-2' }))
  api.getChat.mockImplementation(sessionId => Promise.resolve(readConversation(`chat-${sessionId}`)))
  await act(async () => { await result.current.openSession(nextSession) })
  expect(result.current.activeSession?.id).toBe('session-2')
  const other = { sessionId: 'session-2', draftId: 'chat-session-2' }
  await waitFor(() => expect(result.current.sessionChat.chat?.sessionId).toBe('session-2'))
  const before = result.current.conversations.bind(other).snapshot()
  api.getConversation.mockClear()
  await act(async () => { release.resolve(); expect(await updating).toMatchObject({ kind: 'failed' }) })
  expect(readConversation('chat-session-1').proposals![0].state.kind).toBe('abandoned')
  expect(result.current.conversations.bind({ sessionId: record.sessionId, draftId: 'chat-session-1' }).snapshot().chat!.proposals![0].state.kind).toBe('abandoned')
  expect(result.current.conversations.bind(other).snapshot()).toBe(before)
  expect(api.getConversation.mock.calls.map(([reference]) => reference)).toEqual([
    { sessionId: record.sessionId, draftId: 'chat-session-1' },
    { sessionId: record.sessionId, draftId: 'chat-session-1' },
  ])
  expect(storage.read()).toEqual(record)
  expect(command).not.toHaveBeenCalled()
})
