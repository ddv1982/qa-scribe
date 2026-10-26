import '@testing-library/jest-dom/vitest'
import { useLayoutEffect } from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AppShell } from './AppShell'
import type { RecordWorkspace } from './types'
import type { MainView } from '../ui/types'
import { draftFixture, entryFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, renderWithControllerStartup, sessionNoteStateFixture, useAppController } from './useAppController.testHarness'

const { useAskAiContext } = await import('./useAskAiContext')
const api = getTauriMock()
let controller: ReturnType<typeof useAppController>
function Subject() { const current = useAppController(); useLayoutEffect(() => { controller = current }); return <AppShell {...current} /> }
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each([
  { kind: 'finding' as const, missing: false, loaded: false },
  { kind: 'finding' as const, missing: true, loaded: false },
  { kind: 'finding' as const, missing: true, loaded: true },
  { kind: 'test_cases_draft' as const, missing: false, loaded: false },
  { kind: 'test_cases_draft' as const, missing: true, loaded: false },
  { kind: 'test_cases_draft' as const, missing: true, loaded: true },
  { kind: 'finding' as const, missing: true, loaded: false, noFallback: true },
  { kind: 'test_cases_draft' as const, missing: true, loaded: false, noFallback: true },
])('first recovery reveals the exact unfinished $kind owner with missing source $missing and loaded collection $loaded and no fallback $noFallback', async ({ kind, missing, loaded, noFallback = false }) => {
  const reference = { sessionId: 'session-1', draftId: 'persisted-unfinished-A' }
  const owner = { kind: 'record', sessionId: 'session-1', record: { kind, recordId: 'source-A' } } as const
  const source = { id: 'source-A', title: 'Original A source' }
  const fallback = { id: 'source-B', title: 'Visible B source' }
  const other = { id: 'source-C', title: 'Other C source' }
  const records = noFallback ? [] : missing ? [fallback, other] : [source, fallback, other]
  if (kind === 'finding') api.listFindings.mockResolvedValue(records.map(record => findingFixture(record)))
  else api.listDrafts.mockResolvedValue(records.map(record => draftFixture(record)))
  const row = chatFixture({ ...reference, owner, mode: 'chat', lastActiveOrder: 8, composer: 'Literal retained restart input. 雪', messages: [{ id: 'persisted-user', turnId: 'persisted-turn', role: 'user', text: 'Original interrupted request', images: [], status: 'interrupted', errorMessage: null, aiRunId: null, createdAt: 'saved' }] })
  const originalGet = api.getConversation.getMockImplementation()!
  api.getConversation.mockImplementation(async ref => ref.draftId === reference.draftId ? row : originalGet(ref))
  api.listChatHistory.mockResolvedValue([
    { reference, owner, createdAt: '', lastActiveAt: '', lastActiveOrder: 8, preview: '', archived: false, submission: null, hasContent: true, lastTurnStatus: 'interrupted', unresolvedStages: [] },
    { reference: { ...reference, draftId: 'completed-unrelated' }, owner, createdAt: '', lastActiveAt: '', lastActiveOrder: 9, preview: '', archived: false, submission: null, hasContent: true, lastTurnStatus: 'completed', unresolvedStages: [] },
  ])
  await renderWithControllerStartup(() => render(<Subject />))
  const tabs = within(screen.getByRole('tablist'))
  if (loaded) {
    fireEvent.click(tabs.getByRole('tab', { name: kind === 'finding' ? /Findings/ : /Test cases/ }))
    await screen.findByRole('heading', { name: 'Visible B source' })
    fireEvent.click(tabs.getByRole('tab', { name: 'Note' }))
  }
  const recover = await screen.findByRole('button', { name: /Recover Ask AI/ })
  expect(controller.askAi.recovery.map(item => item.reference)).toEqual([reference])
  fireEvent.click(recover)
  const panel = within(await screen.findByRole('complementary', { name: 'Ask AI' }))
  const input = await panel.findByRole('textbox', { name: 'Message' })
  await waitFor(() => expect(input).toHaveValue('Literal retained restart input. 雪'))
  await waitFor(() => expect(controller.askAi.revealRequest).toBeNull())
  expect(controller.askAi.visible).toBe(true)
  expect(controller.askAi.reference).toEqual(reference)
  expect(controller.recordChat.chat?.owner).toEqual(owner)
  expect(controller.askAi.panel?.owner).toEqual(owner)
  expect(controller.askAi.source).toEqual(missing ? { kind: 'unavailable' } : { kind: 'available', title: 'Original A source', unsaved: false })
  if (!noFallback) expect(screen.getByRole('heading', { name: missing ? 'Visible B source' : 'Original A source' })).toBeVisible()
  if (missing) {
    expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(() => controller.askAi.capture('session-1', owner)).toThrow('This record is no longer available in this Session.')
    await act(async () => { await controller.conversations.bind(reference).send() })
    expect(input).toHaveValue('Literal retained restart input. 雪')
    expect(controller.recordChat.chat?.owner).toEqual(owner)
    fireEvent.click(panel.getByRole('button', { name: 'Close Ask AI' }))
    await waitFor(() => expect(controller.askAi.visible).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: /Recover Ask AI/ }))
    expect(await panel.findByRole('textbox', { name: 'Message' })).toHaveValue('Literal retained restart input. 雪')
    expect(controller.askAi.reference).toEqual(reference)
    expect(controller.recordChat.chat?.owner).toEqual(owner)
  } else {
    const target = controller.askAi.capture('session-1', owner)
    expect(target.kind).toBe(kind)
    if (target.kind === 'session') throw new Error('Expected the original source')
    expect(target.snapshot.recordId).toBe('source-A')
  }
  if (!noFallback) {
    const recordList = screen.getByRole('complementary', { name: kind === 'finding' ? 'Issues and risks records' : 'Test cases records' })
    fireEvent.click(within(recordList).getByRole('button', { name: /Other C source/ }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument())
    fireEvent.click(within(recordList).getByRole('button', { name: missing ? /Visible B source/ : /Original A source/ }))
    expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument()
  }
  expect(controller.askAi.reference).toEqual(reference)
  expect(controller.recordChat.chat?.owner).toEqual(owner)
  expect(api.beginRecordChat).not.toHaveBeenCalled()
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.updateFinding).not.toHaveBeenCalled()
  expect(api.updateDraft).not.toHaveBeenCalled()
})

