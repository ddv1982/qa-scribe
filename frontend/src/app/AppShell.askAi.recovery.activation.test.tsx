import '@testing-library/jest-dom/vitest'
import { useLayoutEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AppShell } from './AppShell'
import type { BeginRecordChatRequest, ChatRef } from '../bindings'
import { draftFixture, entryFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { chatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, renderWithControllerStartup, sessionNoteStateFixture, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
let controller: ReturnType<typeof useAppController>
function Subject() { const current = useAppController(); useLayoutEffect(() => { controller = current }); return <AppShell {...current} /> }
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

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

it.each(['close', 'session', 'newer'])('late missing-source activation cannot overwrite the later %s action', async action => {
  const { reference, owner, row } = await setupPendingRecovery('finding')
  if (action === 'newer') {
    fireEvent.click(screen.getByRole('tab', { name: /Findings/ }))
    await screen.findByRole('heading', { name: 'Visible B' })
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
    const prior = await screen.findByRole('textbox', { name: 'Message' })
    fireEvent.change(prior, { target: { value: 'Literal B previous input' } })
  }
  const gate = deferred<ReturnType<typeof chatFixture>>()
  const activate = api.activateConversation.getMockImplementation()!
  api.activateConversation.mockImplementation(async (ref: ChatRef) => ref.draftId === reference.draftId ? gate.promise : activate(ref))
  fireEvent.click(screen.getByRole('button', { name: /Recover Ask AI/ }))
  await waitFor(() => expect(api.activateConversation).toHaveBeenCalledWith(reference))
  await waitFor(() => expect(controller.askAi.revealRequest).toBeNull())
  let newer = controller.askAi.reference
  if (action === 'close') await act(async () => { await controller.askAi.close() })
  if (action === 'session') {
    await act(async () => { await controller.openSession(sessionFixture({ id: 'session-2', title: 'Second Session' })) })
    await waitFor(() => expect(controller.activeSession?.id).toBe('session-2'))
  }
  if (action === 'newer') {
    const list = screen.getByRole('complementary', { name: 'Issues and risks records' })
    fireEvent.click(within(list).getByRole('button', { name: /Visible C/ }))
    await waitFor(() => expect(controller.askAi.visible).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }))
    await waitFor(() => expect(controller.askAi.panel?.owner.record.recordId).toBe('session-1-C'))
    await screen.findByRole('textbox', { name: 'Message' })
    newer = controller.askAi.reference
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Literal C newer input' } })
  }
  await act(async () => { gate.resolve(row) })
  await act(async () => { await Promise.resolve() })
  expect(controller.askAi.revealRequest).toBeNull()
  if (action === 'newer') {
    expect(controller.askAi.visible).toBe(true)
    expect(controller.askAi.reference).toEqual(newer)
    expect(controller.askAi.panel?.owner.record.recordId).toBe('session-1-C')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Literal C newer input')
    const previousRef = api.beginRecordChat.mock.calls[0][0] as BeginRecordChatRequest
    expect(controller.conversations.bind(previousRef).snapshot().composer).toBe('Literal B previous input')
  } else {
    expect(controller.askAi.visible).toBe(false)
    expect(screen.queryByRole('complementary', { name: 'Ask AI' })).not.toBeInTheDocument()
  }
  if (action === 'session') {
    await act(async () => { await controller.openSession(sessionFixture()) })
    await waitFor(() => expect(controller.activeSession?.id).toBe('session-1'))
    expect(controller.askAi.visible).toBe(false)
    expect(controller.askAi.revealRequest).toBeNull()
  }
  expect(controller.conversations.bind(reference).snapshot().chat?.owner).toEqual(owner)
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.updateFinding).not.toHaveBeenCalled()
  expect(api.updateDraft).not.toHaveBeenCalled()
})
