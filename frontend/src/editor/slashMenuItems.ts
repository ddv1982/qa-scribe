/**
 * What the slash menu inserts. Each item runs the same command as the toolbar, after deleting the
 * typed `/query`. Inside a table cell, which holds one paragraph, only Image is offered: it goes
 * after the table, as the toolbar's upload does, and every block would split the table.
 */
import type { Editor, Range } from '@tiptap/core'
import {
  CircleCheck,
  CircleX,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImageIcon,
  Info,
  List,
  ListChecks,
  ListOrdered,
  SeparatorHorizontal,
  SquareCode,
  StickyNote,
  Table,
  TextQuote,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { headingLevels, setBlockStyle } from './blockStyles'
import { panelLabels, type PanelKind } from './editorPanels'
import { imageUploadRequestForId } from './richEditorRegistry'

export type SlashMenuItem = {
  id: string
  label: string
  icon: LucideIcon
  /** Other words the query matches, such as `h2` or `todo`. */
  keywords: string[]
  run: (editor: Editor, range: Range) => void
}

const headingIcons = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6]
const panelIcons: Record<PanelKind, LucideIcon> = { note: StickyNote, info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleX }
const panelKeywords: Record<PanelKind, string[]> = { note: [], info: ['important'], success: ['tip'], warning: ['caution'], error: ['danger'] }

const chain = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range)

const blockItems: SlashMenuItem[] = [
  ...headingLevels.map((level) => ({
    id: `heading-${level}`,
    label: `Heading ${level}`,
    icon: headingIcons[level - 1],
    keywords: [`h${level}`],
    run: (editor: Editor, range: Range) => setBlockStyle(editor, `h${level}`, range),
  })),
  { id: 'bulleted-list', label: 'Bulleted list', icon: List, keywords: ['bullet', 'unordered'], run: (editor, range) => chain(editor, range).toggleBulletList().run() },
  { id: 'numbered-list', label: 'Numbered list', icon: ListOrdered, keywords: ['ordered'], run: (editor, range) => chain(editor, range).toggleOrderedList().run() },
  { id: 'checklist', label: 'Checklist', icon: ListChecks, keywords: ['task', 'todo'], run: (editor, range) => chain(editor, range).toggleTaskList().run() },
  {
    id: 'table',
    label: 'Table',
    icon: Table,
    keywords: ['grid'],
    run: (editor, range) => chain(editor, range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  { id: 'code-block', label: 'Code block', icon: SquareCode, keywords: ['pre'], run: (editor, range) => setBlockStyle(editor, 'codeBlock', range) },
  { id: 'quote', label: 'Quote', icon: TextQuote, keywords: ['blockquote'], run: (editor, range) => setBlockStyle(editor, 'blockquote', range) },
  ...(Object.keys(panelLabels) as PanelKind[]).map((kind) => ({
    id: `${kind}-panel`,
    label: `${panelLabels[kind]} panel`,
    icon: panelIcons[kind],
    keywords: ['callout', ...panelKeywords[kind]],
    run: (editor: Editor, range: Range) => chain(editor, range).setPanel(kind).run(),
  })),
  { id: 'divider', label: 'Divider', icon: SeparatorHorizontal, keywords: ['rule', 'line'], run: (editor, range) => chain(editor, range).setHorizontalRule().run() },
]

const imageItem: SlashMenuItem = {
  id: 'image',
  label: 'Image',
  icon: ImageIcon,
  keywords: ['picture', 'screenshot', 'upload'],
  run: (editor, range) => {
    chain(editor, range).run()
    imageUploadRequestForId(editor.view.dom.id)?.()
  },
}

/** The items for `query`: each one with a word of its label or a keyword that starts with it. */
export function slashMenuItems(editor: Editor, query: string): SlashMenuItem[] {
  const inCell = editor.isActive('tableCell') || editor.isActive('tableHeader')
  const canUpload = Boolean(editor.view.dom.id && imageUploadRequestForId(editor.view.dom.id))
  const items = [...(inCell ? [] : blockItems), ...(canUpload ? [imageItem] : [])]
  const typed = query.trim().toLowerCase()
  if (!typed) return items
  return items.filter((item) => [...item.label.toLowerCase().split(' '), ...item.keywords].some((word) => word.startsWith(typed)))
}