async function setupPendingRecovery(kind: 'finding' | 'test_cases_draft') {
  const reference = { sessionId: 'session-1', draftId: 'retained-A' }
  const owner = { kind: 'record', sessionId: 'session-1', record: { kind, recordId: 'deleted-A' } } as const
  const row = chatFixture({ ...reference, owner, mode: 'chat', composer: 'Exact A retained input', messages: [{ id: 'user-A', turnId: 'turn-A', role: 'user', text: 'Interrupted A request', images: [], status: 'interrupted', errorMessage: null, aiRunId: null, createdAt: 'saved' }] })
  const sessions = [sessionFixture(), sessionFixture({ id: 'session-2', title: 'Second Session' })]
  api.listSessions.mockResolvedValue(sessions)
  api.listRecentSessions.mockResolvedValue(sessions)
  api.listFindings.mockImplementation(async sessionId => [findingFixture({ id: `${sessionId}-B`, sessionId, title: 'Visible B' }), findingFixture({ id: `${sessionId}-C`, sessionId, title: 'Visible C' })])
  api.listDrafts.mockImplementation(async sessionId => [draftFixture({ id: `${sessionId}-B`, sessionId, title: 'Visible B' }), draftFixture({ id: `${sessionId}-C`, sessionId, title: 'Visible C' })])
  api.openSessionNoteState.mockImplementation(async id => sessionNoteStateFixture({ session: sessionFixture({ id }), noteEntry: entryFixture({ sessionId: id, id: `note-${id}` }) }))
  const original = api.getConversation.getMockImplementation()!
  api.getConversation.mockImplementation(async ref => ref.draftId === reference.draftId ? row : original(ref))
  api.listChatHistory.mockResolvedValue([{ reference, owner, createdAt: '', lastActiveAt: '', lastActiveOrder: 8, preview: '', archived: false, submission: null, hasContent: true, lastTurnStatus: 'interrupted', unresolvedStages: [] }])
  const rendered = await renderWithControllerStartup(() => render(<Subject />))
  await screen.findByRole('button', { name: /Recover Ask AI/ })
  return { reference, owner, row, ...rendered }
}

