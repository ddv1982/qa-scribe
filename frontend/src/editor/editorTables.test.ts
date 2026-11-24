import { Editor, type JSONContent } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import { afterEach, describe, expect, it } from 'vitest'
import { richEditorDocumentFromHtml, richEditorDocumentToHtml, type RichEditorDocument } from './editorDocument'
import { richTextEditorExtensions } from './editorExtensions'
import { normalizeEditorHtml } from './editorHtml'
import { managedAttachmentProtocol } from './htmlUtils'

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

  // A cell ends its block, so inline code ending a cell keeps its edge spaces, with or without a paragraph.
  it('keeps the spaces of inline code that ends a cell', () => {
    const html = '<table><tr><th><p>Run <code> a b </code></p></th><td><code>x  </code></td></tr><tr><td><code>  y</code><br>next</td><td>z <code> w </code><br></td></tr></table>'
    expect(richEditorDocumentFromHtml(html).doc.content).toEqual([table(
      row(header(text('Run '), text(' a b ', 'code')), header(text('x  ', 'code'))),
      row(cell(text('  y', 'code'), { type: 'hardBreak' }, text('next')), cell(text('z '), text(' w ', 'code'), { type: 'hardBreak' })),
    )])
  })

  it('pastes inline code in a cell with its spaces, as reading the HTML keeps them', () => {
    const html = '<table><tr><th><p>Run <code> a  b </code></p></th><td><code>x  </code></td></tr><tr><td><code>  y</code><br>next</td><td>z <code> w </code><br></td></tr></table>'
    const expected = table(
      row(header(text('Run '), text(' a  b ', 'code')), header(text('x  ', 'code'))),
      row(cell(text('  y', 'code'), { type: 'hardBreak' }, text('next')), cell(text('z '), text(' w ', 'code'), { type: 'hardBreak' })),
    )
    expect(richEditorDocumentFromHtml(html).doc.content).toEqual([expected])
    expect(paste(html).find((node) => node.type === 'table')).toEqual(expected)
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

describe('pasting at a caret inside a cell', () => {
  const abcXyz = '<table><tbody><tr><th><p>abc</p></th><th><p>xyz</p></th></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></tbody></table>'
  const hardBreak = { type: 'hardBreak' }

  function editorAtAbc(offset: number): Editor {
    editor = new Editor({ extensions: richTextEditorExtensions(), content: abcXyz })
    // Position 4 is the start of "abc": table, row, header cell and paragraph each open one level.
    editor.commands.setTextSelection(4 + offset)
    return editor
  }

  it('inserts lines of plain text as lines of that cell', () => {
    editorAtAbc(1).view.pasteText('X\nY', new Event('paste') as ClipboardEvent)
    expect(editor!.getJSON().content?.[0]).toEqual(table(
      row(header(text('aX'), hardBreak, text('Ybc')), header(text('xyz'))),
      row(cell(text('1')), cell(text('2'))),
    ))
  })

  it('inserts HTML paragraphs as lines of that cell', () => {
    editorAtAbc(1).view.pasteHTML('<p>X</p><p><strong>Y</strong></p>', new Event('paste') as ClipboardEvent)
    expect(editor!.getJSON().content?.[0]).toEqual(table(
      row(header(text('aX'), hardBreak, text('Y', 'bold'), text('bc')), header(text('xyz'))),
      row(cell(text('1')), cell(text('2'))),
    ))
  })

  // Whole paragraphs copied from an editor carry closed ends, which would split the table.
  it('inserts whole paragraphs copied from an editor as lines of that cell', () => {
    editorAtAbc(1).view.pasteHTML('<p data-pm-slice="0 0 []">X</p><p>Y</p>', new Event('paste') as ClipboardEvent)
    expect(editor!.getJSON().content?.filter((node) => node.type === 'table')).toEqual([
      table(row(header(text('aX'), hardBreak, text('Ybc')), header(text('xyz'))), row(cell(text('1')), cell(text('2')))),
    ])
  })

  const image = { type: 'image', attrs: expect.objectContaining({ attachmentId: 'shot-1', alt: 'shot' }) as Record<string, unknown> }
  const shotHtml = `<img src="${managedAttachmentProtocol}shot-1" alt="shot">`
  const untouched = table(row(header(text('abc')), header(text('xyz'))), row(cell(text('1')), cell(text('2'))))

  // A cell holds no image, so a pasted image goes after the table, as an uploaded one does.
  it('puts a pasted image after the table and leaves selected cell text in place', () => {
    editorAtAbc(1).commands.setTextSelection({ from: 5, to: 6 })
    editor!.view.pasteHTML(shotHtml, new Event('paste') as ClipboardEvent)
    expect(editor!.getJSON().content?.slice(0, 2)).toEqual([untouched, image])
  })

  it('pastes the text of mixed content in the cell and its images after the table', () => {
    editorAtAbc(1).view.pasteHTML(`<p>X</p>${shotHtml}<p>Y</p>`, new Event('paste') as ClipboardEvent)
    expect(editor!.getJSON().content?.slice(0, 2)).toEqual([
      table(row(header(text('aX'), hardBreak, text('Ybc')), header(text('xyz'))), row(cell(text('1')), cell(text('2')))),
      image,
    ])
  })

  // jsdom has no layout, so the drop lands where posAtCoords says: between "a" and "bc".
  function dropHtml(html: string): void {
    editor!.view.posAtCoords = () => ({ pos: 5, inside: -1 })
    const drop = Object.assign(new Event('drop', { bubbles: true, cancelable: true }), {
      clientX: 0,
      clientY: 0,
      dataTransfer: { getData: (type: string) => (type === 'text/html' ? html : ''), types: ['text/html'] },
    })
    editor!.view.dom.dispatchEvent(drop)
  }

  function selectBodyCells(): void {
    const cells: number[] = []
    editor!.state.doc.descendants((node, position) => void (node.type.name === 'tableCell' && cells.push(position)))
    editor!.view.dispatch(editor!.state.tr.setSelection(CellSelection.create(editor!.state.doc, cells[0], cells[1])))
  }

  it('puts an image dropped from outside the editor after the table', () => {
    editorAtAbc(0)
    dropHtml(shotHtml)
    expect(editor!.getJSON().content?.slice(0, 2)).toEqual([untouched, image])
  })

  // The drop lands at its own position, so selected cells elsewhere do not change how it is read.
  it('drops lines into the target cell while other cells are selected', () => {
    editorAtAbc(0)
    selectBodyCells()
    dropHtml('<p>X</p><p>Y</p>')
    expect(editor!.getJSON().content?.[0]).toEqual(table(row(header(text('aX'), hardBreak, text('Ybc')), header(text('xyz'))), row(cell(text('1')), cell(text('2')))))
  })

  it('drops mixed text and images into the target cell and after the table while other cells are selected', () => {
    editorAtAbc(0)
    selectBodyCells()
    dropHtml(`<p>X</p>${shotHtml}<p>Y</p>`)
    expect(editor!.getJSON().content?.slice(0, 2)).toEqual([
      table(row(header(text('aX'), hardBreak, text('Ybc')), header(text('xyz'))), row(cell(text('1')), cell(text('2')))),
      image,
    ])
  })

  it('still pastes a table over the cells from the caret on', () => {
    editorAtAbc(1).view.pasteHTML('<table><tr><td>X</td><td>Y</td></tr></table>', new Event('paste') as ClipboardEvent)
    expect(editor!.getJSON().content?.[0]).toEqual(table(
      row(header(text('X')), header(text('Y'))),
      row(cell(text('1')), cell(text('2'))),
    ))
  })
})

describe('pasting into selected cells', () => {
  // prosemirror-tables pastes each line of text into one of the selected cells.
  it('puts each line of pasted text in the next selected cell', () => {
    editor = new Editor({ extensions: richTextEditorExtensions(), content: '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>' })
    const cells: number[] = []
    editor.state.doc.descendants((node, position) => void (node.type.name === 'tableCell' && cells.push(position)))
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0], cells[1])))
    editor.view.pasteText('Pass\nFail', new Event('paste') as ClipboardEvent)
    expect(editor.getJSON().content?.[0]).toEqual(table(row(header(text('A')), header(text('B'))), row(cell(text('Pass')), cell(text('Fail')))))
  })
})
