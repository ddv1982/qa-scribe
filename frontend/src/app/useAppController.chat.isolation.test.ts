import { entryFixture } from '../test/fixtures'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { ChatComposerRequest, ChatRef, ChatState } from '../bindings'
import { chatFixture, chatJobFixture, completedChatFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, sessionNoteStateFixture, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
const A = { sessionId: 'session-1', draftId: 'A' }
const B = { sessionId: 'session-1', draftId: 'B' }
let rows: Map<string, ChatState>
beforeEach(() => {
  setupControllerTest()
  rows = new Map([A, B].map(reference => [reference.draftId, chatFixture({ ...reference, mode: 'chat', owner: { kind: 'record', sessionId: reference.sessionId, record: { kind: 'finding', recordId: `source-${reference.draftId}` } } })]))
  api.getConversation.mockImplementation(async (reference: ChatRef) => {
    const row = rows.get(reference.draftId)
    if (!row || row.sessionId !== reference.sessionId) throw new Error('Exact row missing')
    return row
  })
  api.saveChatComposer.mockImplementation(async (request: ChatComposerRequest) => {
    const row = rows.get(request.scope.draftId)!
    const saved = { ...row, revision: request.scope.expectedRevision + 1, composer: request.composer, composerIntent: request.intent ?? { kind: 'message' as const }, composerImages: row.composerImages.filter(image => (request.attachmentIds ?? []).includes(image.attachmentId)), mode: request.mode }
    rows.set(saved.draftId, saved); return saved
  })
})
afterEach(cleanupControllerTest)

async function open() {
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.sessionChat.chat?.owner.kind).toBe('notes'))
  const a = hook.result.current.conversations.bind(A)
  const b = hook.result.current.conversations.bind(B)
  await act(async () => { await Promise.all([a.refresh(), b.refresh()]) })
  return { ...hook, a, b }
}
it('late hidden autosave preserves literal per-draft input and the visible Notes input', async () => {
  const { result, a, b } = await open()
  const gate = deferred<ChatState>()
  api.saveChatComposer.mockReturnValueOnce(gate.promise)
  a.setComposer('A retained text'); a.setIntent({ kind: 'refine_record' })
  const pending = a.flush()
  b.setComposer('B Jira text'); b.setIntent({ kind: 'draft_jira' })
  await act(async () => { gate.resolve({ ...rows.get('A')!, revision: 1, composer: 'A retained text', composerIntent: { kind: 'refine_record' } }); await pending; await b.flush() })
  expect(a.snapshot().composer).toBe('A retained text')
  expect(a.snapshot().composerIntent).toEqual({ kind: 'refine_record' })
  expect(b.snapshot().composer).toBe('B Jira text')
  expect(rows.get('B')?.composerIntent).toEqual({ kind: 'draft_jira' })
  expect(result.current.sessionChat.chat?.draftId).toBe('chat-session-1')
  expect(result.current.sessionChat.composer).toBe('')
})
it('same Session terminal events refresh only their draft', async () => {
  const { result, a, b } = await open()
  const status = chatJobFixture({ chat: { reference: A }, aiRunId: null, state: 'starting' })
  act(() => result.current.conversations.observeJob(status))
  api.getConversation.mockClear()
  rows.set('A', { ...rows.get('A')!, revision: 1, composer: 'A completed input' })
  await act(async () => { result.current.conversations.observeJob({ ...status, state: 'completed' }); await Promise.resolve() })
  expect(a.snapshot().chat?.composer).toBe('A completed input')
  expect(b.snapshot().chat?.composer).toBe('')
  expect(result.current.sessionChat.composer).toBe('')
  expect(api.getConversation).toHaveBeenCalledExactlyOnceWith(A)
})
it('saved starter intent survives text clearing and changes only through explicit Message reset', async () => {
  const { a } = await open()
  await act(async () => { expect(await a.prepareComposer({ kind: 'draft_jira' }, 'Draft editable Jira content')).toBe(true) })
  a.setComposer('')
  await a.flush()
  expect(rows.get('A')?.composer).toBe('')
  expect(rows.get('A')?.composerIntent).toEqual({ kind: 'draft_jira' })
  a.setIntent({ kind: 'message' }); await a.flush()
  expect(rows.get('A')?.composerIntent).toEqual({ kind: 'message' })
})
it('prepared actions refuse occupied input without replacing it', async () => {
  const { a } = await open()
  a.setComposer('My unsaved question')
  await expect(a.prepareComposer({ kind: 'refine_record' }, 'Starter')).rejects.toThrow('existing input')
  expect(a.snapshot().composer).toBe('My unsaved question')
  expect(a.snapshot().composerIntent).toEqual({ kind: 'message' })
})
it('retirement ignores every descendant hydration and save callback', async () => {
  const { result, a, b } = await open()
  const gate = deferred<ChatState>()
  api.saveChatComposer.mockReturnValueOnce(gate.promise)
  a.setComposer('A unsaved'); const save = a.flush()
  const before = b.snapshot()
  result.current.conversations.retire('session-1')
  await act(async () => { gate.resolve({ ...rows.get('A')!, composer: 'Foreign late text', revision: 2 }); await save })
  expect(a.snapshot().composer).toBe('A unsaved')
  expect(b.snapshot()).toBe(before)
  expect(result.current.conversations.attention('session-1')).toEqual([])
})

