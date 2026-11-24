import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { confluenceTableHtml, excelTableHtml } from './__fixtures__/pastedTables'
import { richEditorDocumentFromHtml } from './editorDocument'
import { richTextEditorExtensions } from './editorExtensions'

const spans = { colspan: 1, rowspan: 1, colwidth: null }
const br: JSONContent = { type: 'hardBreak' }
const text = (value: string, ...marks: JSONContent['marks'] & object): JSONContent => ({ type: 'text', text: value, ...(marks.length ? { marks } : {}) })
const mark = (type: string) => ({ type })
const cellOf = (type: string) => (...content: JSONContent[]): JSONContent => ({ type, attrs: spans, content: [content.length ? { type: 'paragraph', content } : { type: 'paragraph' }] })
const th = cellOf('tableHeader')
const td = cellOf('tableCell')
const table = (...rows: JSONContent[][]): JSONContent => ({ type: 'table', content: rows.map((content) => ({ type: 'tableRow', content })) })

const confluenceTable = table(
  [th(text('Step', mark('bold'))), th(text('Expected result', mark('bold')))],
  [
    td(text('Open '), text('checkout', { type: 'link', attrs: expect.objectContaining({ href: 'https://example.com/checkout' }) as Record<string, unknown> })),
    td(text('The basket shows'), br, text('one item'), br, text('the '), text('EUR', mark('code')), text(' total')),
  ],
  [td(text('Notes span both columns', mark('italic'))), td()],
)

const excelTable = table(
  [th(text('Case')), th(text('Input')), th(text('Result')), th(text('Remark'))],
  [td(text('TC01')), td(text('1234 AB'), br, text('NL')), td(text('Passed')), td()],
  [td(text('TC02')), td(), td(text('Failed')), td(text('=500'))],
)

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function pastedTable(html: string): JSONContent | undefined {
  editor = new Editor({ extensions: richTextEditorExtensions(), content: '<p></p>' })
  // jsdom has no ClipboardEvent; ProseMirror only needs an event to hand to paste handlers.
  editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent)
  return editor.getJSON().content?.find((node) => node.type === 'table')
}

describe.each([
  ['Confluence', confluenceTableHtml, confluenceTable],
  ['Excel', excelTableHtml, excelTable],
])('a %s table', (_source, html, expected) => {
  it('pastes as a rectangular table with a header row, one paragraph per cell and its inline marks', () => {
    expect(pastedTable(html)).toEqual(expected)
  })

  it('reads the same table from HTML alone', () => {
    expect(richEditorDocumentFromHtml(html).doc.content?.find((node) => node.type === 'table')).toEqual(expected)
  })
})
