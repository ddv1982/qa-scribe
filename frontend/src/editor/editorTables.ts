/**
 * Tables in the shared editor are GFM tables: the first row is the header row, every row has the
 * same number of cells, no cell spans rows or columns, and each cell holds one paragraph of inline
 * content. Anything read from HTML or pasted is brought into that shape, so every table has a
 * Markdown form the Rust parser reads back (see docs/test-runs-editor-logs-plan.md, Phase 3).
 */
import { Extension, type JSONContent } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { DOMParser as ProseMirrorDOMParser, Fragment, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

// Spans are kept as attributes because the table commands read them, but they are always 1.
const cellAttributes = () => ({
  colspan: { default: 1, parseHTML: () => 1, rendered: false },
  rowspan: { default: 1, parseHTML: () => 1, rendered: false },
  colwidth: { default: null, parseHTML: () => null, rendered: false },
})

const singleParagraphCell = (tag: 'td' | 'th') => ({
  content: 'paragraph',
  addAttributes: cellAttributes,
  parseHTML: () => [{ tag, getContent: (node: Node, schema: Schema) => cellParagraph(node, schema) }],
  renderHTML: () => [tag, 0] as const,
})

/** Every block a pasted cell holds becomes one line of its single paragraph. */
function cellParagraph(element: Node, schema: Schema): Fragment {
  const parsed = ProseMirrorDOMParser.fromSchema(schema).parse(element)
  const inline: ProseMirrorNode[] = []
  parsed.descendants((node) => {
    if (!node.isTextblock) return true
    const lines: ProseMirrorNode[] = []
    node.forEach((child) => {
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
  return Fragment.from(schema.nodes.paragraph.create(null, inline))
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
      return [...(this.parent?.() ?? []), headerRowPlugin()]
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
