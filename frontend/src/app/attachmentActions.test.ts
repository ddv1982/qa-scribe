import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipboardEvent } from 'react'
import type { Editor } from '@tiptap/react'
import { entryFixture, sessionFixture } from '../test/fixtures'
import { registerRichEditor } from '../editor/richEditorRegistry'
import type { BusyAction } from '../ui/types'

const tauriMock = vi.hoisted(() => ({
  deleteAttachment: vi.fn(),
  importClipboardScreenshot: vi.fn(),
  readClipboardImageDataUrl: vi.fn(),
  EDITOR_HTML_TAGS: ['a', 'b', 'br', 'em', 'h2', 'h3', 'i', 'img', 'input', 'li', 'ol', 'p', 'strong', 'ul'],
  SELF_CLOSING_EDITOR_HTML_TAGS: ['br', 'img', 'input'],
  MANAGED_ATTACHMENT_PROTOCOL: 'qa-scribe-attachment://',
}))

vi.mock('../tauri', () => tauriMock)

import { createAttachmentActions, imageFileFromClipboardData, shouldReadNativeClipboardImage, type AttachmentActionsContext } from './attachmentActions'

describe('attachment paste actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tauriMock.importClipboardScreenshot.mockResolvedValue({ id: 'attachment-1', filename: 'clip.png' })
    tauriMock.deleteAttachment.mockResolvedValue(true)
    tauriMock.readClipboardImageDataUrl.mockResolvedValue('data:image/png;base64,BBBB')
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds image files exposed through clipboard items', () => {
    const file = new File(['image'], 'clip.png', { type: 'image/png' })
    const clipboardData = dataTransfer({ items: [dataTransferItem({ file, type: '' })] })

    expect(imageFileFromClipboardData(clipboardData)).toBe(file)
  })

  it('detects image-shaped clipboard data that needs the native fallback', () => {
    const clipboardData = dataTransfer({ items: [dataTransferItem({ file: null, type: 'image/png' })] })

    expect(shouldReadNativeClipboardImage(clipboardData)).toBe(true)
  })

  it('imports a pasted image file through the managed attachment path', async () => {
    const file = new File(['hello'], 'clip.png', { type: 'image/png' })
    const ctx = workflowContext()
    const { insertImage, target, unregister } = mountEditor()
    const { event, preventDefault } = pasteEvent(target, dataTransfer({ files: [file] }))

    createAttachmentActions(ctx).handlePaste(event)

    expect(preventDefault).toHaveBeenCalled()
    await waitFor(() =>
      expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledWith({
        sessionId: 'session-1',
        entryId: 'entry-1',
        filename: 'clip.png',
        dataUrl: 'data:image/png;base64,aGVsbG8=',
      }),
    )
    expect(insertImage).toHaveBeenCalledWith('attachment-1', 'clip.png', 'data:image/png;base64,aGVsbG8=')
    expect(tauriMock.readClipboardImageDataUrl).not.toHaveBeenCalled()

    unregister()
  })

  it('falls back to the native clipboard when the DOM payload advertises an image without a file', async () => {
    const ctx = workflowContext()
    const { insertImage, target, unregister } = mountEditor()
    const clipboardData = dataTransfer({
      items: [dataTransferItem({ file: null, type: 'image/png' })],
      types: ['image/png'],
    })
    const { event, preventDefault } = pasteEvent(target, clipboardData)

    createAttachmentActions(ctx).handlePaste(event)

    expect(preventDefault).toHaveBeenCalled()
    await waitFor(() => expect(tauriMock.readClipboardImageDataUrl).toHaveBeenCalled())
    expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledWith({
      sessionId: 'session-1',
      entryId: 'entry-1',
      filename: expect.stringMatching(/^pasted-image-\d+\.png$/),
      dataUrl: 'data:image/png;base64,BBBB',
    })
    expect(insertImage).toHaveBeenCalledWith('attachment-1', 'clip.png', 'data:image/png;base64,BBBB')

    unregister()
  })

  it('leaves text-only paste to the editor default handler', () => {
    const ctx = workflowContext()
    const { target, unregister } = mountEditor()
    const { event, preventDefault } = pasteEvent(
      target,
      dataTransfer({
        data: { 'text/plain': 'plain note text' },
        types: ['text/plain'],
      }),
    )

    createAttachmentActions(ctx).handlePaste(event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(tauriMock.importClipboardScreenshot).not.toHaveBeenCalled()
    expect(tauriMock.readClipboardImageDataUrl).not.toHaveBeenCalled()

    unregister()
  })

  it('removes a pasted attachment when its editor unmounts before import completes', async () => {
    const pendingImport = deferred<{ id: string; filename: string }>()
    tauriMock.importClipboardScreenshot.mockReturnValueOnce(pendingImport.promise)
    const ctx = workflowContext()
    const { target, insertImage, unregister } = mountEditor()
    const paste = pasteEvent(
      target,
      dataTransfer({ files: [new File(['image'], 'late.png', { type: 'image/png' })] }),
    )

    createAttachmentActions(ctx).handlePaste(paste.event)
    await waitFor(() => expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1))
    unregister()
    pendingImport.resolve({ id: 'attachment-stale-paste', filename: 'late.png' })

    await waitFor(() => expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-stale-paste'))
    expect(insertImage).not.toHaveBeenCalled()
  })

  it('removes an uploaded attachment when its editor unmounts before import completes', async () => {
    const pendingImport = deferred<{ id: string; filename: string }>()
    tauriMock.importClipboardScreenshot.mockReturnValueOnce(pendingImport.promise)
    const { editorId, insertImage, unregister } = mountEditor()
    const actions = createAttachmentActions(workflowContext())
    const upload = actions.uploadEditorImage({
      editorId,
      file: new File(['image'], 'late.png', { type: 'image/png' }),
      insertImage,
    }, { kind: 'draft', id: 'draft-1' })
    await waitFor(() => expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(1))
    unregister()
    pendingImport.resolve({ id: 'attachment-stale-upload', filename: 'late.png' })
    await upload

    expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-stale-upload')
    expect(insertImage).not.toHaveBeenCalled()
  })

  it('keeps attachment busy state until every concurrent upload finishes', async () => {
    const firstImport = deferred<{ id: string; filename: string }>()
    const secondImport = deferred<{ id: string; filename: string }>()
    tauriMock.importClipboardScreenshot
      .mockReturnValueOnce(firstImport.promise)
      .mockReturnValueOnce(secondImport.promise)
    const { editorId, insertImage, unregister } = mountEditor()
    const ctx = workflowContext()
    let busy: BusyAction | null = null
    ctx.feedback.setBusyAction = (next) => {
      busy = typeof next === 'function' ? next(busy) : next
    }
    const actions = createAttachmentActions(ctx)
    const firstUpload = actions.uploadEditorImage({
      editorId,
      file: new File(['first'], 'first.png', { type: 'image/png' }),
      insertImage,
    }, { kind: 'draft', id: 'draft-1' })
    const secondUpload = actions.uploadEditorImage({
      editorId,
      file: new File(['second'], 'second.png', { type: 'image/png' }),
      insertImage,
    }, { kind: 'draft', id: 'draft-1' })
    await waitFor(() => expect(tauriMock.importClipboardScreenshot).toHaveBeenCalledTimes(2))
    expect(busy).toBe('attach-image')

    firstImport.resolve({ id: 'attachment-first', filename: 'first.png' })
    await firstUpload
    expect(busy).toBe('attach-image')

    secondImport.resolve({ id: 'attachment-second', filename: 'second.png' })
    await secondUpload
    expect(busy).toBeNull()
    unregister()
  })

  it('removes an imported attachment when the editor declines insertion', async () => {
    const { editorId, insertImage, unregister } = mountEditor()
    insertImage.mockReturnValueOnce(false)
    const actions = createAttachmentActions(workflowContext())

    await actions.uploadEditorImage({
      editorId,
      file: new File(['image'], 'declined.png', { type: 'image/png' }),
      insertImage,
    }, { kind: 'draft', id: 'draft-1' })

    expect(tauriMock.deleteAttachment).toHaveBeenCalledWith('attachment-1')
    unregister()
  })
})

