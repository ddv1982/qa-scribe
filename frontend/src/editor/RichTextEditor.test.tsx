import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../tauri', () => ({
  getAttachmentPreviewDataUrl: vi.fn(),
  EDITOR_HTML_TAGS: ['a', 'b', 'br', 'em', 'h2', 'h3', 'i', 'img', 'input', 'li', 'ol', 'p', 'strong', 'ul'],
  MANAGED_ATTACHMENT_PROTOCOL: 'qa-scribe-attachment://',
}))

import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from './RichTextEditor'
import { emptyRichEditorDocument, richEditorDocumentFromHtml, richEditorDocumentToHtml, type RichEditorDocument } from './editorDocument'

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

  it('renders and resets a true blank value through TipTap', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<RichTextEditor value={emptyRichEditorDocument} onChange={onChange} />)

    const editor = await screen.findByRole('textbox', { name: 'Note body' })
    expect(editor.textContent).toBe('')

    rerender(<RichTextEditor value={richEditorDocumentFromHtml('<p>Gmail login fails</p>')} onChange={onChange} />)
    await waitFor(() => expect(editor.textContent).toContain('Gmail login fails'))

    rerender(<RichTextEditor value={emptyRichEditorDocument} onChange={onChange} />)
    await waitFor(() => expect(editor.textContent).toBe(''))
  })

  it('formats selected content and can toggle the mark off again', async () => {
    const onChange = vi.fn()
    render(
      <>
        <FormatToolbar editorId="editor-one" onUploadImage={vi.fn()} />
        <RichTextEditor editorId="editor-one" value={richEditorDocumentFromHtml('<p>Gmail login fails</p>')} onChange={onChange} />
      </>,
    )

    const editor = await screen.findByRole('textbox', { name: 'Note body' })
    selectText(editor)

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    await waitFor(() => expect(lastChangeHtml(onChange)).toContain('<strong>Gmail login fails</strong>'))

    selectText(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    await waitFor(() => expect(lastChangeHtml(onChange)).toContain('<p>Gmail login fails</p>'))
    expect(lastChangeHtml(onChange)).not.toContain('<strong>')
  })

  it('adds a safe link to selected content via the inline popover', async () => {
    const onChange = vi.fn()

    render(
      <>
        <FormatToolbar editorId="editor-one" onUploadImage={vi.fn()} />
        <RichTextEditor editorId="editor-one" value={richEditorDocumentFromHtml('<p>Evidence</p>')} onChange={onChange} />
      </>,
    )

    const editor = await screen.findByRole('textbox', { name: 'Note body' })
    selectText(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    const input = await screen.findByRole('textbox', { name: 'Link URL' })
    fireEvent.change(input, { target: { value: 'https://example.test/evidence' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }))

    await waitFor(() => expect(lastChangeHtml(onChange)).toContain('<a href="https://example.test/evidence" target="_blank" rel="noreferrer">Evidence</a>'))
    // The popover closes on a successful apply.
    expect(screen.queryByRole('textbox', { name: 'Link URL' })).toBeNull()
  })

  it('prefills the current href and removes the link on an empty submit', async () => {
    const onChange = vi.fn()

    render(
      <>
        <FormatToolbar editorId="editor-one" onUploadImage={vi.fn()} />
        <RichTextEditor
          editorId="editor-one"
          value={richEditorDocumentFromHtml('<p><a href="https://example.test/old">Evidence</a></p>')}
          onChange={onChange}
        />
      </>,
    )

    const editor = await screen.findByRole('textbox', { name: 'Note body' })
    selectText(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    const input = await screen.findByRole<HTMLInputElement>('textbox', { name: 'Link URL' })
    // The existing href is prefilled for editing.
    expect(input.value).toBe('https://example.test/old')

    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }))

    await waitFor(() => expect(lastChangeHtml(onChange)).not.toContain('<a '))
  })

  it('rejects an unsafe link scheme with an inline error and no link mark', async () => {
    const onChange = vi.fn()

    render(
      <>
        <FormatToolbar editorId="editor-one" onUploadImage={vi.fn()} />
        <RichTextEditor editorId="editor-one" value={richEditorDocumentFromHtml('<p>Evidence</p>')} onChange={onChange} />
      </>,
    )

    const editor = await screen.findByRole('textbox', { name: 'Note body' })
    selectText(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    const input = await screen.findByRole('textbox', { name: 'Link URL' })
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply link' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Use an http, https, or mailto link.')
    // The popover stays open and no link mark was applied.
    expect(screen.getByRole('textbox', { name: 'Link URL' })).toBeTruthy()
    if (onChange.mock.calls.length > 0) expect(lastChangeHtml(onChange)).not.toContain('javascript:')
  })

  it('sends image uploads to the toolbar target instead of the previously focused editor', async () => {
    const onUploadImage = vi.fn((_: RichEditorImageUpload) => undefined)
    const onSecondChange = vi.fn()

    render(
      <>
        <FormatToolbar editorId="first-editor" onUploadImage={onUploadImage} />
        <RichTextEditor editorId="first-editor" value={richEditorDocumentFromHtml('<p>First</p>')} />
        <FormatToolbar editorId="second-editor" onUploadImage={onUploadImage} />
        <RichTextEditor editorId="second-editor" value={richEditorDocumentFromHtml('<p>Second</p>')} onChange={onSecondChange} />
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
    await waitFor(() => expect(lastChangeHtml(onSecondChange)).toContain('data-attachment-id="attachment-1"'))
    expect(lastChangeHtml(onSecondChange)).toContain('src="qa-scribe-attachment://attachment-1"')
    expect(lastChangeHtml(onSecondChange)).toContain('alt="evidence.png"')
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

function lastChange(onChange: ReturnType<typeof vi.fn>): RichEditorDocument {
  const call = onChange.mock.calls.at(-1)
  if (!call) throw new Error('onChange was not called')
  return call[0] as RichEditorDocument
}

function lastChangeHtml(onChange: ReturnType<typeof vi.fn>): string {
  return richEditorDocumentToHtml(lastChange(onChange))
}
