/** Block styles shared by the toolbar's Block style control and the slash menu. */
import type { Editor, Range } from '@tiptap/core'
import type { NodeRange } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { liftTarget } from '@tiptap/pm/transform'

export const headingLevels = [1, 2, 3, 4, 5, 6] as const

export const blockStyles = [
  { value: 'p', label: 'Normal' },
  ...headingLevels.map((level) => ({ value: `h${level}`, label: `Heading ${level}` })),
  { value: 'codeBlock', label: 'Code block' },
  { value: 'blockquote', label: 'Quote' },
]

export function currentBlockStyle(editor: Editor | null): string {
  if (!editor) return 'p'
  const level = headingLevels.find((candidate) => editor.isActive('heading', { level: candidate }))
  if (level) return `h${level}`
  if (editor.isActive('codeBlock')) return 'codeBlock'
  if (editor.isActive('blockquote')) return 'blockquote'
  return 'p'
}

/** Sets the selected blocks' style; a `range`, such as the slash menu's query, is deleted first. */
export function setBlockStyle(editor: Editor | null, value: string, range?: Range) {
  if (!editor) return
  const chain = editor.chain().focus()
  if (range) chain.deleteRange(range)
  const level = headingLevels.find((candidate) => value === `h${candidate}`)
  // A heading leaves every quote and list around it, so the splitter sees it as a case heading;
  // a code block leaves every quote. A range over several blocks has no lift target, so several
  // selected blocks are first cleared, each lifted on its own; one block lifts alone, which keeps
  // the wrappers around its untouched siblings.
  const toRoot = liftUntil((range) => range.depth === 0)
  if (level && selectedTextblocks(editor) > 1) chain.clearNodes().command(toRoot).setNode('heading', { level }).run()
  else if (level) chain.command(toRoot).setNode('heading', { level }).run()
  else if (value === 'codeBlock') chain.command(liftUntil((range) => !hasAncestor(range, 'blockquote'))).setCodeBlock().run()
  else if (value === 'blockquote') chain.clearNodes().setBlockquote().run()
  else chain.clearNodes().setParagraph().run()
}

function selectedTextblocks(editor: Editor): number {
  const { doc, selection } = editor.state
  let count = 0
  doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isTextblock) count += 1
    return !node.isTextblock
  })
  return count
}

// Lifts the selected blocks one wrapper at a time until `done` holds. Each lift moves the range
// to a lower depth and a range that cannot be lifted ends the loop, so it always stops.
function liftUntil(done: (range: NodeRange) => boolean) {
  return ({ tr }: { tr: Transaction }) => {
    for (;;) {
      const range = tr.selection.$from.blockRange(tr.selection.$to)
      if (!range || done(range)) return true
      const target = liftTarget(range)
      if (target === null) return true
      tr.lift(range, target)
    }
  }
}

function hasAncestor(range: NodeRange, typeName: string): boolean {
  for (let depth = range.depth; depth > 0; depth -= 1) if (range.$from.node(depth).type.name === typeName) return true
  return false
}
