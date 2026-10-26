import '@testing-library/jest-dom/vitest'
import { useLayoutEffect } from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import type { BeginRecordChatRequest, ChatHistoryEntry, ChatState } from '../bindings'
import type { RecordWorkspace } from './types'
import { draftFixture, entryFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, renderWithControllerStartup, sessionNoteStateFixture, useAppController } from './useAppController.testHarness'

const { useAskAiContext } = await import('./useAskAiContext')
const api = getTauriMock()
const kinds = ['finding', 'test_cases_draft'] as const
let controller: ReturnType<typeof useAppController>
function Subject() { const current = useAppController(); useLayoutEffect(() => { controller = current }); return <AppShell {...current} /> }
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

async function setup(kind: typeof kinds[number], read: (row: ChatState) => Promise<ChatState> = async row => row) {
  const reference = { sessionId: 'session-1', draftId: 'retained-failed-read' }
  const owner = { kind: 'record', sessionId: 'session-1', record: { kind, recordId: 'source-A' } } as const
  const records = [{ id: 'source-A', title: 'Original source' }, { id: 'source-B', title: 'Other source' }]
  api.listFindings.mockResolvedValue(records.map(row => findingFixture(row)))
  api.listDrafts.mockResolvedValue(records.map(row => draftFixture(row)))
  const row = chatFixture({ ...reference, owner, mode: 'chat', composer: 'Literal retained recovery input. 雪',
    messages: [{ id: 'retained-user', turnId: 'retained-turn', role: 'user', text: 'Interrupted original request', images: [], status: 'interrupted', errorMessage: null, aiRunId: null, createdAt: 'saved' }] })
  api.listChatHistory.mockResolvedValue([{ reference, owner, createdAt: '', lastActiveAt: '', lastActiveOrder: 8,
    preview: '', archived: false, submission: null, hasContent: true, lastTurnStatus: 'interrupted', unresolvedStages: [] }])
  const get = api.getConversation.getMockImplementation()!
  api.getConversation.mockImplementation(async ref => ref.draftId === reference.draftId ? read(row) : get(ref))
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('tab', { name: kind === 'finding' ? /Findings/ : /Test cases/ }))
  await screen.findByRole('heading', { name: 'Original source' })
  return { reference, owner, row, target: { ...owner.record, title: 'Original source', unsaved: false } }
}

it.each(kinds)('%s retained refresh failure ends preparing with a visible error, usable Close and an exact retry', async kind => {
  let failed = true
  const { reference, owner } = await setup(kind, async row => {
    if (failed) throw new Error('Synthetic retained read failed')
    return row
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await waitFor(() => expect(controller.askAi.panel?.phase).toBe('error'))
  expect(within(screen.getByRole('complementary', { name: 'Ask AI' })).getByRole('alert')).toHaveTextContent('Synthetic retained read failed')
  expect(screen.queryByText('Preparing conversation…')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Message' })).not.toBeInTheDocument()
  expect(controller.askAi.reference).toBeNull()
  expect(controller.askAi.panel?.owner).toEqual(owner)
  expect(controller.askAi.source).toEqual({ kind: 'available', title: 'Original source', unsaved: false })
  fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }))
  await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument())
  failed = false
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Literal retained recovery input. 雪')
  expect(controller.askAi.panel?.phase).toBe('ready')
  expect(controller.askAi.reference).toEqual(reference)
  expect(controller.recordChat.chat?.owner).toEqual(owner)
  expect(api.beginRecordChat).not.toHaveBeenCalled()
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.updateFinding).not.toHaveBeenCalled()
  expect(api.updateDraft).not.toHaveBeenCalled()
})

