import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { StartChatJobRequest, StartChatJobResult } from '../bindings'
import { draftFixture, findingFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
beforeEach(() => {
  setupControllerTest()
  api.listFindings.mockResolvedValue([findingFixture()])
  api.listDrafts.mockResolvedValue([draftFixture()])
})
afterEach(cleanupControllerTest)

async function open(view: 'findings' | 'testware' = 'findings') {
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.sessionChat.chat?.sessionId).toBe('session-1'))
  await act(async () => { hook.result.current.setActiveView(view) })
  await waitFor(() => expect(view === 'findings' ? hook.result.current.findings.length : hook.result.current.testwareDrafts.length).toBe(1))
  act(() => hook.result.current.askAi.onAskAi({ kind: view === 'findings' ? 'finding' : 'test_cases_draft', recordId: view === 'findings' ? 'finding-1' : 'draft-1', title: 'Selected record', unsaved: false }))
  return hook
}

it('captures the latest unsaved editor at Send before an awaited composer save and retains the dirty record', async () => {
  const { result } = await open()
  act(() => {
    result.current.updateLocalFinding('finding-1', { title: 'Edited title at Send', ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Unsaved evidence at Send')) })
    result.current.sessionChat.onSetComposer('Review this evidence')
  })
  const saving = deferred<ReturnType<typeof chatFixture>>()
  api.saveChatComposer.mockReturnValueOnce(saving.promise)
  const starting = deferred<StartChatJobResult>()
  api.startChatJob.mockReturnValueOnce(starting.promise)
  let sending!: Promise<void>
  act(() => { sending = result.current.sessionChat.onSend() })
  act(() => {
    result.current.updateLocalFinding('finding-1', { title: 'New edit after Send' })
    result.current.askAi.detach()
  })
  await act(async () => { saving.resolve(chatFixture({ draftId: 'chat-session-1', composer: 'Review this evidence', mode: 'chat', revision: 1 })) })
  const request = api.startChatJob.mock.calls[0][0] as StartChatJobRequest
  expect(request.context?.kind).toBe('finding')
  if (request.context?.kind !== 'finding') throw new Error('Missing finding snapshot')
  expect(request.context.snapshot.title).toBe('Edited title at Send')
  expect(JSON.parse(request.context.snapshot.documentJson)).toEqual({ schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsaved evidence at Send' }] }] } })
  expect(request.context.snapshot.origin).toBe('unsaved_editor')
  expect(result.current.findings[0].title).toBe('New edit after Send')
  expect(api.updateFinding).not.toHaveBeenCalled()
  await act(async () => { starting.resolve({ jobId: 'job-chat', turnId: 'attempt-1', status: chatJobFixture({ chat: { reference: { sessionId: 'session-1', draftId: 'chat-session-1' } } }), chat: chatFixture({ draftId: 'chat-session-1', revision: 2, mode: 'chat' }) }); await sending })
})

it('uses the existing conversation and composer through panel close, open, expand and record switches', async () => {
  const { result } = await open()
  act(() => result.current.sessionChat.onSetComposer('Keep the shared composer'))
  const id = result.current.sessionChat.chat?.draftId
  act(() => result.current.askAi.close())
  expect(result.current.askAi.visible).toBe(false)
  expect(result.current.sessionChat.composer).toBe('Keep the shared composer')
  act(() => result.current.askAi.onAskAi({ kind: 'finding', recordId: 'finding-1', title: 'Finding', unsaved: false }))
  act(() => result.current.askAi.toggleExpanded())
  expect(result.current.askAi.expanded).toBe(true)
  act(() => result.current.askAi.onSelectRecord({ kind: 'test_cases_draft', recordId: 'draft-1', title: 'Test cases', unsaved: false }))
  expect(result.current.sessionChat.chat?.draftId).toBe(id)
  expect(result.current.sessionChat.composer).toBe('Keep the shared composer')
  expect(result.current.askAi.context.kind).toBe('test_cases_draft')
})

it('detaches only future sends and Notes always captures Session context', async () => {
  const { result } = await open()
  const original = result.current.askAi.capture('session-1')
  act(() => result.current.askAi.detach())
  expect(result.current.askAi.capture('session-1')).toEqual({ kind: 'session' })
  expect(original.kind).toBe('finding')
  act(() => result.current.askAi.onAskAi({ kind: 'finding', recordId: 'finding-1', title: 'Finding', unsaved: false }))
  await act(async () => { result.current.setActiveView('sessions') })
  expect(result.current.askAi.capture('session-1')).toEqual({ kind: 'session' })
  expect(result.current.askAi.context).toEqual({ kind: 'session' })
  expect(result.current.askAi.contextError).toBe(null)
})

it('maps only Testware drafts to Test cases context and rejects missing or foreign targets', async () => {
  const { result } = await open('testware')
  const target = result.current.askAi.capture('session-1')
  expect(target.kind).toBe('test_cases_draft')
  if (target.kind !== 'test_cases_draft') throw new Error('Missing Test cases snapshot')
  expect(target.snapshot.recordId).toBe('draft-1')
  expect(target.snapshot.recordKind).toBe('testware')
  expect(target.snapshot.origin).toBe('saved')
  expect(() => result.current.askAi.capture('another-session')).toThrow('active Session changed')
  act(() => result.current.askAi.onAskAi({ kind: 'finding', recordId: 'missing', title: 'Deleted record', unsaved: false }))
  expect(() => result.current.askAi.capture('session-1')).toThrow('no longer available')
})

it('Retry sends no new record context even when the selected record changes', async () => {
  const { result } = await open()
  const context = result.current.askAi.capture('session-1')
  const failed = chatFixture({ draftId: 'chat-session-1', mode: 'chat', revision: 2, messages: [{ id: 'original-user', turnId: 'old-attempt', role: 'user', text: 'Original question', images: [], context,
    status: 'interrupted', errorMessage: 'App stopped', aiRunId: null, createdAt: '' }] })
  api.getChat.mockResolvedValue(failed)
  await act(async () => { await result.current.sessionChat.onRecheck?.() })
  act(() => result.current.askAi.detach())
  api.startChatJob.mockImplementation(async () => ({ jobId: 'job-chat', turnId: 'new-attempt', status: chatJobFixture({ chat: { reference: { sessionId: 'session-1', draftId: 'chat-session-1' } } }), chat: { ...failed, revision: 3,
    messages: [{ ...failed.messages[0], turnId: 'new-attempt', status: 'running' }] } }))
  await act(async () => { await result.current.sessionChat.onRetry() })
  expect(api.startChatJob.mock.calls[0][0]).toMatchObject({ intent: { kind: 'retry' } })
  expect((api.startChatJob.mock.calls[0][0] as StartChatJobRequest).context).toBeUndefined()
  expect(result.current.sessionChat.chat?.messages[0].context).toEqual(context)
  expect(result.current.sessionChat.chat?.messages[0].id).toBe('original-user')
})

it('submitted chat remains visibly submitted when Ask AI opens and does not silently reset history', async () => {
  const { result } = await open()
  api.getChat.mockResolvedValue(chatFixture({ draftId: 'chat-session-1', submission: { draftId: 'chat-session-1', noteId: 'entry-1', submittedAt: '2026-10-24' } }))
  await act(async () => { await result.current.sessionChat.onRecheck?.() })
  act(() => result.current.askAi.onAskAi({ kind: 'finding', recordId: 'finding-1', title: 'Finding', unsaved: false }))
  expect(result.current.sessionChat.chat?.submission?.noteId).toBe('entry-1')
  expect(result.current.askAi.visible).toBe(true)
  expect(api.restartChat).not.toHaveBeenCalled()
})