function workflowContext(): AttachmentActionsContext {
  return {
    session: {
      activeSession: sessionFixture(),
      noteEntry: entryFixture(),
    },
    feedback: {
      setBusyAction: vi.fn(),
      setError: vi.fn(),
      setNotice: vi.fn(),
    },
    registerImportedAttachment: vi.fn(),
  }
}

function mountEditor() {
  const editor = document.createElement('div')
  editor.id = `editor-${crypto.randomUUID()}`
  editor.className = 'rich-editor note-rich-editor'
  const target = document.createElement('span')
  editor.append(target)
  document.body.append(editor)
  const insertImage = vi.fn(() => true)
  const unregister = registerRichEditor(editor.id, {
    editor: {} as Editor,
    insertImage,
    readOnly: false,
  })
  return { editorId: editor.id, insertImage, target, unregister }
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function pasteEvent(target: HTMLElement, clipboardData: DataTransfer) {
  const preventDefault = vi.fn()
  return {
    event: { target, clipboardData, preventDefault } as unknown as ClipboardEvent<HTMLElement>,
    preventDefault,
  }
}

function dataTransfer({
  data = {},
  files = [],
  items = [],
  types,
}: {
  data?: Record<string, string>
  files?: File[]
  items?: DataTransferItem[]
  types?: string[]
}): DataTransfer {
  return {
    files,
    items,
    types: types ?? Object.keys(data),
    getData: vi.fn((type: string) => data[type] ?? ''),
  } as unknown as DataTransfer
}

function dataTransferItem({ file, type }: { file: File | null; type: string }): DataTransferItem {
  return {
    kind: 'file',
    type,
    getAsFile: vi.fn(() => file),
  } as unknown as DataTransferItem
}
