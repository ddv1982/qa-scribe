import '@testing-library/jest-dom/vitest'
import { useLayoutEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { AppShell } from './AppShell'
import type { BeginRecordChatRequest, ChatHistoryEntry } from '../bindings'
import { entryFixture, findingFixture, sessionFixture } from '../test/fixtures'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, renderWithControllerStartup, sessionNoteStateFixture, useAppController } from './useAppController.testHarness'

vi.mock('../editor/RichTextEditor', () => import('../test/askAiRichEditorMock'))

const api = getTauriMock()
let controller: ReturnType<typeof useAppController>
function Subject() { const current = useAppController(); useLayoutEffect(() => { controller = current }); return <AppShell {...current} /> }
beforeEach(setupControllerTest)
afterEach(cleanupControllerTest)

it.each(['session', 'uncertain creation'] as const)('an invalidated launch after %s retains the exact begin and cannot clear a newer pending attempt', async navigation => {
  api.listFindings.mockImplementation(async sessionId => [findingFixture({ sessionId, id: 'source-A', title: 'Original source' })])
  api.openSessionNoteState.mockImplementation(async id => sessionNoteStateFixture({ session: sessionFixture({ id }), noteEntry: entryFixture({ sessionId: id, id: `note-${id}` }) }))
  await renderWithControllerStartup(() => render(<Subject />))
  await act(async () => fireEvent.click(screen.getByRole('tab', { name: /Findings/ })))
  await screen.findByRole('heading', { name: 'Original source' })
  const held = deferred<void>()
  onTestFinished(async () => { await act(async () => { held.resolve() }) })
  const retry = deferred<void>()
  onTestFinished(async () => { await act(async () => { retry.resolve() }) })
  try {
    const begin = api.beginRecordChat.getMockImplementation()!
    api.beginRecordChat.mockImplementationOnce(async request => {
      const committed = await begin(request)
      await held.promise
      if (navigation === 'uncertain creation') throw new Error('Synthetic response lost after creation committed')
      return committed
    })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ask AI' })))
    await waitFor(() => expect(api.beginRecordChat).toHaveBeenCalledOnce())
    if (navigation === 'session') {
      await act(async () => { await controller.openSession(sessionFixture({ id: 'session-2', title: 'Second Session' })) })
      expect(controller.activeSession?.id).toBe('session-2')
      await act(async () => { await controller.openSession(sessionFixture()) })
      expect(controller.activeSession?.id).toBe('session-1')
      await act(async () => fireEvent.click(screen.getByRole('tab', { name: /Findings/ })))
      await screen.findByRole('heading', { name: 'Original source' })
    } else {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Close Ask AI' })))
      await waitFor(() => expect(controller.askAi.visible).toBe(false))
      api.beginRecordChat.mockImplementationOnce(async request => { const committed = await begin(request); await retry.promise; return committed })
    }
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ask AI' })))
    await act(async () => { held.resolve() })
    if (navigation === 'uncertain creation') {
      await waitFor(() => expect(api.beginRecordChat).toHaveBeenCalledTimes(2))
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ask AI' })))
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
  } finally {
    await act(async () => { held.resolve(); retry.resolve() })
  }
})
