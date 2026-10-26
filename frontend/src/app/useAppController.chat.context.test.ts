import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { ChatState, StartChatJobRequest, StartChatJobResult } from '../bindings'
import { draftFixture, findingFixture } from '../test/fixtures'
import { richEditorDocumentFromPlainText, richEditorDocumentToStoredBody } from '../editor/editorDocument'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
const finding = { kind: 'finding', recordId: 'finding-1', title: 'Selected finding', unsaved: false } as const
beforeEach(() => { setupControllerTest(); api.listFindings.mockResolvedValue([findingFixture()]); api.listDrafts.mockResolvedValue([draftFixture()]) })
afterEach(cleanupControllerTest)
async function open(view: 'findings' | 'testware' = 'findings') {
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.sessionChat.chat?.sessionId).toBe('session-1'))
  await act(async () => { hook.result.current.setActiveView(view) })
  await waitFor(() => expect(view === 'findings' ? hook.result.current.findings.length : hook.result.current.testwareDrafts.length).toBe(1))
  const target = view === 'findings' ? finding : { ...finding, kind: 'test_cases_draft' as const, recordId: 'draft-1' }
  act(() => hook.result.current.askAi.onSelectRecord(target))
  await act(async () => { await hook.result.current.askAi.onAskAi(target) })
  return hook
}
function bound(controller: ReturnType<typeof useAppController>) {
  if (!controller.askAi.reference) throw new Error('No record conversation')
  return controller.conversations.bind(controller.askAi.reference)
}

