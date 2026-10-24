import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chatFixture, chatJobFixture } from './useSessionChat.testSupport'
import { cleanupControllerTest, deferred, getTauriMock, setupControllerTest, useAppController } from './useAppController.testHarness'

const api = getTauriMock()
const image = { attachmentId: 'image-1', filename: 'checkout.png', mimeType: 'image/png', sizeBytes: 100 }
const other = { ...image, attachmentId: 'image-2', filename: 'other.png' }
const file = () => new File(['pixels'], 'checkout.png', { type: 'image/png' })

describe('durable chat composer images', () => {
  beforeEach(setupControllerTest)
  afterEach(cleanupControllerTest)

  it('hydrates an image-only composer and sends it without a text placeholder', async () => {
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composerImages: [image] }))
    api.startChatJob.mockResolvedValue({ jobId: 'job-chat', turnId: 'turn-1', status: chatJobFixture(),
      chat: chatFixture({ mode: 'chat', revision: 1, messages: [{ id: 'message-1', turnId: 'turn-1', role: 'user',
        text: '', images: [image], status: 'running', errorMessage: null, aiRunId: null, createdAt: 'now' }] }) })
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composerImages).toEqual([image]))
    await waitFor(() => expect(result.current.activeProvider?.available).toBe(true))
    await act(async () => { await result.current.sessionChat.onSend() })
    expect(api.startChatJob).toHaveBeenCalledOnce()
    expect(result.current.sessionChat.composer).toBe('')
    expect(result.current.sessionChat.composerImages).toEqual([])
    expect(result.current.sessionChat.chat?.messages[0]).toMatchObject({ text: '', images: [image] })
  })

  it('keeps text typed during an import and includes the imported image in the next save', async () => {
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'Original question' }))
    const imported = deferred<ReturnType<typeof chatFixture>>()
    api.importChatImage.mockReturnValueOnce(imported.promise)
    api.saveChatComposer.mockResolvedValue(chatFixture({ mode: 'chat', revision: 2, composer: 'Newer question 4827', composerImages: [image] }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composer).toBe('Original question'))
    let importing!: Promise<void>
    act(() => { importing = result.current.sessionChat.onAttachImages([file()]) })
    await waitFor(() => expect(api.importChatImage).toHaveBeenCalledOnce())
    act(() => result.current.sessionChat.onSetComposer('Newer question 4827'))
    await act(async () => {
      imported.resolve(chatFixture({ mode: 'chat', revision: 1, composer: 'Original question', composerImages: [image] }))
      await importing
    })
    expect(result.current.sessionChat.composer).toBe('Newer question 4827')
    expect(result.current.sessionChat.composerImages).toEqual([image])
    await act(async () => { await result.current.saveAllPendingChanges() })
    expect(api.saveChatComposer).toHaveBeenLastCalledWith({ scope: { sessionId: 'session-1', draftId: 'chat-1', expectedRevision: 1 },
      composer: 'Newer question 4827', attachmentIds: ['image-1'], mode: 'chat' })
  })

  it('does not restore an image removed while an older autosave is pending', async () => {
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'Keep this text', composerImages: [image, other] }))
    const firstSave = deferred<ReturnType<typeof chatFixture>>()
    api.saveChatComposer.mockReturnValueOnce(firstSave.promise).mockResolvedValueOnce(chatFixture({
      mode: 'chat', revision: 2, composer: 'Keep this text', composerImages: [],
    }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composerImages).toHaveLength(2))
    act(() => result.current.sessionChat.onRemoveImage('image-1'))
    let flush!: Promise<boolean>
    act(() => { flush = result.current.saveAllPendingChanges() })
    await waitFor(() => expect(api.saveChatComposer).toHaveBeenCalledOnce())
    act(() => result.current.sessionChat.onRemoveImage('image-2'))
    await act(async () => {
      firstSave.resolve(chatFixture({ mode: 'chat', revision: 1, composer: 'Keep this text', composerImages: [other] }))
      await flush
    })
    expect(result.current.sessionChat.composerImages).toEqual([])
    expect(result.current.sessionChat.composer).toBe('Keep this text')
    expect(api.saveChatComposer).toHaveBeenLastCalledWith(expect.objectContaining({ attachmentIds: [], composer: 'Keep this text' }))
  })

  it('recovers an imported image after the response is lost without deleting typed text', async () => {
    api.getChat.mockResolvedValueOnce(chatFixture({ mode: 'chat', composer: 'Keep my question' }))
      .mockResolvedValue(chatFixture({ mode: 'chat', revision: 1, composer: 'Keep my question', composerImages: [image] }))
    api.importChatImage.mockRejectedValueOnce(new Error('Response lost'))
    api.getAttachmentPreviewDataUrl.mockResolvedValueOnce('data:image/png;base64,cGl4ZWxz')
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composer).toBe('Keep my question'))
    await act(async () => { await result.current.sessionChat.onAttachImages([file()]) })
    expect(result.current.sessionChat.composerImages).toEqual([image])
    expect(result.current.sessionChat.composer).toBe('Keep my question')
    expect(result.current.sessionChat.error).toBeNull()
    expect(result.current.sessionChat.imageFailures).toEqual([])
    expect(api.importChatImage).toHaveBeenCalledOnce()
    expect(api.deleteAttachment).not.toHaveBeenCalled()
  })

  it('retains a removed image locally when saving fails and blocks navigation', async () => {
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'Keep my text', composerImages: [image] }))
    api.saveChatComposer.mockRejectedValue(new Error('Disk unavailable'))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composerImages).toEqual([image]))
    act(() => result.current.sessionChat.onRemoveImage('image-1'))
    let saved = true
    await act(async () => { saved = await result.current.saveAllPendingChanges() })
    expect(saved).toBe(false)
    expect(result.current.sessionChat.dirty).toBe(true)
    expect(result.current.sessionChat.composerImages).toEqual([])
    expect(result.current.sessionChat.chat?.composerImages).toEqual([image])
    expect(result.current.sessionChat.composer).toBe('Keep my text')
  })

  it('does not import an empty native clipboard or leave an operation running', async () => {
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'Keep my text' }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat).not.toBeNull())
    await act(async () => { await result.current.sessionChat.onPasteNativeImage() })
    expect(api.importChatImage).not.toHaveBeenCalled()
    expect(result.current.sessionChat.composer).toBe('Keep my text')
    expect(result.current.sessionChat.working).toBe(false)
  })

  it('rejects a fifth image without changing the draft or starting an import', async () => {
    const images = [0, 1, 2, 3].map(index => ({ ...image, attachmentId: `image-${index}` }))
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composerImages: images }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composerImages).toHaveLength(4))
    await act(async () => { await result.current.sessionChat.onAttachImages([file()]) })
    expect(api.importChatImage).not.toHaveBeenCalled()
    expect(result.current.sessionChat.composerImages).toEqual(images)
    expect(result.current.sessionChat.error).toContain('up to 4 images')
    expect(result.current.sessionChat.working).toBe(false)
  })

  it.each([false, true])('consumes sent images while preserving newly typed text when the start response is lost=%s', async lost => {
    const initial = chatFixture({ mode: 'chat', composer: 'Original question', composerImages: [image] })
    const canonical = chatFixture({ mode: 'chat', revision: 1, messages: [{ id: 'message-1', turnId: 'turn-1', role: 'user',
      text: 'Original question', images: [image], status: lost ? 'failed' : 'running', errorMessage: null, aiRunId: null, createdAt: 'now' }] })
    api.getChat.mockResolvedValueOnce(initial).mockResolvedValue(canonical)
    const start = deferred<{ jobId: string; turnId: string; status: ReturnType<typeof chatJobFixture>; chat: ReturnType<typeof chatFixture> }>()
    api.startChatJob.mockReturnValueOnce(start.promise.then(value => { if (lost) throw new Error('Start response lost'); return value }))
    api.saveChatComposer.mockResolvedValue({ ...canonical, revision: 2, composer: 'New question 4827' })
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composerImages).toEqual([image]))
    await waitFor(() => expect(result.current.activeProvider?.available).toBe(true))
    let sending!: Promise<void>
    act(() => { sending = result.current.sessionChat.onSend() })
    await waitFor(() => expect(api.startChatJob).toHaveBeenCalledOnce())
    act(() => result.current.sessionChat.onSetComposer('New question 4827'))
    await act(async () => { start.resolve({ jobId: 'job-chat', turnId: 'turn-1', status: chatJobFixture(), chat: canonical }); await sending })
    expect(result.current.sessionChat.composer).toBe('New question 4827')
    expect(result.current.sessionChat.composerImages).toEqual([])
    expect(result.current.sessionChat.chat?.messages[0].images).toEqual([image])
    await act(async () => { await result.current.saveAllPendingChanges() })
    expect(api.saveChatComposer).toHaveBeenLastCalledWith(expect.objectContaining({ composer: 'New question 4827', attachmentIds: [] }))
    expect(api.startChatJob).toHaveBeenCalledOnce()
  })

  it('blocks sending after an image failure until the failed image is explicitly removed', async () => {
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'Question with an image' }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.activeProvider?.available).toBe(true))
    await waitFor(() => expect(result.current.sessionChat.chat).not.toBeNull())
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })
    await act(async () => { await result.current.sessionChat.onAttachImages([oversized]) })
    expect(result.current.sessionChat.imageFailures).toEqual([{ id: expect.any(String), filename: 'large.png', message: 'Something went wrong: Each image must be 10 MiB or smaller.' }])
    await act(async () => { await result.current.sessionChat.onSend() })
    expect(api.startChatJob).not.toHaveBeenCalled()
    expect(result.current.sessionChat.composer).toBe('Question with an image')
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(result.current.sessionChat.imageFailures[0].id) })
    expect(result.current.sessionChat.imageFailures).toEqual([])
    expect(result.current.sessionChat.dirty).toBe(false)
    expect(api.importChatImage).not.toHaveBeenCalled()
  })

  it('retries a failed import with its retained image and clears the failure on success', async () => {
    api.getChat.mockResolvedValue(chatFixture({ mode: 'chat', composer: 'Question' }))
    api.importChatImage.mockRejectedValueOnce(new Error('Disk busy')).mockResolvedValueOnce(chatFixture({
      mode: 'chat', revision: 1, composer: 'Question', composerImages: [image],
    }))
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat).not.toBeNull())
    await act(async () => { await result.current.sessionChat.onAttachImages([file()]) })
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    await act(async () => { await result.current.sessionChat.onRetryImage(result.current.sessionChat.imageFailures[0].id) })
    expect(result.current.sessionChat.imageFailures).toEqual([])
    expect(result.current.sessionChat.composerImages).toEqual([image])
    expect(result.current.sessionChat.composer).toBe('Question')
    expect(api.importChatImage).toHaveBeenNthCalledWith(2, { sessionId: 'session-1', draftId: 'chat-1', expectedRevision: 0 }, 'checkout.png', 'data:image/png;base64,cGl4ZWxz')
  })

  it('reconciles sent images after the immediate recovery read fails and a later recheck succeeds', async () => {
    const initial = chatFixture({ mode: 'chat', composer: 'Original question', composerImages: [image] })
    const canonical = chatFixture({ mode: 'chat', revision: 1, messages: [{ id: 'message-1', turnId: 'turn-1', role: 'user',
      text: 'Original question', images: [image], status: 'failed', errorMessage: null, aiRunId: null, createdAt: 'now' }] })
    api.getChat.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('Recovery unavailable')).mockResolvedValue(canonical)
    const start = deferred<void>()
    api.startChatJob.mockReturnValueOnce(start.promise.then(() => { throw new Error('Start response lost') }))
    api.saveChatComposer.mockResolvedValue({ ...canonical, revision: 2, composer: 'New question' })
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composerImages).toEqual([image]))
    await waitFor(() => expect(result.current.activeProvider?.available).toBe(true))
    let sending!: Promise<void>
    act(() => { sending = result.current.sessionChat.onSend() })
    await waitFor(() => expect(api.startChatJob).toHaveBeenCalledOnce())
    act(() => result.current.sessionChat.onSetComposer('New question'))
    await act(async () => { start.resolve(); await sending })
    await act(async () => { await result.current.sessionChat.onRecheck?.() })
    expect(result.current.sessionChat.composer).toBe('New question')
    expect(result.current.sessionChat.composerImages).toEqual([])
    await act(async () => { await result.current.saveAllPendingChanges() })
    expect(api.saveChatComposer).toHaveBeenLastCalledWith(expect.objectContaining({ composer: 'New question', attachmentIds: [] }))
    expect(api.startChatJob).toHaveBeenCalledOnce()
  })

  it('rechecks an uncertain imported image after its preview fails without importing it twice', async () => {
    const canonical = chatFixture({ mode: 'chat', revision: 1, composer: 'Question', composerImages: [image] })
    api.getChat.mockResolvedValueOnce(chatFixture({ mode: 'chat', composer: 'Question' })).mockResolvedValue(canonical)
    api.importChatImage.mockRejectedValueOnce(new Error('Import response lost')).mockResolvedValueOnce({
      ...canonical, revision: 2, composerImages: [image, other],
    })
    api.getAttachmentPreviewDataUrl.mockRejectedValueOnce(new Error('Preview unavailable')).mockResolvedValueOnce('data:image/png;base64,cGl4ZWxz')
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat).not.toBeNull())
    await act(async () => { await result.current.sessionChat.onAttachImages([file()]) })
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    await act(async () => { await result.current.sessionChat.onRetryImage(result.current.sessionChat.imageFailures[0].id) })
    expect(api.importChatImage).toHaveBeenCalledOnce()
    expect(result.current.sessionChat.composerImages).toEqual([image])
    expect(result.current.sessionChat.imageFailures).toEqual([])
  })

  it('preserves local image removal when retry reconciles an uncertain import before autosave', async () => {
    const third = { ...image, attachmentId: 'image-3' }
    const canonical = chatFixture({ mode: 'chat', revision: 1, composer: 'Question', composerImages: [image, other, third] })
    api.getChat.mockResolvedValueOnce(chatFixture({ mode: 'chat', composer: 'Question', composerImages: [image, other] }))
      .mockResolvedValue(canonical)
    api.importChatImage.mockRejectedValueOnce(new Error('Import response lost'))
    api.getAttachmentPreviewDataUrl.mockRejectedValueOnce(new Error('Preview unavailable')).mockResolvedValueOnce('data:image/png;base64,cGl4ZWxz')
    api.saveChatComposer.mockResolvedValue({ ...canonical, revision: 2, composerImages: [other, third] })
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.composerImages).toEqual([image, other]))
    await act(async () => { await result.current.sessionChat.onAttachImages([file()]) })
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    act(() => result.current.sessionChat.onRemoveImage('image-1'))
    await act(async () => { await result.current.sessionChat.onRetryImage(result.current.sessionChat.imageFailures[0].id) })
    expect(result.current.sessionChat.composerImages).toEqual([other, third])
    expect(result.current.sessionChat.dirty).toBe(true)
    expect(result.current.sessionChat.chat?.composerImages).toEqual([image, other, third])
    await act(async () => { await result.current.saveAllPendingChanges() })
    expect(api.saveChatComposer).toHaveBeenLastCalledWith(expect.objectContaining({ attachmentIds: ['image-2', 'image-3'] }))
    expect(result.current.sessionChat.composerImages).toEqual([other, third])
    expect(api.importChatImage).toHaveBeenCalledOnce()
  })

  it('removes a committed image when its failed import is dismissed after a lost recovery read', async () => {
    const canonical = chatFixture({ mode: 'chat', revision: 1, composer: 'Question', composerImages: [image] })
    api.getChat.mockResolvedValueOnce(chatFixture({ mode: 'chat', composer: 'Question' }))
      .mockRejectedValueOnce(new Error('Recovery unavailable')).mockResolvedValue(canonical)
    api.importChatImage.mockRejectedValueOnce(new Error('Import response lost'))
    api.getAttachmentPreviewDataUrl.mockResolvedValueOnce('data:image/png;base64,cGl4ZWxz')
    api.saveChatComposer.mockResolvedValue({ ...canonical, revision: 2, composerImages: [] })
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat).not.toBeNull())
    await act(async () => { await result.current.sessionChat.onAttachImages([file()]) })
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    expect(result.current.sessionChat.composerImages).toEqual([])
    await act(async () => { await result.current.sessionChat.onDismissImageFailure(result.current.sessionChat.imageFailures[0].id) })
    expect(result.current.sessionChat.imageFailures).toEqual([])
    expect(result.current.sessionChat.composerImages).toEqual([])
    expect(result.current.sessionChat.chat?.composerImages).toEqual([image])
    await act(async () => { await result.current.saveAllPendingChanges() })
    expect(api.saveChatComposer).toHaveBeenLastCalledWith(expect.objectContaining({ attachmentIds: [] }))
    expect(api.importChatImage).toHaveBeenCalledOnce()
    expect(result.current.sessionChat.composerImages).toEqual([])
  })

  it.each(['dismiss', 'retry'])('can %s after the uncertain thumbnail is removed and persisted', async action => {
    const canonical = chatFixture({ mode: 'chat', revision: 1, composer: 'Question', composerImages: [image] })
    const removed = { ...canonical, revision: 2, composerImages: [] }
    api.getChat.mockResolvedValueOnce(chatFixture({ mode: 'chat', composer: 'Question' })).mockResolvedValue(canonical)
    api.importChatImage.mockRejectedValueOnce(new Error('Import response lost')).mockResolvedValueOnce({ ...removed, revision: 3, composerImages: [other] })
    api.getAttachmentPreviewDataUrl.mockRejectedValueOnce(new Error('Preview unavailable'))
    api.saveChatComposer.mockResolvedValue(removed)
    const { result } = renderHook(() => useAppController())
    await waitFor(() => expect(result.current.sessionChat.chat).not.toBeNull())
    await act(async () => { await result.current.sessionChat.onAttachImages([file()]) })
    expect(result.current.sessionChat.imageFailures).toHaveLength(1)
    expect(result.current.sessionChat.composerImages).toEqual([image])
    const failureId = result.current.sessionChat.imageFailures[0].id
    act(() => result.current.sessionChat.onRemoveImage(image.attachmentId))
    await act(async () => { await result.current.saveAllPendingChanges() })
    expect(result.current.sessionChat.chat?.composerImages).toEqual([])
    api.getChat.mockResolvedValue(removed)
    await act(async () => {
      if (action === 'dismiss') await result.current.sessionChat.onDismissImageFailure(failureId)
      else await result.current.sessionChat.onRetryImage(failureId)
    })
    expect(result.current.sessionChat.imageFailures).toEqual([])
    expect(result.current.sessionChat.composer).toBe('Question')
  })
})