it.each(['finding', 'test_cases_draft'] as const)('a %s source read held across a Session switch does not suppress later record navigation', async kind => {
  const { reference, owner } = await setupPendingRecovery(kind)
  const loading = deferred<never[]>()
  if (kind === 'finding') {
    const list = api.listFindings.getMockImplementation()!
    api.listFindings.mockImplementation(async id => id === 'session-1' ? loading.promise : list(id))
  } else {
    const list = api.listDrafts.getMockImplementation()!
    api.listDrafts.mockImplementation(async id => id === 'session-1' ? loading.promise : list(id))
  }
  fireEvent.click(screen.getByRole('button', { name: /Recover Ask AI/ }))
  await waitFor(() => expect(kind === 'finding' ? controller.findingLoadState : controller.draftLoadState).toBe('loading'))
  expect(controller.askAi.revealRequest?.record.recordId).toBe('deleted-A')
  await act(async () => { await controller.openSession(sessionFixture({ id: 'session-2', title: 'Second Session' })) })
  await waitFor(() => expect(controller.activeSession?.id).toBe('session-2'))
  expect(controller.askAi.revealRequest).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: kind === 'finding' ? /Findings/ : /Test cases/ }))
  await screen.findByRole('heading', { name: 'Visible B' })
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
  const panel = within(await screen.findByRole('complementary', { name: 'Ask AI' }))
  const input = await panel.findByRole('textbox', { name: 'Message' })
  fireEvent.change(input, { target: { value: 'Session 2 owned literal input' } })
  const newerReference = controller.askAi.reference!
  expect(controller.askAi.panel?.owner).toEqual({ kind: 'record', sessionId: 'session-2', record: { kind, recordId: 'session-2-B' } })
  const recordList = screen.getByRole('complementary', { name: kind === 'finding' ? 'Issues and risks records' : 'Test cases records' })
  fireEvent.click(within(recordList).getByRole('button', { name: /Visible C/ }))
  await screen.findByRole('heading', { name: 'Visible C' })
  await waitFor(() => expect(controller.askAi.visible).toBe(false))
  await act(async () => { loading.resolve([]) })
  expect(controller.askAi.visible).toBe(false)
  expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument()
  expect(controller.askAi.revealRequest).toBeNull()
  expect(controller.askAi.reference).toEqual(newerReference)
  expect(controller.askAi.panel?.owner).toEqual({ kind: 'record', sessionId: 'session-2', record: { kind, recordId: 'session-2-B' } })
  expect(controller.conversations.bind(newerReference).snapshot().composer).toBe('Session 2 owned literal input')
  expect(controller.conversations.bind(reference).snapshot().chat?.owner).toEqual(owner)
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.updateFinding).not.toHaveBeenCalled()
  expect(api.updateDraft).not.toHaveBeenCalled()
})

