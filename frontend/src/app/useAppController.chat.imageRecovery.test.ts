import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
const existing = { attachmentId: 'image-a', filename: 'existing.png', mimeType: 'image/png', sizeBytes: 100 }
const uncertain = { ...existing, attachmentId: 'image-b', filename: 'uncertain.png' }
const later = { ...existing, attachmentId: 'image-c', filename: 'later.png' }
const initial = () => chatFixture({ mode: 'chat', composer: 'Question', composerImages: [existing] })
const committed = () => ({ ...initial(), revision: 1, composerImages: [existing, uncertain] })
const file = () => new File(['pixels'], 'uncertain.png', { type: 'image/png' })

async function failedImport() {
  api.getChat.mockResolvedValueOnce(initial()).mockResolvedValue(committed())
  api.importChatImage.mockRejectedValue(new Error('Import response lost'))
  api.getAttachmentPreviewDataUrl.mockRejectedValue(new Error('Preview unavailable'))
  const hook = renderHook(() => useAppController())
  await waitFor(() => expect(hook.result.current.sessionChat.composerImages).toEqual([existing]))
  await act(async () => { await hook.result.current.sessionChat.onAttachImages([file()]) })
  expect(hook.result.current.sessionChat.imageFailures[0].recovery).toEqual({ kind: 'verification_pending', images: [uncertain] })
  return hook
}

