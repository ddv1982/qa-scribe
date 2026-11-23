import type { JSONContent } from '@tiptap/core'
import { RichTextEditor } from '../editor/RichTextEditor'
import { serializeRichEditorDocument, type RichEditorDocument } from '../editor/editorDocument'

function sections(document: RichEditorDocument) {
  const groups: JSONContent[][] = [[]]
  for (const node of document.doc.content ?? []) {
    if (node.type === 'heading') groups.push([])
    groups[groups.length - 1].push(node)
  }
  return groups.filter(group => group.length > 0)
}

function excerpt(document: RichEditorDocument, nodes: JSONContent[]): RichEditorDocument {
  return { ...document, doc: { ...document.doc, content: nodes } }
}

export function ChatProposalContent({ before, after }: { before: RichEditorDocument | null; after: RichEditorDocument }) {
  const old = before ? sections(before) : []
  const revised = sections(after)
  const nextKeys = revised.map(group => serializeRichEditorDocument(excerpt(after, group)))
  const oldKeys = before ? old.map(group => serializeRichEditorDocument(excerpt(before, group))) : []
  let start = 0
  while (start < oldKeys.length && start < nextKeys.length && oldKeys[start] === nextKeys[start]) start++
  let oldEnd = oldKeys.length
  let nextEnd = nextKeys.length
  while (oldEnd > start && nextEnd > start && oldKeys[oldEnd - 1] === nextKeys[nextEnd - 1]) {
    oldEnd--
    nextEnd--
  }
  const changedAfter = revised.slice(start, nextEnd)
  const changedBefore = old.slice(start, oldEnd)
  if (!before || !changedBefore.length && !changedAfter.length) {
    return <RichTextEditor value={after} readOnly ariaLabel="Suggested content" />
  }
  return <>
    {changedAfter.length ? <RichTextEditor value={excerpt(after, changedAfter.flat())} readOnly ariaLabel="Suggested sections" /> : null}
    {changedBefore.length ? <details><summary>Previous sections</summary>
      <RichTextEditor value={excerpt(before, changedBefore.flat())} readOnly ariaLabel="Previous sections" />
    </details> : null}
    <details><summary>Full suggestion</summary>
      <RichTextEditor value={after} readOnly ariaLabel="Full suggested content" />
    </details>
  </>
}
