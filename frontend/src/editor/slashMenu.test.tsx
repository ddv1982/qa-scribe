import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import editorStyles from '../styles/editor.css?raw'
import { FormatToolbar } from './FormatToolbar'
import { RichTextEditor } from './RichTextEditor'
import { richEditorDocumentFromHtml, richEditorDocumentToHtml, type RichEditorDocument } from './editorDocument'
import { richEditorControllerForId } from './richEditorRegistry'

beforeAll(() => {
  // jsdom has no layout; ProseMirror and Floating UI measure ranges and elements.
  const rect = { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  const rects = { 0: rect, length: 1, item: () => rect, [Symbol.iterator]: function* () { yield rect } } as unknown as DOMRectList
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => rects })
  Object.defineProperty(Text.prototype, 'getClientRects', { configurable: true, value: () => rects })
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await new Promise((resolve) => setTimeout(resolve, 1))
})

const allLabels = [
  'Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6',
  'Bulleted list', 'Numbered list', 'Checklist', 'Table', 'Code block', 'Quote',
  'Note panel', 'Info panel', 'Success panel', 'Warning panel', 'Error panel', 'Divider', 'Image',
]

async function renderEditor(html = '<p>Evidence</p>', { upload = true } = {}) {
  const onChange = vi.fn<(value: RichEditorDocument) => void>()
  render(
    <>
      <FormatToolbar editorId="editor-one" onUploadImage={upload ? vi.fn() : undefined} />
      <RichTextEditor editorId="editor-one" value={richEditorDocumentFromHtml(html)} onChange={onChange} />
    </>,
  )
  const editor = await screen.findByRole('textbox', { name: 'Note body' })
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Bold' }).disabled).toBe(false))
  return { editor, html: () => richEditorDocumentToHtml(onChange.mock.lastCall?.[0] ?? richEditorDocumentFromHtml(html)) }
}

/** Puts the caret at the end of the first text block whose text is `text`, then types `typed`. */
function typeAt(text: string, typed: string) {
  const editor = richEditorControllerForId('editor-one')?.editor
  if (!editor) throw new Error('editor missing')
  let end = -1
  editor.state.doc.descendants((node, position) => {
    if (end < 0 && node.isTextblock && node.textContent === text) end = position + 1 + node.content.size
  })
  if (end < 0) throw new Error(`no block reads ${text}`)
  act(() => {
    editor.chain().focus().setTextSelection(end).insertContent(typed).run()
  })
}

const options = async () => within(await screen.findByRole('listbox', { name: 'Insert block' })).getAllByRole('option')
/** An option of the slash menu; the Block style select has options of the same names. */
const option = (name: string) => within(screen.getByRole('listbox', { name: 'Insert block' })).getByRole('option', { name })
const press = (editor: HTMLElement, key: string) => act(() => void fireEvent.keyDown(editor, { key }))

