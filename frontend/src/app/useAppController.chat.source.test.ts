import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { findingFixture } from '../test/fixtures'
import type { Finding } from '../bindings'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
const target = { kind: 'finding', recordId: 'finding-1', title: 'Synthetic source', unsaved: false } as const
beforeEach(() => { setupControllerTest(); api.listFindings.mockResolvedValue([findingFixture()]) })
afterEach(cleanupControllerTest)
async function open() {
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.sessionChat.chat?.sessionId).toBe('session-1'))
  await act(async () => { hook.result.current.setActiveView('findings') })
  await waitFor(() => expect(hook.result.current.findingLoadState).toBe('ready'))
  act(() => hook.result.current.askAi.onSelectRecord(target))
  await act(async () => { await hook.result.current.askAi.onAskAi(target) })
  const reference = hook.result.current.askAi.reference!
  return { ...hook, handle: hook.result.current.conversations.bind(reference) }
}
it('loading and failed hydration retain the saved source identity and prevent stale fresh capture', async () => {
  const { result, handle } = await open()
  act(() => handle.setComposer('Retain this source question'))
  const gate = deferred<Finding[]>()
  api.listFindings.mockImplementationOnce(async () => { await gate.promise; throw new Error('Synthetic unavailable read') })
  let loading!: Promise<Finding[]>
  act(() => { loading = result.current.loadFindingsForSession('session-1', { force: true }) })
  expect(result.current.askAi.source).toEqual({ kind: 'loading' })
  await act(async () => { await handle.send() })
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(handle.snapshot().composer).toBe('Retain this source question')
  await act(async () => { gate.resolve([]); await loading.catch(() => undefined) })
  expect(result.current.askAi.source?.kind).toBe('error')
  expect(result.current.findings[0].id).toBe('finding-1')
  expect(result.current.askAi.panel?.owner.record).toEqual({ kind: 'finding', recordId: 'finding-1' })
  api.listFindings.mockResolvedValueOnce([])
  await act(async () => { await result.current.loadFindingsForSession('session-1', { force: true }) })
  expect(result.current.askAi.source).toEqual({ kind: 'unavailable' })
  expect(handle.snapshot().composer).toBe('Retain this source question')
  act(() => result.current.askAi.onSelectRecord(null))
  let opening!: Promise<void>
  act(() => { opening = result.current.askAi.openConversation(handle.reference); result.current.askAi.onSelectRecord(null); result.current.askAi.onSelectRecord(null) })
  await act(async () => { await opening })
  expect(result.current.askAi.visible).toBe(true)
  expect(result.current.askAi.reference).toEqual(handle.reference)
  expect(result.current.recordChat.composer).toBe('Retain this source question')
})
it('view A B A navigation intent invalidates a delayed begin even when the final view matches', async () => {
  const { result, handle } = await open()
  await act(async () => { await result.current.askAi.close() })
  const gate = deferred<import('../bindings').ChatState>()
  api.beginRecordChat.mockReturnValueOnce(gate.promise)
  let opening!: Promise<void>
  act(() => { opening = result.current.askAi.onAskAi(target) })
  await waitFor(() => expect(api.beginRecordChat).toHaveBeenCalledTimes(2))
  act(() => { result.current.setActiveView('sessions'); result.current.setActiveView('findings') })
  const request = api.beginRecordChat.mock.calls[1][0] as import('../bindings').BeginRecordChatRequest
  const row = { ...handle.snapshot().chat!, ...request, composer: '', owner: { kind: 'record' as const, sessionId: request.sessionId, record: request.record } }
  api.getConversation.mockResolvedValue(row)
  await act(async () => { gate.resolve(row); await opening })
  expect(result.current.askAi.panel?.phase).not.toBe('ready')
  expect(result.current.askAi.reference?.draftId).not.toBe(request.draftId)
  expect(api.startChatJob).not.toHaveBeenCalled()
})
