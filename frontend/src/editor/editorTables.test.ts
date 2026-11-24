import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { richEditorDocumentFromHtml, richEditorDocumentToHtml, type RichEditorDocument } from './editorDocument'
import { richTextEditorExtensions } from './editorExtensions'
import { normalizeEditorHtml } from './editorHtml'

const spans = { colspan: 1, rowspan: 1, colwidth: null }
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', ...(content.length ? { content } : {}) })
const text = (value: string, ...marks: string[]): JSONContent => ({ type: 'text', text: value, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) })
const header = (...content: JSONContent[]): JSONContent => ({ type: 'tableHeader', attrs: spans, content: [paragraph(...content)] })
const cell = (...content: JSONContent[]): JSONContent => ({ type: 'tableCell', attrs: spans, content: [paragraph(...content)] })
const row = (...cells: JSONContent[]): JSONContent => ({ type: 'tableRow', content: cells })
const table = (...rows: JSONContent[]): JSONContent => ({ type: 'table', content: rows })
const documentOf = (...content: JSONContent[]): RichEditorDocument => ({ schemaVersion: 1, doc: { type: 'doc', content } })

const twoByTwo = table(row(header(text('Field')), header(text('Value'))), row(cell(text('Card', 'bold')), cell()))
const twoByTwoHtml = '<table><tbody><tr><th><p>Field</p></th><th><p>Value</p></th></tr><tr><td><p><strong>Card</strong></p></td><td><p></p></td></tr></tbody></table>'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function paste(html: string): JSONContent[] {
  editor = new Editor({ extensions: richTextEditorExtensions(), content: '<p></p>' })
  // jsdom has no ClipboardEvent; ProseMirror only needs an event to hand to paste handlers.
  editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent)
  // The editor's own state, not a normalised copy: the editor itself keeps the shape.
  return editor.getJSON().content ?? []
}

describe('editor tables', () => {
  it('writes a table as plain semantic HTML and reads it back from HTML only', () => {
    expect(richEditorDocumentToHtml(documentOf(twoByTwo))).toBe(twoByTwoHtml)
    expect(richEditorDocumentFromHtml(twoByTwoHtml)).toEqual(documentOf(twoByTwo))
  })

  it('keeps table tags and strips colspan, rowspan and every other table attribute', () => {
    const dirty = '<table class="confluenceTable" style="width:100%"><colgroup><col style="width:40px"></colgroup><thead><tr data-x="1"><th colspan="2" rowspan="1" style="text-align:left"><p>Field</p></th></tr></thead><tbody><tr><td rowspan="2" align="right"><p>Card</p></td><td>4111</td></tr></tbody></table>'
    expect(normalizeEditorHtml(dirty)).toBe('<table><thead><tr><th><p>Field</p></th></tr></thead><tbody><tr><td><p>Card</p></td><td>4111</td></tr></tbody></table>')
  })

  it('reads any table as a rectangular table with a header row and one paragraph per cell', () => {
    const ragged = '<table><tr><td><h2>Field</h2><p>name</p></td><td colspan="2">Value</td></tr><tr><th><ul><li>a</li><li><em>b</em></li></ul></th></tr><tr><td></td><td>1</td><td><img src="https://example.com/x.png" alt="x">2</td></tr></table>'
    expect(richEditorDocumentFromHtml(ragged).doc.content).toEqual([table(
      row(header(text('Field'), { type: 'hardBreak' }, text('name')), header(text('Value')), header()),
      row(cell(text('a'), { type: 'hardBreak' }, text('b', 'italic')), cell(), cell()),
      row(cell(), cell(text('1')), cell(text('2'))),
    )])
  })

  it('pastes a table as a rectangular table with a header row and one paragraph per cell', () => {
    const content = paste('<table><tr><td><p>Field</p><p>name</p></td><td>Value</td></tr><tr><td colspan="2">only</td></tr></table>')
    expect(content.find((node) => node.type === 'table')).toEqual(table(
      row(header(text('Field'), { type: 'hardBreak' }, text('name')), header(text('Value'))),
      row(cell(text('only')), cell()),
    ))
  })

  it('starts a new line in the same cell on Enter, since a cell holds one paragraph', () => {
    editor = new Editor({ extensions: richTextEditorExtensions(), content: twoByTwoHtml })
    editor.commands.setTextSelection(6)
    editor.view.someProp('handleKeyDown', (handle) => handle(editor!.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(editor.getJSON().content?.[0]).toEqual(table(
      row(header(text('Fi'), { type: 'hardBreak' }, text('eld')), header(text('Value'))),
      row(cell(text('Card', 'bold')), cell()),
    ))
  })
})
