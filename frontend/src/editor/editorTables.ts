/**
 * Tables in the shared editor are GFM tables: the first row is the header row, every row has the
 * same number of cells, no cell spans rows or columns, and each cell holds one paragraph of inline
 * content. Anything read from HTML or pasted is brought into that shape, so every table has a
 * Markdown form the Rust parser reads back (see docs/test-runs-editor-logs-plan.md, Phase 3).
 */
import { Extension, type JSONContent } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { DOMParser as ProseMirrorDOMParser, Fragment, Slice, type Node as ProseMirrorNode, type ParseOptions, type ResolvedPos, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state'
import { CellSelection } from '@tiptap/pm/tables'
import type { EditorView } from '@tiptap/pm/view'
import { keepInlineCodeSpaces } from './inlineCodeSpaces'

// Spans are kept as attributes because the table commands read them, but they are always 1.
const cellAttributes = () => ({
  colspan: { default: 1, parseHTML: () => 1, rendered: false },
  rowspan: { default: 1, parseHTML: () => 1, rendered: false },
  colwidth: { default: null, parseHTML: () => null, rendered: false },
})

const singleParagraphCell = (tag: 'td' | 'th') => ({
  content: 'paragraph',
  addAttributes: cellAttributes,
  parseHTML: () => [{ tag, getContent: (node: Node, schema: Schema) => Fragment.from(cellContent(node, schema).line) }],
  renderHTML: () => [tag, 0] as const,
})

/**
 * Every block a pasted cell holds becomes one line of its single paragraph, and its images, which
 * a cell cannot hold, are returned beside it. Inline code keeps its spaces, as when the editor
 * reads HTML, whether the cell is read, pasted or copied.
 */
function cellContent(element: Node, schema: Schema, preserveWhitespace?: ParseOptions['preserveWhitespace']): { line: ProseMirrorNode; images: ProseMirrorNode[] } {
  const copy = element.cloneNode(true)
  const guard = copy instanceof Element ? keepInlineCodeSpaces(copy) : null
  const parsed = ProseMirrorDOMParser.fromSchema(schema).parse(copy, { preserveWhitespace })
  const inline: ProseMirrorNode[] = []
  const images: ProseMirrorNode[] = []
  parsed.descendants((node) => {
    if (node.type.name === 'image') images.push(node)
    if (!node.isTextblock) return true
    const lines: ProseMirrorNode[] = []
    node.forEach((child) => {
      if (guard && child.isText) {
        const text = (child.text ?? '').replaceAll(guard, '')
        if (!text) return
        child = schema.text(text, child.marks)
      }
      if (!node.type.spec.code || !child.isText) return void lines.push(child)
      ;(child.text ?? '').split('\n').forEach((line, index) => {
        if (index > 0) lines.push(schema.nodes.hardBreak.create())
        if (line) lines.push(schema.text(line))
      })
    })
    if (lines.length === 0) return false
    if (inline.length > 0) inline.push(schema.nodes.hardBreak.create())
    inline.push(...lines)
    return false
  })
  return { line: schema.nodes.paragraph.create(null, inline), images }
}

/**
 * Clipboard content without a table, pasted or dropped in a cell, becomes lines of that cell,
 * followed by its images for `insertInCell` to put after the table. Parsed as blocks, ProseMirror
 * would wrap each block in a cell of its own to fit the row, and the table paste would then write
 * them over the cells from the caret on. Content with a table still fills cells, and so do blocks
 * pasted over selected cells, one block per cell, as prosemirror-tables pastes them. A drop lands
 * at its own position whatever the selection, so it never fills selected cells.
 */
class TableClipboardParser extends ProseMirrorDOMParser {
  /** Set by the drop event, which ProseMirror reads synchronously, until the next microtask. */
  dropping = false

  constructor(schema: Schema, private readonly selection: () => Selection) {
    super(schema, ProseMirrorDOMParser.fromSchema(schema).rules)
  }

  override parseSlice(dom: Node, options: ParseOptions = {}): Slice {
    const fillsSelectedCells = !this.dropping && this.selection() instanceof CellSelection
    if (!options.context || !inTableCell(options.context) || holdsTable(dom) || fillsSelectedCells) return super.parseSlice(dom, options)
    const { line, images } = cellContent(dom, this.schema, options.preserveWhitespace)
    return images.length === 0 ? new Slice(Fragment.from(line), 1, 1) : new Slice(Fragment.from([line, ...images]), 1, 0)
  }
}

/**
 * Pasted or dropped between `from` and `to` in a cell, a paragraph's lines join the cell's line
 * and images go after the table, as an uploaded image does. ProseMirror would split the table
 * around either: whole paragraphs copied from an editor keep closed ends after parsing, and a
 * cell holds no image. Images alone leave the cell as it was.
 */
function insertInCell(view: EditorView, from: number, to: number, slice: Slice, uiEvent: 'paste' | 'drop'): boolean {
  const nodes: ProseMirrorNode[] = []
  slice.content.forEach((node) => void nodes.push(node))
  const line = nodes[0]?.type.name === 'paragraph' ? nodes[0] : null
  const images = nodes.slice(line ? 1 : 0)
  const closedLine = line !== null && images.length === 0 && (slice.openStart === 0 || slice.openEnd === 0)
  const $from = view.state.doc.resolve(from)
  const afterTable = positionAfterTable($from)
  if (afterTable === null || !inTableCell($from) || (!closedLine && images.length === 0) || images.some((node) => node.type.name !== 'image')) return false
  const tr = view.state.tr
  if (line && line.content.size > 0) {
    tr.replace(from, to, new Slice(Fragment.from(line), 1, 1))
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(to)))
  }
  const at = tr.mapping.map(afterTable)
  tr.insert(at, images)
  if (!line?.content.size) tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(at)), -1))
  view.dispatch(tr.scrollIntoView().setMeta('paste', uiEvent === 'paste').setMeta('uiEvent', uiEvent))
  return true
}