it.each(kinds)('%s declined reveal ends its owned preparing state and can retry the retained reference', async kind => {
  const { reference, owner, target } = await setup(kind)
  const findings = controller.findings
  const drafts = controller.testwareDrafts
  const records: RecordWorkspace = {
    findings, drafts, findingsRef: { current: findings }, draftsRef: { current: drafts },
    savedFindingsRef: { current: findings }, savedDraftsRef: { current: drafts },
    dirtyFindingIdsRef: { current: new Set() }, dirtyDraftIdsRef: { current: new Set() },
    setFindings: () => {}, setDrafts: () => {}, setFindingCount: () => {}, setTestwareDraftCount: () => {},
  }
  const conversations = controller.conversations
  const revealOwner = vi.fn(async () => false)
  const hook = renderHook(() => useAskAiContext('session-1', kind === 'finding' ? 'findings' : 'testware', records, {
    conversations, revealOwner, openNotes: () => {}, retrySource: () => {},
    findingLoadState: 'ready', draftLoadState: 'ready', findingLoadError: null, draftLoadError: null,
    findingSourceIds: new Set(['source-A', 'source-B']), draftSourceIds: new Set(['source-A', 'source-B']),
  }))
  act(() => hook.result.current.onSelectRecord(target))
  await act(async () => { await hook.result.current.onAskAi(target) })
  expect(hook.result.current.panel?.phase).toBe('error')
  expect(hook.result.current.panel?.phase === 'error' && hook.result.current.panel.error).toMatch(/retained conversation.*not be opened/i)
  expect(hook.result.current.panel?.owner).toEqual(owner)
  expect(hook.result.current.reference).toBeNull()
  expect(api.activateConversation).not.toHaveBeenCalledWith(reference)
  revealOwner.mockResolvedValue(true)
  await act(async () => { await hook.result.current.onAskAi(target) })
  expect(hook.result.current.panel?.phase).toBe('ready')
  expect(hook.result.current.reference).toEqual(reference)
  expect(conversations.bind(reference).snapshot().composer).toBe('Literal retained recovery input. 雪')
  expect(api.beginRecordChat).not.toHaveBeenCalled()
  expect(api.startChatJob).not.toHaveBeenCalled()
})

it.each(kinds)('%s late retained read failure cannot reset a newer panel or paint its recovery error', async kind => {
  const held = deferred<void>()
  const { target } = await setup(kind, async () => { await held.promise; throw new Error('Stale retained read failure') })
  let opening!: Promise<void>
  act(() => { opening = controller.askAi.onAskAi(target) })
  await waitFor(() => expect(api.getConversation).toHaveBeenCalledWith({ sessionId: 'session-1', draftId: 'retained-failed-read' }))
  expect(controller.askAi.panel?.phase).toBe('preparing')
  const list = screen.getByRole('complementary', { name: kind === 'finding' ? 'Issues and risks records' : 'Test cases records' })
  fireEvent.click(within(list).getByRole('button', { name: /Other source/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  const input = await screen.findByRole('textbox', { name: 'Message' })
  fireEvent.change(input, { target: { value: 'Literal newer B input. 雪' } })
  const newer = controller.askAi.reference
  await act(async () => { held.resolve(); await opening })
  expect(controller.askAi.recoveryError).toBeNull()
  expect(controller.askAi.panel?.phase).toBe('ready')
  expect(controller.askAi.reference).toEqual(newer)
  expect(controller.askAi.panel?.owner).toEqual({ kind: 'record', sessionId: 'session-1', record: { kind, recordId: 'source-B' } })
  expect(input).toHaveValue('Literal newer B input. 雪')
  expect(within(screen.getByRole('complementary', { name: 'Ask AI' })).queryByText(/Stale retained read failure/)).not.toBeInTheDocument()
  expect(api.beginRecordChat).toHaveBeenCalledOnce()
  expect(api.startChatJob).not.toHaveBeenCalled()
})


it.each([
  ['finding', 'close', 'flush'],
  ['test_cases_draft', 'records', 'history'],
  ['finding', 'records', 'begin'],
  ['test_cases_draft', 'close', 'begin'],
  ['finding', 'close', 'refresh'],
  ['test_cases_draft', 'records', 'select'],
] as const)('%s first re-click after %s resumes a launch held at %s', async (kind, navigation, boundary) => {
  const records = [{ id: 'source-A', title: 'Original source' }, { id: 'source-B', title: 'Other source' }]
  api.listFindings.mockResolvedValue(records.map(row => findingFixture(row)))
  api.listDrafts.mockResolvedValue(records.map(row => draftFixture(row)))
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('tab', { name: kind === 'finding' ? /Findings/ : /Test cases/ }))
  await screen.findByRole('heading', { name: 'Original source' })
  const held = deferred<void>()
  let reached = false
  const hold = async () => { reached = true; await held.promise }
  if (boundary === 'flush') {
    const flush = controller.conversations.flushInputs
    vi.spyOn(controller.conversations, 'flushInputs').mockImplementationOnce(async () => { await hold(); return flush() })
  } else if (boundary === 'history') {
    const history = api.listChatHistory.getMockImplementation()!
    api.listChatHistory.mockImplementationOnce(async scope => { await hold(); return history(scope) })
  } else if (boundary === 'begin') {
    const begin = api.beginRecordChat.getMockImplementation()!
    api.beginRecordChat.mockImplementationOnce(async request => { const chat = await begin(request); await hold(); return chat })
  } else if (boundary === 'refresh') {
    const read = api.getConversation.getMockImplementation()!
    api.getConversation.mockImplementationOnce(async reference => { await hold(); return read(reference) })
  } else {
    const select = api.activateConversation.getMockImplementation()!
    api.activateConversation.mockImplementationOnce(async reference => { await hold(); return select(reference) })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await waitFor(() => expect(reached).toBe(true))
  expect(screen.getByText('Preparing conversation…')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  expect(api.beginRecordChat.mock.calls.length).toBe(boundary === 'flush' || boundary === 'history' ? 0 : 1)
  if (navigation === 'close') {
    fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }))
    await waitFor(() => expect(controller.askAi.visible).toBe(false))
  } else {
    const list = within(screen.getByRole('complementary', { name: kind === 'finding' ? 'Issues and risks records' : 'Test cases records' }))
    fireEvent.click(list.getByRole('button', { name: /Other source/ }))
    fireEvent.click(list.getByRole('button', { name: /Original source/ }))
    expect(controller.askAi.visible).toBe(false)
  }
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await act(async () => { held.resolve() })
  const input = await screen.findByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).toBeEnabled())
  expect(input).toHaveFocus()
  expect(input).toHaveValue('')
  expect(controller.recordChat.chat?.owner).toEqual({ kind: 'record', sessionId: 'session-1', record: { kind, recordId: 'source-A' } })
  expect(controller.askAi.panel?.phase).toBe('ready')
  expect(new Set(api.beginRecordChat.mock.calls.map(call => (call[0] as BeginRecordChatRequest).draftId)).size).toBe(1)
  expect(api.beginRecordChat).toHaveBeenCalledOnce()
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.updateFinding).not.toHaveBeenCalled()
  expect(api.updateDraft).not.toHaveBeenCalled()
})