it('a hidden image import preserves newer text and B input intent', async () => {
  const { result, a, b } = await open()
  a.setComposer('A before import'); a.setIntent({ kind: 'refine_record' }); await a.flush()
  const gate = deferred<ChatState>()
  api.importChatImage.mockReturnValueOnce(gate.promise)
  const importing = a.attachImages([new File(['owned image'], 'A.png', { type: 'image/png' })])
  await waitFor(() => expect(api.importChatImage).toHaveBeenCalledOnce())
  a.setComposer('A newer text')
  b.setComposer('B preserved text'); b.setIntent({ kind: 'draft_jira' }); await b.flush()
  const image = { attachmentId: 'A-image', filename: 'A.png', mimeType: 'image/png', sizeBytes: 11 }
  await act(async () => { gate.resolve({ ...rows.get('A')!, revision: 2, composerImages: [image] }); await importing })
  expect(a.snapshot().composer).toBe('A newer text')
  expect(a.snapshot().composerIntent).toEqual({ kind: 'refine_record' })
  expect(a.snapshot().composerImages).toEqual([image])
  expect(b.snapshot().composer).toBe('B preserved text')
  expect(b.snapshot().composerIntent).toEqual({ kind: 'draft_jira' })
  expect(b.snapshot().composerImages).toEqual([])
  expect(result.current.sessionChat.composerImages).toEqual([])
})

it('a captured Notes submission cannot block or overwrite a selected Record workspace', async () => {
  const noteChat = completedChatFixture({ draftId: 'chat-session-1', mode: 'chat' })
  api.getChat.mockResolvedValue(noteChat); rows.set(noteChat.draftId, noteChat)
  const { result, b } = await open()
  const handle = result.current.conversations.bind({ sessionId: noteChat.sessionId, draftId: noteChat.draftId })
  const gate = deferred<import('../bindings').ChatSubmissionReceipt>()
  api.submitChat.mockReturnValueOnce(gate.promise)
  let submitting!: Promise<void>
  act(() => { submitting = handle.submit() })
  await waitFor(() => expect(api.submitChat).toHaveBeenCalledOnce())
  b.setComposer('B work during Notes submission'); b.setIntent({ kind: 'draft_jira' })
  await act(async () => { await b.flush(); await result.current.conversations.select(B) })
  const receipt = { draftId: noteChat.draftId, noteId: 'entry-1', submittedAt: 'submitted' }
  rows.set(noteChat.draftId, { ...noteChat, revision: 4, submission: receipt, mode: 'write_note' })
  const canonical = entryFixture({ body: '<p>Literal canonical Notes transcript</p>', bodyJson: null, bodyFormat: 'html' })
  api.openSessionNoteState.mockResolvedValue(sessionNoteStateFixture({ noteEntry: canonical }))
  await act(async () => { gate.resolve(receipt); await submitting })
  expect(handle.snapshot().chat?.submission).toEqual(receipt)
  expect(result.current.sessionChat.chat?.draftId).toBe('B')
  expect(result.current.sessionChat.composer).toBe('B work during Notes submission')
  expect(b.snapshot().composerIntent).toEqual({ kind: 'draft_jira' })
  expect(rows.get('B')?.submission).toBeNull()
  expect(result.current.noteEntry?.body).toBe('<p>Literal canonical Notes transcript</p>')
  expect(api.submitChat.mock.calls[0][0]).toMatchObject({ scope: { sessionId: noteChat.sessionId, draftId: noteChat.draftId } })
})
