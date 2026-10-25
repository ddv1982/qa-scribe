import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { ChatComposerRequest, ChatMessage, ChatState, ChatTarget, StartChatJobRequest } from '../bindings'
import { findingFixture } from '../test/fixtures'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'
import { actionRequestText } from './sessionChat.questions'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
const target: ChatTarget = { kind: 'finding', snapshot: { sessionId: 'session-1', recordId: 'finding-1', title: 'Original source', documentJson: '{"schemaVersion":1,"doc":{"type":"doc","content":[]}}', metadataJson: null, recordKind: 'bug', origin: 'saved', localFingerprint: 'local', storedBaseToken: 'stored' } }
const user: ChatMessage = { id: 'source-user', turnId: 'turn-1', role: 'user', text: 'Draft Jira', images: [], context: target, status: 'completed', errorMessage: null, aiRunId: null, createdAt: '2026-10-25' }
const response: ChatMessage = { ...user, id: 'assistant-question', role: 'assistant', text: 'Draft content first.', context: { kind: 'session' }, response: { sourceUserMessageId: user.id, purpose: { kind: 'jira_drafting' }, question: { prompt: 'Which type?', choices: ['Finding subtask', 'Bug'] }, warning: null } }
let saved: ChatState
beforeEach(() => {
  setupControllerTest()
  api.listFindings.mockResolvedValue([findingFixture()])
  saved = chatFixture({ draftId: 'chat-session-1', mode: 'chat', messages: [user, response] })
  api.getChat.mockImplementation(async () => saved)
  api.saveChatComposer.mockImplementation(async (request: ChatComposerRequest) => {
    saved = { ...saved, revision: request.scope.expectedRevision + 1, composer: request.composer }
    return saved
  })
  api.startChatJob.mockImplementation(async (request: StartChatJobRequest) => ({ jobId: 'job-chat', turnId: 'turn-2', status: chatJobFixture(), chat: { ...saved, composer: '', revision: saved.revision + 1, messages: [...saved.messages, { ...user, id: 'reply', turnId: 'turn-2', status: 'running', text: request.intent.kind === 'question_reply' ? request.intent.text : saved.composer }] } }))
})
afterEach(cleanupControllerTest)
async function open() {
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.sessionChat.chat?.messages).toHaveLength(2))
  await act(async () => { hook.result.current.setActiveView('findings') })
  await waitFor(() => expect(hook.result.current.findings).toHaveLength(1))
  act(() => hook.result.current.askAi.onAskAi({ kind: 'finding', recordId: 'finding-1', title: 'Source', unsaved: false }))
  return hook
}
it('sends a choice as the entire visible text through the typed shared request', async () => {
  const { result } = await open()
  await act(async () => { await result.current.sessionChat.onAnswerQuestion?.(response.id, 'Finding subtask') })
  expect((api.startChatJob.mock.calls[0][0] as StartChatJobRequest).intent).toEqual({ kind: 'question_reply', assistantMessageId: response.id, text: 'Finding subtask' })
  expect(result.current.sessionChat.chat?.messages.at(-1)?.text).toBe('Finding subtask')
  expect(result.current.sessionChat.composer).toBe('')
})
it.each(['My unsent question', ' '])('retains occupied composer %j without starting a choice', async text => {
  const { result } = await open()
  act(() => result.current.sessionChat.onSetComposer(text))
  await act(async () => { await result.current.sessionChat.onAnswerQuestion?.(response.id, 'Bug') })
  expect(result.current.sessionChat.composer).toBe(text)
  expect(result.current.sessionChat.error).toContain('retained')
  expect(api.startChatJob).not.toHaveBeenCalled()
})
it('retains newer input typed during save and refuses the direct choice', async () => {
  const { result } = await open()
  const saving = deferred<ChatState>()
  api.saveChatComposer.mockReturnValueOnce(saving.promise)
  let pending!: Promise<void>
  act(() => { pending = result.current.sessionChat.onAnswerQuestion!(response.id, 'Bug') })
  act(() => result.current.sessionChat.onSetComposer('Newer typed message'))
  await act(async () => { saving.resolve({ ...saved, revision: 1 }); await pending })
  expect(result.current.sessionChat.composer).toBe('Newer typed message')
  expect(api.startChatJob).not.toHaveBeenCalled()
})
it('refuses mismatched choices but ordinary matching text still sends current Session context', async () => {
  const { result } = await open()
  act(() => result.current.askAi.detach())
  await act(async () => { await result.current.sessionChat.onAnswerQuestion?.(response.id, 'Bug') })
  expect(api.startChatJob).not.toHaveBeenCalled()
  act(() => result.current.sessionChat.onSetComposer('Bug'))
  await act(async () => { await result.current.sessionChat.onSend() })
  expect(api.startChatJob.mock.calls[0][0]).toMatchObject({ intent: { kind: 'message' }, context: { kind: 'session' } })
  expect(result.current.sessionChat.chat?.messages.at(-1)?.text).toBe('Bug')
})
it('prepares an editable action request without starting a job and sends the user edit normally', async () => {
  saved = { ...saved, messages: [user, { ...response, response: { ...response.response!, question: null } }] }
  const { result } = await open()
  await act(async () => { await result.current.sessionChat.onPrepareAction?.(response.id) })
  expect(result.current.sessionChat.composer).toBe(actionRequestText)
  expect(saved.composer).toBe(actionRequestText)
  expect(api.startChatJob).not.toHaveBeenCalled()
  act(() => result.current.sessionChat.onSetComposer('Create the reviewed subtask, but ask before uploading evidence.'))
  await act(async () => { await result.current.sessionChat.onSend() })
  expect((api.startChatJob.mock.calls[0][0] as StartChatJobRequest).intent).toEqual({ kind: 'message' })
  expect(result.current.sessionChat.chat?.messages.at(-1)?.text).toBe('Create the reviewed subtask, but ask before uploading evidence.')
})
it('blocks choices during image ingestion and retains the resulting image', async () => {
  const { result } = await open()
  const importing = deferred<ChatState>()
  api.importChatImage.mockReturnValueOnce(importing.promise)
  let attaching!: Promise<void>
  act(() => { attaching = result.current.sessionChat.onAttachImages([new File(['pixels'], 'shot.png', { type: 'image/png' })]) })
  await waitFor(() => expect(api.importChatImage).toHaveBeenCalledOnce())
  await act(async () => { await result.current.sessionChat.onAnswerQuestion?.(response.id, 'Bug') })
  expect(api.startChatJob).not.toHaveBeenCalled()
  await act(async () => { importing.resolve({ ...saved, revision: 1, composerImages: [{ attachmentId: 'image-1', filename: 'shot.png', mimeType: 'image/png', sizeBytes: 6 }] }); await attaching })
  expect(result.current.sessionChat.composerImages.map(image => image.attachmentId)).toEqual(['image-1'])
  await act(async () => { await result.current.sessionChat.onAnswerQuestion?.(response.id, 'Bug') })
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(result.current.sessionChat.composerImages.map(image => image.attachmentId)).toEqual(['image-1'])
})
it('retains an image failure and refuses a direct choice until the user resolves it', async () => {
  const { result } = await open()
  api.importChatImage.mockRejectedValueOnce(new Error('Synthetic image failure'))
  await act(async () => { await result.current.sessionChat.onAttachImages([new File(['pixels'], 'shot.png', { type: 'image/png' })]) })
  expect(result.current.sessionChat.imageFailures).toHaveLength(1)
  await act(async () => { await result.current.sessionChat.onAnswerQuestion?.(response.id, 'Bug') })
  expect(api.startChatJob).not.toHaveBeenCalled()
  expect(result.current.sessionChat.imageFailures[0].message).toBe('Something went wrong: The conversation could not be refreshed. Retry before resolving the failed image.')
})