describe('uncertain image recovery', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('persists deliberate thumbnail removal before clearing the failed operation without previews', async () => {
    const { result } = await failedImport()
    const failureId = result.current.sessionChat.imageFailures[0].id
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(failureId) })
    await act(async () => { await result.current.sessionChat.onRetryImage(failureId) })
    await act(async () => { await result.current.sessionChat.onSend() })
    expect(result.current.sessionChat.composerImages).toEqual([existing, uncertain])
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(api.importChatImage).toHaveBeenCalledOnce()
    act(() => {
      result.current.sessionChat.onSetComposer('New question 4827')
      result.current.sessionChat.onRemoveImage('image-b')
    })
    const saving = deferred<ReturnType<typeof committed>>()
    api.saveChatComposer.mockReturnValueOnce(saving.promise)
    let dismissing!: Promise<void>
    act(() => { dismissing = result.current.sessionChat.onDismissImageFailure(failureId) })
    await waitFor(() => expect(api.saveChatComposer).toHaveBeenCalledWith({
      scope: { sessionId: 'session-1', draftId: 'chat-1', expectedRevision: 1 },
      intent: { kind: 'message' }, composer: 'New question 4827', attachmentIds: ['image-a'], mode: 'chat',
    }))
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    await act(async () => {
      saving.resolve({ ...committed(), revision: 2, composer: 'New question 4827', composerImages: [existing] })
      await dismissing
    })
    expect(result.current.sessionChat.imageFailures).toEqual([])
    expect(result.current.sessionChat.composerImages).toEqual([existing])
    expect(result.current.sessionChat.composer).toBe('New question 4827')
    api.startChatJob.mockResolvedValue({ jobId: 'job-chat', turnId: 'turn-1', status: chatJobFixture(),
      chat: { ...committed(), revision: 3, composer: '', composerImages: [], messages: [{ id: 'message-1', turnId: 'turn-1',
        role: 'user', text: 'New question 4827', images: [existing], status: 'running', errorMessage: null, aiRunId: null, createdAt: 'now' }] } })
    await waitFor(() => expect(result.current.activeProvider?.available).toBe(true))
    await act(async () => { await result.current.sessionChat.onSend() })
    expect(result.current.sessionChat.chat?.messages[0]).toMatchObject({ text: 'New question 4827', images: [existing] })
    expect(api.importChatImage).toHaveBeenCalledOnce()
    expect(api.deleteAttachment).not.toHaveBeenCalled()
  })

  it('keeps recovery pending and performs no mutation while canonical reads fail', async () => {
    const { result } = await failedImport()
    const failureId = result.current.sessionChat.imageFailures[0].id
    act(() => result.current.sessionChat.onRemoveImage('image-b'))
    api.getChat.mockRejectedValue(new Error('Canonical unavailable'))
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(failureId) })
    await act(async () => { await result.current.sessionChat.onRetryImage(failureId) })
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    expect(result.current.sessionChat.imageFailures[0].recovery).toEqual({ kind: 'refresh_pending', images: [uncertain] })
    expect(result.current.sessionChat.composerImages).toEqual([existing])
    expect(api.saveChatComposer).not.toHaveBeenCalled()
    expect(api.importChatImage).toHaveBeenCalledOnce()
    expect(api.deleteAttachment).not.toHaveBeenCalled()
  })

  it('retains the import attempt when every initial recovery read fails and resolves it after reads return', async () => {
    api.getChat.mockResolvedValueOnce(initial()).mockRejectedValue(new Error('Canonical unavailable'))
    api.importChatImage.mockRejectedValue(new Error('Import response lost'))
    api.getAttachmentPreviewDataUrl.mockRejectedValue(new Error('Preview unavailable'))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composerImages).toEqual([existing]))
    await act(async () => { await result.current.sessionChat.onAttachImages([file()]) })
    const failureId = result.current.sessionChat.imageFailures[0].id
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(failureId) })
    await act(async () => { await result.current.sessionChat.onRetryImage(failureId) })
    expect(result.current.sessionChat.composerImages).toEqual([existing])
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    expect(api.importChatImage).toHaveBeenCalledOnce()
    expect(api.saveChatComposer).not.toHaveBeenCalled()
    api.getChat.mockResolvedValue(committed())
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(failureId) })
    expect(result.current.sessionChat.composerImages).toEqual([existing, uncertain])
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    act(() => result.current.sessionChat.onRemoveImage('image-b'))
    api.saveChatComposer.mockResolvedValue({ ...committed(), revision: 2, composerImages: [existing] })
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(failureId) })
    expect(result.current.sessionChat.imageFailures).toEqual([])
    expect(result.current.sessionChat.composerImages).toEqual([existing])
    expect(api.importChatImage).toHaveBeenCalledOnce()
  })

  it('keeps the operation pending if persisting deliberate removal fails', async () => {
    const { result } = await failedImport()
    const failureId = result.current.sessionChat.imageFailures[0].id
    act(() => result.current.sessionChat.onRemoveImage('image-b'))
    api.saveChatComposer.mockRejectedValue(new Error('Save unavailable'))
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(failureId) })
    expect(api.saveChatComposer).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: ['image-a'] }))
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    expect(result.current.sessionChat.composerImages).toEqual([existing])
    expect(api.importChatImage).toHaveBeenCalledOnce()
  })

  it('preserves a later unrelated image while resolving the deliberately removed uncertain image', async () => {
    const { result } = await failedImport()
    const failureId = result.current.sessionChat.imageFailures[0].id
    api.getChat.mockResolvedValue({ ...committed(), revision: 2, composerImages: [existing, uncertain, later] })
    api.getAttachmentPreviewDataUrl.mockImplementation(async (id?: string) => {
      if (id === 'image-b') throw new Error('Preview unavailable')
      return 'data:image/png;base64,bGF0ZXI='
    })
    act(() => result.current.sessionChat.onRemoveImage('image-b'))
    api.saveChatComposer.mockResolvedValue({ ...committed(), revision: 3, composerImages: [existing, later] })
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(failureId) })
    expect(result.current.sessionChat.composerImages).toEqual([existing, later])
    expect(result.current.sessionChat.imageFailures).toEqual([])
    expect(api.saveChatComposer).toHaveBeenCalledWith(expect.objectContaining({ attachmentIds: ['image-a', 'image-c'] }))
    expect(api.importChatImage).toHaveBeenCalledOnce()
  })

  it('requires deliberate resolution of every newly discovered unverified candidate', async () => {
    const { result } = await failedImport()
    const failureId = result.current.sessionChat.imageFailures[0].id
    api.getChat.mockResolvedValue({ ...committed(), revision: 2, composerImages: [existing, uncertain, later] })
    act(() => result.current.sessionChat.onRemoveImage('image-b'))
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(failureId) })
    expect(result.current.sessionChat.composerImages).toEqual([existing, later])
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    expect(result.current.sessionChat.imageFailures[0].recovery).toEqual({ kind: 'verification_pending', images: [uncertain, later] })
    expect(api.saveChatComposer).not.toHaveBeenCalled()
    expect(api.importChatImage).toHaveBeenCalledOnce()
  })

  it('rejects a foreign draft during failed import recovery without editing either draft', async () => {
    const { result } = await failedImport()
    const failureId = result.current.sessionChat.imageFailures[0].id
    api.getChat.mockResolvedValue(chatFixture({ draftId: 'chat-new', mode: 'chat', composer: 'New draft', composerImages: [later] }))
    await act(async () => { await result.current.sessionChat.onRetryImage(failureId) })
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(failureId) })
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    expect(result.current.sessionChat.composerImages).toEqual([existing, uncertain])
    expect(result.current.sessionChat.chat?.draftId).toBe('chat-1')
    expect(result.current.sessionChat.composer).not.toBe('New draft')
    expect(api.saveChatComposer).not.toHaveBeenCalled()
    expect(api.importChatImage).toHaveBeenCalledOnce()
  })

  it('does not mistake an ignored stale canonical response for proof the import did not commit', async () => {
    api.getChat.mockResolvedValueOnce({ ...initial(), revision: 5 }).mockResolvedValue({ ...initial(), revision: 4 })
    api.importChatImage.mockRejectedValue(new Error('Import response lost'))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat?.revision).toBe(5))
    await act(async () => { await result.current.sessionChat.onAttachImages([file()]) })
    const failureId = result.current.sessionChat.imageFailures[0].id
    await act(async () => { await result.current.sessionChat.onRetryImage(failureId) })
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(failureId) })
    expect(api.importChatImage).toHaveBeenCalledOnce()
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    expect(result.current.sessionChat.composerImages).toEqual([existing])
    expect(api.saveChatComposer).not.toHaveBeenCalled()
  })

  it('clears an import already consumed by a later turn while preserving text edited during recovery', async () => {
    const { result } = await failedImport()
    const failureId = result.current.sessionChat.imageFailures[0].id
    const recovery = deferred<ReturnType<typeof chatFixture>>()
    api.getChat.mockReturnValueOnce(recovery.promise)
    let dismissing!: Promise<void>
    act(() => { dismissing = result.current.sessionChat.onDismissImageFailure(failureId) })
    act(() => result.current.sessionChat.onSetComposer('Next question 4827'))
    await act(async () => {
      recovery.resolve(chatFixture({ mode: 'chat', revision: 2, messages: [{ id: 'message-1', turnId: 'turn-1', role: 'user',
        text: 'Question', images: [existing, uncertain], status: 'completed', errorMessage: null, aiRunId: null, createdAt: 'now' }] }))
      await dismissing
    })
    expect(result.current.sessionChat.imageFailures).toEqual([])
    expect(result.current.sessionChat.composerImages).toEqual([])
    expect(result.current.sessionChat.composer).toBe('Next question 4827')
    expect(result.current.sessionChat.chat?.messages[0].images).toEqual([existing, uncertain])
    expect(api.importChatImage).toHaveBeenCalledOnce()
    expect(api.deleteAttachment).not.toHaveBeenCalled()
  })
})