it('explicit launch isolates Notes input images and submission from the fresh record conversation', async () => {
  api.getChat.mockResolvedValue(chatFixture({ draftId: 'chat-session-1', composer: 'Notes only. 雪', composerImages: [{ attachmentId: 'notes-image', filename: 'note.png', mimeType: 'image/png', sizeBytes: 77 }], submission: { draftId: 'chat-session-1', noteId: 'entry-1', submittedAt: '2026-10-24' } }))
  const { result } = await open()
  expect(result.current.recordChat.chat?.owner).toEqual({ kind: 'record', sessionId: 'session-1', record: { kind: 'finding', recordId: 'finding-1' } })
  expect(result.current.recordChat.chat?.messages).toEqual([])
  expect(result.current.recordChat.composer).toBe('')
  expect(result.current.recordChat.composerImages).toEqual([])
  expect(result.current.recordChat.chat?.submission).toBe(null)
  expect(result.current.sessionChat.composer).toBe('Notes only. 雪')
  expect(result.current.sessionChat.composerImages.map(image => image.attachmentId)).toEqual(['notes-image'])
  expect(result.current.sessionChat.chat?.submission?.noteId).toBe('entry-1')
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(api.restartChat).not.toHaveBeenCalled()
})
it('captures the exact unsaved record at Send before awaiting input durability', async () => {
  const { result } = await open()
  const handle = bound(result.current)
  act(() => {
    result.current.updateLocalFinding('finding-1', { title: 'Edited title at Send', ...richEditorDocumentToStoredBody(richEditorDocumentFromPlainText('Unsaved evidence at Send')) })
    handle.setComposer('Review this evidence')
  })
  const saving = deferred<ChatState>(); api.saveChatComposer.mockReturnValueOnce(saving.promise)
  const starting = deferred<StartChatJobResult>(); api.startChatJob.mockReturnValueOnce(starting.promise)
  let sending!: Promise<void>
  act(() => { sending = handle.send() })
  act(() => { result.current.updateLocalFinding('finding-1', { title: 'New edit after Send' }); void result.current.askAi.close() })
  await act(async () => { saving.resolve({ ...handle.snapshot().chat!, composer: 'Review this evidence', revision: 1 }) })
  const request = api.startChatJob.mock.calls[0][0] as StartChatJobRequest
  expect(request.context?.kind).toBe('finding')
  if (request.context?.kind !== 'finding') throw new Error('Missing finding snapshot')
  expect(request.context.snapshot.title).toBe('Edited title at Send')
  expect(JSON.parse(request.context.snapshot.documentJson)).toEqual({ schemaVersion: 1, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unsaved evidence at Send' }] }] } })
  expect(request.context.snapshot.origin).toBe('unsaved_editor')
  expect(result.current.findings[0].title).toBe('New edit after Send')
  expect(api.updateFinding).not.toHaveBeenCalled()
  await act(async () => { starting.resolve({ jobId: 'job-chat', turnId: 'attempt-1', status: chatJobFixture({ chat: { reference: handle.reference } }), chat: { ...handle.snapshot().chat!, revision: 2 } }); await sending })
})
it('reclicks the open composer without replacing literal text or images', async () => {
  const { result } = await open()
  const original = result.current.askAi.reference
  const handle = bound(result.current)
  act(() => handle.setComposer('Literal open input. 雪'))
  const image = { attachmentId: 'attached', filename: 'synthetic.png', mimeType: 'image/png', sizeBytes: 10 }
  api.importChatImage.mockResolvedValueOnce({ ...handle.snapshot().chat!, revision: 1, composer: 'Literal open input. 雪', composerImages: [image] })
  await act(async () => { await handle.attachImages([new File(['synthetic'], 'synthetic.png', { type: 'image/png' })]) })
  await act(async () => { await Promise.all([result.current.askAi.onAskAi(finding), result.current.askAi.onAskAi(finding)]) })
  expect(result.current.askAi.reference).toEqual(original)
  expect(result.current.recordChat.composer).toBe('Literal open input. 雪')
  expect(result.current.recordChat.composerImages).toEqual([image])
  expect(api.beginRecordChat).toHaveBeenCalledTimes(1)
  expect(api.startChatJob).not.toHaveBeenCalled()
})
it('retains an unknown begin UUID through explicit retry', async () => {
  const { result } = await open()
  await act(async () => { await result.current.askAi.close() })
  api.beginRecordChat.mockRejectedValueOnce(new Error('Lost begin response'))
  await act(async () => { await result.current.askAi.onAskAi(finding) })
  const request = api.beginRecordChat.mock.calls.at(-1)![0]
  expect(result.current.askAi.panel?.phase).toBe('error')
  await act(async () => { await result.current.askAi.onAskAi(finding) })
  expect(api.beginRecordChat.mock.calls.at(-1)![0]).toEqual(request)
  expect(result.current.recordChat.composer).toBe('')
  expect(result.current.sessionChat.composer).toBe('')
})
it('settled close persists literal input and reopen starts fresh without deleting the old row', async () => {
  const { result } = await open()
  const previous = bound(result.current)
  act(() => previous.setComposer('Earlier saved work. 雪'))
  await act(async () => { await result.current.askAi.close() })
  expect(result.current.askAi.visible).toBe(false)
  expect(previous.snapshot().chat?.composer).toBe('Earlier saved work. 雪')
  await act(async () => { await result.current.askAi.onAskAi(finding) })
  expect(result.current.askAi.reference?.draftId).not.toBe(previous.reference.draftId)
  expect(result.current.recordChat.composer).toBe('')
  expect(previous.snapshot().chat?.composer).toBe('Earlier saved work. 雪')
  expect(api.startChatJob).not.toHaveBeenCalled()
})
it('failed close retains the visible panel and literal composer', async () => {
  const { result } = await open()
  const previous = bound(result.current)
  act(() => previous.setComposer('Do not lose this input.'))
  api.saveChatComposer.mockRejectedValue(new Error('Disk unavailable'))
  await act(async () => { await result.current.askAi.close() })
  expect(result.current.askAi.visible).toBe(true)
  expect(result.current.askAi.reference).toEqual(previous.reference)
  expect(result.current.recordChat.composer).toBe('Do not lose this input.')
  expect(result.current.recordChat.error).toBe('Something went wrong: Disk unavailable')
  expect(api.beginRecordChat).toHaveBeenCalledTimes(1)
})
it('record browsing and filtering hide without retargeting and Notes always captures Session context', async () => {
  const { result } = await open()
  const handle = bound(result.current)
  act(() => { handle.setComposer('Finding-only question'); result.current.askAi.onSelectRecord(null) })
  expect(result.current.askAi.visible).toBe(false)
  expect(result.current.askAi.context.kind).toBe('finding')
  expect(handle.snapshot().composer).toBe('Finding-only question')
  expect(result.current.askAi.capture('session-1', { kind: 'notes', sessionId: 'session-1' })).toEqual({ kind: 'session' })
  expect(() => result.current.askAi.capture('foreign', handle.snapshot().chat?.owner)).toThrow('active Session changed')
})
it('a late launch after an actual A B A switch stays hidden', async () => {
  const { result } = await open()
  await act(async () => { await result.current.askAi.close() })
  const creation = deferred<ChatState>(); api.beginRecordChat.mockReturnValueOnce(creation.promise)
  let opening!: Promise<void>
  act(() => { opening = result.current.askAi.onAskAi(finding) })
  await waitFor(() => expect(api.beginRecordChat).toHaveBeenCalledTimes(2))
  const request = api.beginRecordChat.mock.calls[1][0] as import('../bindings').BeginRecordChatRequest
  act(() => { result.current.askAi.onSelectRecord({ ...finding, recordId: 'finding-B' }); result.current.askAi.onSelectRecord(finding) })
  api.getConversation.mockResolvedValue(chatFixture({ ...request, owner: { kind: 'record', sessionId: request.sessionId, record: request.record } }))
  await act(async () => { creation.resolve(chatFixture({ ...request, owner: { kind: 'record', sessionId: request.sessionId, record: request.record } })); await opening })
  expect(result.current.askAi.visible).toBe(false)
  expect(api.startChatJob).not.toHaveBeenCalled()
})
it('Test cases fresh capture rejects unavailable sources without falling back', async () => {
  const { result } = await open('testware')
  const owner = bound(result.current).snapshot().chat!.owner
  const target = result.current.askAi.capture('session-1', owner)
  expect(target.kind).toBe('test_cases_draft')
  if (target.kind !== 'test_cases_draft') throw new Error('Wrong source')
  expect(target.snapshot.recordId).toBe('draft-1')
  expect(() => result.current.askAi.capture('session-1', { kind: 'record', sessionId: 'session-1', record: { kind: 'finding', recordId: 'missing' } })).toThrow('no longer available')
})

it('an unknown begin after closing an empty starter is replayed instead of focusing that earlier empty row', async () => {
  const { result } = await open()
  const original = result.current.askAi.reference
  await act(async () => { await result.current.askAi.close() })
  api.beginRecordChat.mockRejectedValueOnce(new Error('Unknown empty launch'))
  await act(async () => { await result.current.askAi.onAskAi(finding) })
  const request = api.beginRecordChat.mock.calls.at(-1)![0] as import('../bindings').BeginRecordChatRequest
  await act(async () => { await result.current.askAi.onAskAi(finding) })
  expect(api.beginRecordChat.mock.calls.at(-1)![0]).toEqual(request)
  expect(result.current.askAi.reference?.draftId).toBe(request.draftId)
  expect(result.current.askAi.reference?.draftId).not.toBe(original?.draftId)
  expect(result.current.recordChat.composer).toBe('')
  expect(api.startChatJob).not.toHaveBeenCalled()
})