it.each(['session', 'uncertain creation'] as const)('an invalidated launch after %s retains the exact begin and cannot clear a newer pending attempt', async navigation => {
  api.listFindings.mockImplementation(async sessionId => [findingFixture({ sessionId, id: 'source-A', title: 'Original source' })])
  api.openSessionNoteState.mockImplementation(async id => sessionNoteStateFixture({ session: sessionFixture({ id }), noteEntry: entryFixture({ sessionId: id, id: `note-${id}` }) }))
  await renderWithControllerStartup(() => render(<Subject />))
  fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
  await screen.findByRole('heading', { name: 'Original source' })
  const held = deferred<void>()
  const retry = deferred<void>()
  const begin = api.beginRecordChat.getMockImplementation()!
  api.beginRecordChat.mockImplementationOnce(async request => {
    const committed = await begin(request)
    await held.promise
    if (navigation === 'uncertain creation') throw new Error('Synthetic response lost after creation committed')
    return committed
  })
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await waitFor(() => expect(api.beginRecordChat).toHaveBeenCalledOnce())
  if (navigation === 'session') {
    await act(async () => { await controller.openSession(sessionFixture({ id: 'session-2', title: 'Second Session' })) })
    expect(controller.activeSession?.id).toBe('session-2')
    await act(async () => { await controller.openSession(sessionFixture()) })
    expect(controller.activeSession?.id).toBe('session-1')
    fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
    await screen.findByRole('heading', { name: 'Original source' })
  } else {
    fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' }))
    await waitFor(() => expect(controller.askAi.visible).toBe(false))
    api.beginRecordChat.mockImplementationOnce(async request => { const committed = await begin(request); await retry.promise; return committed })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  await act(async () => { held.resolve() })
  if (navigation === 'uncertain creation') {
    await waitFor(() => expect(api.beginRecordChat).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
    expect(api.beginRecordChat.mock.calls[1][0]).toEqual(api.beginRecordChat.mock.calls[0][0])
    await act(async () => { retry.resolve() })
  }
  const input = await screen.findByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).toBeEnabled())
  expect(controller.askAi.panel?.phase).toBe('ready')
  expect(controller.askAi.reference).toEqual({ sessionId: 'session-1', draftId: (api.beginRecordChat.mock.calls[0][0] as BeginRecordChatRequest).draftId })
  expect(input).toHaveValue('')
  expect(screen.queryByText(/Synthetic response lost/)).not.toBeInTheDocument()
  expect(api.beginRecordChat).toHaveBeenCalledTimes(navigation === 'session' ? 1 : 2)
  expect((await api.listChatHistory({ kind: 'session', sessionId: 'session-1' }) as ChatHistoryEntry[]).length).toBe(1)
  expect(api.startChatJob).not.toHaveBeenCalled()
})