describe('slash menu', () => {
  it('lists every block by name and points the editor at the highlighted option', async () => {
    const { editor } = await renderEditor('<p>Evidence</p><p></p>')
    typeAt('', '/')
    const listed = await options()
    expect(listed.map((option) => option.textContent)).toEqual(allLabels)
    expect(listed[0]).toHaveAttribute('aria-selected', 'true')
    expect(option('Warning panel')).toBeInTheDocument()
    expect(editor).toHaveAttribute('aria-controls', screen.getByRole('listbox').id)
    expect(editor).toHaveAttribute('aria-activedescendant', listed[0].id)
    expect(editor).toHaveAttribute('aria-autocomplete', 'list')
  })

  it('layers the positioned menu above sticky headers', async () => {
    render(<style>{editorStyles}</style>)
    await renderEditor('<p>Evidence</p><p></p>')
    typeAt('', '/')
    const list = await screen.findByRole('listbox', { name: 'Insert block' })
    const wrapper = list.parentElement!
    await waitFor(() => expect(getComputedStyle(wrapper).position).toBe('absolute'))
    expect(Number(getComputedStyle(wrapper).zIndex)).toBeGreaterThan(2)
  })

  it('moves the highlight with ArrowDown and ArrowUp, wrapping at both ends', async () => {
    const { editor } = await renderEditor('<p>Evidence</p><p></p>')
    typeAt('', '/')
    await options()
    press(editor, 'ArrowDown')
    expect(option('Heading 2')).toHaveAttribute('aria-selected', 'true')
    expect(editor).toHaveAttribute('aria-activedescendant', option('Heading 2').id)
    press(editor, 'ArrowUp')
    press(editor, 'ArrowUp')
    expect(option('Image')).toHaveAttribute('aria-selected', 'true')
    press(editor, 'ArrowDown')
    expect(option('Heading 1')).toHaveAttribute('aria-selected', 'true')
  })

  it('filters by the typed query and inserts the highlighted block with Enter', async () => {
    const { editor, html } = await renderEditor('<p>Gateway declined</p><p></p>')
    typeAt('', '/warn')
    await waitFor(async () => expect((await options()).map((option) => option.textContent)).toEqual(['Warning panel']))
    press(editor, 'Enter')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    // The editor keeps an empty paragraph after a last block that is not one.
    expect(html()).toBe('<p>Gateway declined</p><aside data-panel="warning"><p></p></aside><p></p>')
    expect(editor).not.toHaveAttribute('aria-activedescendant')
    expect(editor).not.toHaveAttribute('aria-controls')
  })

  it('inserts with Tab, deleting the query, and matches keywords such as h2', async () => {
    const { editor, html } = await renderEditor('<p>Evidence</p><p></p>')
    typeAt('', '/h2')
    await waitFor(async () => expect((await options()).map((option) => option.textContent)).toEqual(['Heading 2']))
    press(editor, 'Tab')
    await waitFor(() => expect(html()).toBe('<p>Evidence</p><h2></h2><p></p>'))
  })

  it('closes with Escape and leaves the typed text', async () => {
    const { editor, html } = await renderEditor('<p>Evidence</p><p></p>')
    typeAt('', '/qu')
    await options()
    press(editor, 'Escape')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(html()).toBe('<p>Evidence</p><p>/qu</p>')
    expect(editor).not.toHaveAttribute('aria-activedescendant')
  })

  it('offers only Image in a table cell, and nothing without an upload flow', async () => {
    const table = '<table><tbody><tr><th><p>Head</p></th></tr><tr><td><p>Cell</p></td></tr></tbody></table>'
    await renderEditor(table)
    typeAt('Cell', ' /')
    expect((await options()).map((option) => option.textContent)).toEqual(['Image'])
    cleanup()
    await new Promise((resolve) => setTimeout(resolve, 1))
    await renderEditor(table, { upload: false })
    typeAt('Cell', ' /')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it.each([
    ['Enter', 'Cell'],
    ['Tab', 'Head'],
    ['Escape', 'Cell'],
  ])('handles %s in a table at %s before table shortcuts', async (key, cell) => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    const { editor, html } = await renderEditor('<table><tbody><tr><th><p>Head</p></th></tr><tr><td><p>Cell</p></td></tr></tbody></table>')
    typeAt(cell, ' /')
    expect((await options()).map((option) => option.textContent)).toEqual(['Image'])
    press(editor, key)
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    if (key === 'Escape') {
      expect(click).not.toHaveBeenCalled()
      expect(html()).toContain(`${cell} /</p>`)
    } else {
      expect(click).toHaveBeenCalledTimes(1)
      expect(click.mock.contexts[0]).toBe(screen.getByLabelText('Upload image file'))
      expect(html()).not.toContain(`${cell} /`)
    }
    expect(html()).not.toContain('<br')
  })

  it('opens the toolbar upload flow from Image', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    const { editor, html } = await renderEditor('<p>Evidence</p><p></p>')
    typeAt('', '/image')
    await waitFor(async () => expect((await options()).map((option) => option.textContent)).toEqual(['Image']))
    press(editor, 'Enter')
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(click.mock.contexts[0]).toBe(screen.getByLabelText('Upload image file'))
    expect(html()).toBe('<p>Evidence</p><p></p>')
    click.mockRestore()
  })

  it('stays closed in a code block', async () => {
    await renderEditor('<pre><code>GET</code></pre>')
    typeAt('GET', ' /')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
