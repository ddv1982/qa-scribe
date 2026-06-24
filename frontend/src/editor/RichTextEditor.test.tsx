import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../tauri', () => ({
  getAttachmentPreviewDataUrl: vi.fn(),
}))

import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from './RichTextEditor'

beforeAll(() => {
  const rect = {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
  const rects = {
    0: rect,
    length: 1,
    item: (index: number) => (index === 0 ? rect : null),
    [Symbol.iterator]: function* () {
      yield rect
    },
  } as DOMRectList

  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => rects })
  Object.defineProperty(Text.prototype, 'getClientRects', { configurable: true, value: () => rects })
})

describe('RichTextEditor toolbar', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('formats selected content and can toggle the mark off again', async () => {
    const onChange = vi.fn()
    render(
      <>
        <FormatToolbar editorId="editor-one" onUploadImage={vi.fn()} />
        <RichTextEditor editorId="editor-one" value="<p>Gmail login fails</p>" onChange={onChange} />
      </>,
    )

    const editor = await screen.findByRole('textbox', { name: 'Note body' })
    selectText(editor)

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    await waitFor(() => expect(lastChange(onChange)).toContain('<strong>Gmail login fails</strong>'))

    selectText(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    await waitFor(() => expect(lastChange(onChange)).toContain('<p>Gmail login fails</p>'))
    expect(lastChange(onChange)).not.toContain('<strong>')
  })

  it('adds a safe link to selected content', async () => {
    const onChange = vi.fn()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://example.test/evidence')
    vi.spyOn(window, 'alert').mockImplementation(() => undefined)

    render(
      <>
        <FormatToolbar editorId="editor-one" onUploadImage={vi.fn()} />
        <RichTextEditor editorId="editor-one" value="<p>Evidence</p>" onChange={onChange} />
      </>,
    )

    const editor = await screen.findByRole('textbox', { name: 'Note body' })
    selectText(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    await waitFor(() => expect(lastChange(onChange)).toContain('<a href="https://example.test/evidence" target="_blank" rel="noreferrer">Evidence</a>'))
    expect(prompt).toHaveBeenCalled()
  })

  it('sends image uploads to the toolbar target instead of the previously focused editor', async () => {
    const onUploadImage = vi.fn((_: RichEditorImageUpload) => undefined)
    const onSecondChange = vi.fn()

    render(
      <>
        <FormatToolbar editorId="first-editor" onUploadImage={onUploadImage} />
        <RichTextEditor editorId="first-editor" value="<p>First</p>" />
        <FormatToolbar editorId="second-editor" onUploadImage={onUploadImage} />
        <RichTextEditor editorId="second-editor" value="<p>Second</p>" onChange={onSecondChange} />
      </>,
    )

    await waitFor(() => expect(screen.getAllByRole<HTMLButtonElement>('button', { name: 'Upload image' })[1]?.disabled).toBe(false))
    screen.getAllByRole('textbox', { name: 'Note body' })[0]?.focus()
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload image' })[1])

    const file = new File(['png'], 'evidence.png', { type: 'image/png' })
    fireEvent.change(screen.getAllByLabelText('Upload image file')[1], {
      target: { files: [file] },
    })

    expect(onUploadImage).toHaveBeenCalledTimes(1)
    const upload = onUploadImage.mock.calls[0]?.[0]
    expect(upload?.file).toBe(file)
    expect(upload?.insertImage).toEqual(expect.any(Function))

    upload?.insertImage('attachment-1', 'evidence.png', 'data:image/png;base64,AAAA')
    await waitFor(() => expect(lastChange(onSecondChange)).toContain('data-attachment-id="attachment-1"'))
    expect(lastChange(onSecondChange)).toContain('src="qa-scribe-attachment://attachment-1"')
    expect(lastChange(onSecondChange)).toContain('alt="evidence.png"')
  })
})

function selectText(editor: HTMLElement) {
  editor.focus()
  const textNode = editor.querySelector('p')?.firstChild
  if (!textNode) throw new Error('editor text missing')

  const range = document.createRange()
  range.selectNodeContents(textNode)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  fireEvent.mouseUp(editor)
}

function lastChange(onChange: ReturnType<typeof vi.fn>): string {
  const call = onChange.mock.calls.at(-1)
  if (!call) throw new Error('onChange was not called')
  return String(call[0])
}
