import type { JSONContent } from '@tiptap/core'
import type { RefinementProposal, TestCaseVisual } from '../bindings'
import { parseRichEditorDocument } from '../editor/editorDocument'

function text(node: JSONContent | undefined): string {
  return node?.text ?? node?.content?.map(text).join('') ?? ''
}

/** Where a visual lands: the nearest heading above the target and the target's own text or image name. */
export function placement(proposal: RefinementProposal, visual: TestCaseVisual) {
  const document = parseRichEditorDocument(proposal.before.documentJson)
  const top = document?.doc.content ?? []
  const [index, ...nested] = visual.target
  const heading = top.slice(0, index + 1).reverse().find(node => node.type === 'heading')
  const target = nested.reduce<JSONContent | undefined>((node, part) => node?.content?.[part], top[index])
  const label = target?.type === 'image' ? target.attrs?.alt as unknown : text(target)
  const names = [...new Set([text(heading), typeof label === 'string' ? label : ''].filter(Boolean))]
  return names.join(' · ').slice(0, 220)
}
