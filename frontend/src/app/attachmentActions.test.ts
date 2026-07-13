import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipboardEvent } from 'react'
import type { Editor } from '@tiptap/react'
import { entryFixture, sessionFixture } from '../test/fixtures'
import { registerRichEditor } from '../editor/richEditorRegistry'

const tauriMock = vi.hoisted(() => ({
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
})

function workflowContext(): AttachmentActionsContext {
  return {
    session: {
      activeSession: sessionFixture(),
      noteEntry: entryFixture(),
      setNoteBody: vi.fn(),
    },
    feedback: {
      setBusyAction: vi.fn(),
      setError: vi.fn(),
      setNotice: vi.fn(),
    },
  }
}

function mountEditor() {
  const editor = document.createElement('div')
  editor.id = `editor-${crypto.randomUUID()}`
  editor.className = 'rich-editor note-rich-editor'
  const target = document.createElement('span')
  editor.append(target)
  document.body.append(editor)
  const insertImage = vi.fn()
  const unregister = registerRichEditor(editor.id, {
    editor: {} as Editor,
    insertImage,
    readOnly: false,
  })
  return { insertImage, target, unregister }
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
