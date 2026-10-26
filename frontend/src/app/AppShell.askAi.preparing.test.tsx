import '@testing-library/jest-dom/vitest'
import { useLayoutEffect } from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import type { ChatState } from '../bindings'
import type { RecordWorkspace } from './types'
import { draftFixture, findingFixture } from '../test/fixtures'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, renderWithControllerStartup, useAppController } from './useAppController.testHarness'

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
