import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FormatToolbar } from './FormatToolbar'
import { RichTextEditor } from './RichTextEditor'
import { richEditorDocumentFromHtml, richEditorDocumentToHtml, type RichEditorDocument } from './editorDocument'

beforeAll(() => {
  // jsdom has no layout; ProseMirror measures ranges when it scrolls the selection into view.
  const rect = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  const rects = { 0: rect, length: 1, item: () => rect, [Symbol.iterator]: function* () { yield rect } } as unknown as DOMRectList
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => rects })
  Object.defineProperty(Text.prototype, 'getClientRects', { configurable: true, value: () => rects })
})

afterEach(async () => {
  cleanup()
  // TipTap defers destruction by 1ms to tolerate React remounts.
  await new Promise((resolve) => setTimeout(resolve, 1))
})

async function renderEditor(html = '<p>Evidence</p>') {
  const onChange = vi.fn<(value: RichEditorDocument) => void>()
  render(
    <>
      <FormatToolbar editorId="editor-one" />
      <RichTextEditor editorId="editor-one" value={richEditorDocumentFromHtml(html)} onChange={onChange} />
    </>,
  )
  const editor = await screen.findByRole('textbox', { name: 'Note body' })
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Bold' }).disabled).toBe(false))
  return { editor, html: () => richEditorDocumentToHtml(onChange.mock.lastCall?.[0] ?? richEditorDocumentFromHtml(html)) }
}

function selectText(editor: HTMLElement) {
  editor.focus()
  const textNode = editor.querySelector('p, h1, h2, h3, h4, h5, h6, pre code')?.firstChild
  if (!textNode) throw new Error('editor text missing')
  const range = document.createRange()
  range.selectNodeContents(textNode)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  fireEvent.mouseUp(editor)
}

function chooseBlockStyle(value: string) {
  const select = screen.getByRole('combobox', { name: 'Block style' })
  fireEvent.mouseDown(select)
  fireEvent.focus(select)
  fireEvent.change(select, { target: { value } })
}

describe('FormatToolbar', () => {
  it('offers Normal, six heading levels, code block and quote as block styles', async () => {
    await renderEditor()
    const options = Array.from(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Block style' }).options).map((option) => option.text)
    expect(options).toEqual(['Normal', 'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6', 'Code block', 'Quote'])
  })

  it.each([
    ['h1', '<h1>Evidence</h1>'],
    ['h4', '<h4>Evidence</h4>'],
    ['h6', '<h6>Evidence</h6>'],
    ['codeBlock', '<pre><code>Evidence</code></pre>'],
    ['blockquote', '<blockquote><p>Evidence</p></blockquote>'],
  ])('sets the %s block style and shows it as the current style', async (value, expected) => {
    const { editor, html } = await renderEditor()
    selectText(editor)
    chooseBlockStyle(value)
    // StarterKit's trailing node keeps an empty paragraph after the last block.
    await waitFor(() => expect(html()).toBe(`${expected}<p></p>`))
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Block style' }).value).toBe(value)
  })

  it('returns a heading to Normal', async () => {
    const { editor, html } = await renderEditor('<h5>Evidence</h5>')
    selectText(editor)
    chooseBlockStyle('p')
    await waitFor(() => expect(html()).toBe('<p>Evidence</p><p></p>'))
  })

  it.each([
    ['Numbered list', '<ol><li><p>Evidence</p></li></ol>'],
    ['Strikethrough', '<p><s>Evidence</s></p>'],
    ['Inline code', '<p><code>Evidence</code></p>'],
  ])('applies %s to the selection', async (label, expected) => {
    const { editor, html } = await renderEditor()
    selectText(editor)
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(html()).toMatch(new RegExp(`^${expected}`)))
    expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true')
  })

  it('inserts a divider', async () => {
    const { editor, html } = await renderEditor()
    selectText(editor)
    fireEvent.click(screen.getByRole('button', { name: 'Divider' }))
    await waitFor(() => expect(html()).toContain('<hr>'))
  })

  it('keeps the editor selection when a new command button is pressed', async () => {
    await renderEditor()
    for (const label of ['Numbered list', 'Strikethrough', 'Inline code', 'Divider']) {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      screen.getByRole('button', { name: label }).dispatchEvent(event)
      expect(event.defaultPrevented, label).toBe(true)
    }
  })
})