it('unmount retires a held reveal before its source read returns', async () => {
  const { reference, unmount } = await setupPendingRecovery('finding')
  const loading = deferred<never[]>()
  api.listFindings.mockReturnValue(loading.promise)
  let opening!: Promise<void>
  act(() => { opening = controller.askAi.openConversation(reference) })
  await waitFor(() => expect(controller.askAi.revealRequest?.record.recordId).toBe('deleted-A'))
  unmount()
  await act(async () => { await opening })
  expect(api.activateConversation).not.toHaveBeenCalledWith(reference)
  await act(async () => { loading.resolve([]) })
  expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument()
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.updateFinding).not.toHaveBeenCalled()
  expect(api.updateDraft).not.toHaveBeenCalled()
})

it('an old reveal finally cannot clear protection for a newer recovery', async () => {
  const { reference, row } = await setupPendingRecovery('finding')
  const newerReference = { sessionId: 'session-1', draftId: 'newer-recovery-B' }
  const newerOwner = { kind: 'record', sessionId: 'session-1', record: { kind: 'finding', recordId: 'source-B' } } as const
  const newerRow = chatFixture({ ...newerReference, owner: newerOwner, mode: 'chat', composer: 'Exact newer B input' })
  const get = api.getConversation.getMockImplementation()!
  api.getConversation.mockImplementation(async ref => ref.draftId === newerReference.draftId ? newerRow : get(ref))
  const records: RecordWorkspace = {
    drafts: [], findings: [findingFixture({ id: 'source-B', title: 'Newer B source' })],
    dirtyDraftIdsRef: { current: new Set() }, dirtyFindingIdsRef: { current: new Set() },
    draftsRef: { current: [] }, findingsRef: { current: [] }, savedDraftsRef: { current: [] }, savedFindingsRef: { current: [] },
    setDrafts: () => {}, setFindings: () => {}, setTestwareDraftCount: () => {}, setFindingCount: () => {},
  }
  const oldCompletion = deferred<boolean>()
  const conversations = controller.conversations
  const hook = renderHook(({ view }: { view: MainView }) => useAskAiContext('session-1', view, records, {
    conversations, findingLoadState: 'ready', draftLoadState: 'ready', findingLoadError: null, draftLoadError: null,
    findingSourceIds: new Set(['source-B']), draftSourceIds: new Set(), retrySource: () => {}, openNotes: () => {},
    revealOwner: async (owner, reveal) => {
      const accepted = reveal ? await reveal() : true
      return owner.kind === 'record' && owner.record.recordId === 'deleted-A' ? oldCompletion.promise : accepted
    },
  }), { initialProps: { view: 'sessions' } })
  let oldOpening!: Promise<void>
  act(() => { oldOpening = hook.result.current.openConversation(reference) })
  await waitFor(() => expect(hook.result.current.revealRequest?.record.recordId).toBe('deleted-A'))
  act(() => hook.result.current.invalidateNavigation())
  let newerOpening!: Promise<void>
  act(() => { newerOpening = hook.result.current.openConversation(newerReference) })
  await waitFor(() => expect(hook.result.current.revealRequest?.record.recordId).toBe('source-B'))
  const newerRequest = hook.result.current.revealRequest!
  await act(async () => { oldCompletion.resolve(false); await oldOpening })
  expect(hook.result.current.revealRequest).toEqual(newerRequest)
  hook.rerender({ view: 'findings' })
  await act(async () => {
    hook.result.current.onSelectRecord({ ...newerOwner.record, title: 'Newer B source', unsaved: false }, newerRequest.requestId)
    hook.result.current.acknowledgeReveal(newerRequest)
    await newerOpening
  })
  expect(hook.result.current.visible).toBe(true)
  expect(hook.result.current.reference).toEqual(newerReference)
  expect(hook.result.current.panel?.owner).toEqual(newerOwner)
  expect(conversations.bind(newerReference).snapshot().composer).toBe('Exact newer B input')
  expect(conversations.bind(reference).snapshot().chat?.owner).toEqual(row.owner)
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.updateFinding).not.toHaveBeenCalled()
  expect(api.updateDraft).not.toHaveBeenCalled()
})
