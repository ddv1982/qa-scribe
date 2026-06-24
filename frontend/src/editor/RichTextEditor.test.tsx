import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../tauri', () => ({
  getAttachmentPreviewDataUrl: vi.fn(),
}))

import { FormatToolbar, RichTextEditor, type RichEditorImageUpload } from './RichTextEditor'

describe('RichTextEditor toolbar', () => {
  const execCommand = vi.fn(() => true)

  beforeEach(() => {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })
    execCommand.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('runs the supported formatting commands against the targeted editor', () => {
    const onChange = vi.fn()
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://example.test/evidence')
    vi.spyOn(window, 'alert').mockImplementation(() => undefined)

    render(
      <>
        <FormatToolbar editorId="editor-one" onUploadImage={vi.fn()} />
        <RichTextEditor editorId="editor-one" value="<p>Gmail login fails</p>" onChange={onChange} />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bulleted list' }))
    fireEvent.change(screen.getByLabelText('Block style'), { target: { value: 'h2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link' }))

    expect(execCommand).toHaveBeenCalledWith('bold')
    expect(execCommand).toHaveBeenCalledWith('italic')
    expect(execCommand).toHaveBeenCalledWith('insertUnorderedList')
    expect(execCommand).toHaveBeenCalledWith('formatBlock', false, 'h2')
    expect(execCommand).toHaveBeenCalledWith('createLink', false, 'https://example.test/evidence')
    expect(prompt).toHaveBeenCalled()
  })

  it('sends image uploads to the toolbar target instead of the previously focused editor', () => {
    const onUploadImage = vi.fn((_: RichEditorImageUpload) => undefined)

    render(
      <>
        <FormatToolbar editorId="first-editor" onUploadImage={onUploadImage} />
        <RichTextEditor editorId="first-editor" value="<p>First</p>" />
        <FormatToolbar editorId="second-editor" onUploadImage={onUploadImage} />
        <RichTextEditor editorId="second-editor" value="<p>Second</p>" />
      </>,
    )

    screen.getAllByRole('textbox', { name: 'Note body' })[0]?.focus()
    fireEvent.click(screen.getAllByRole('button', { name: 'Upload image' })[1])

    const file = new File(['png'], 'evidence.png', { type: 'image/png' })
    fireEvent.change(screen.getAllByLabelText('Upload image file')[1], {
      target: { files: [file] },
    })

    expect(onUploadImage).toHaveBeenCalledTimes(1)
    const upload = onUploadImage.mock.calls[0]?.[0]
    expect(upload?.file).toBe(file)
    expect(upload?.editor.id).toBe('second-editor')
    expect(upload?.insertionRange).toBeInstanceOf(Range)
  })
})