function pasteInCell(view: EditorView, _event: ClipboardEvent, slice: Slice): boolean {
  const { selection } = view.state
  return selection instanceof TextSelection && insertInCell(view, selection.from, selection.to, slice, 'paste')
}

/** A drop that moves content within the editor is left to ProseMirror, which deletes the source. */
function dropInCell(view: EditorView, event: DragEvent, slice: Slice, moved: boolean): boolean {
  const target = moved ? null : view.posAtCoords({ left: event.clientX, top: event.clientY })
  return target !== null && insertInCell(view, target.pos, target.pos, slice, 'drop')
}

/** The position after the table around `$position`, where content a cell cannot hold goes. */
export function positionAfterTable($position: ResolvedPos): number | null {
  for (let depth = $position.depth; depth > 0; depth -= 1) if ($position.node(depth).type.name === 'table') return $position.after(depth)
  return null
}

function inTableCell($position: ResolvedPos): boolean {
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const role: unknown = $position.node(depth).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') return true
  }
  return false
}

function holdsTable(dom: Node): boolean {
  const tableTags = 'table, tr, td, th'
  return dom instanceof Element && (dom.matches(tableTags) || dom.querySelector(tableTags) !== null)
}

const headerRowKey = new PluginKey('tableHeaderRow')

/** Keeps the first row of every table a header row and every other row a body row. */
const headerRowPlugin = () => new Plugin({
  key: headerRowKey,
  appendTransaction(transactions, _oldState, state) {
    if (!transactions.some((transaction) => transaction.docChanged)) return null
    const { tableHeader, tableCell } = state.schema.nodes
    const tr = state.tr
    state.doc.descendants((node, position) => {
      if (node.type.name !== 'table') return true
      node.forEach((row, rowOffset, rowIndex) => {
        const expected = rowIndex === 0 ? tableHeader : tableCell
        row.forEach((cell, cellOffset) => {
          if (cell.type !== expected) tr.setNodeMarkup(position + 1 + rowOffset + 1 + cellOffset, expected, cell.attrs)
        })
      })
      return false
    })
    return tr.docChanged ? tr : null
  },
})

export const editorTableExtensions = [
  Table.extend({
    renderHTML: () => ['table', ['tbody', 0]],
    addProseMirrorPlugins() {
      const { editor } = this
      const clipboardParser = new TableClipboardParser(editor.schema, () => editor.state.selection)
      const markDrop = () => {
        clipboardParser.dropping = true
        queueMicrotask(() => void (clipboardParser.dropping = false))
        return false
      }
      const props = { clipboardParser, handlePaste: pasteInCell, handleDrop: dropInCell, handleDOMEvents: { drop: markDrop } }
      return [...(this.parent?.() ?? []), headerRowPlugin(), new Plugin({ props })]
    },
  }),
  TableRow,
  TableHeader.extend(singleParagraphCell('th')),
  TableCell.extend(singleParagraphCell('td')),
  // A cell holds one paragraph, so Enter starts a new line in it.
  Extension.create({
    name: 'tableCellEnter',
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        Enter: () => (this.editor.isActive('tableCell') || this.editor.isActive('tableHeader')) && this.editor.commands.setHardBreak(),
      }
    },
  }),
]

const spans = { colspan: 1, rowspan: 1, colwidth: null }

/**
 * The JSON form of the same shape, for documents that never passed through an editor view: HTML
 * read with `generateJSON`, Markdown parsed in Rust, or stored JSON.
 */
export function normalizeTableJson(table: JSONContent): JSONContent | null {
  const rows = (table.content ?? []).filter((row) => row.type === 'tableRow')
  if (rows.length === 0) return null
  const width = Math.max(1, ...rows.map((row) => (row.content ?? []).length))
  return {
    type: 'table',
    content: rows.map((row, rowIndex) => {
      const type = rowIndex === 0 ? 'tableHeader' : 'tableCell'
      const cells = row.content ?? []
      return {
        type: 'tableRow',
        content: Array.from({ length: width }, (_, index) => ({ type, attrs: spans, content: [jsonCellParagraph(cells[index])] })),
      }
    }),
  }
}

function jsonCellParagraph(cell: JSONContent | undefined): JSONContent {
  const lines = (cell?.content ?? []).map((block) => block.content ?? []).filter((line) => line.length > 0)
  const content = lines.flatMap((line, index) => (index === 0 ? line : [{ type: 'hardBreak' }, ...line]))
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}
