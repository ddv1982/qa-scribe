import type { JSONContent } from '@tiptap/core'
import { normalizeRichEditorDocument, type RichEditorDocument } from '../editor/editorDocument'
import { creationStarter } from '../app/creationFormats'
import { testRunCaseDocument } from '../testware/testRuns'
import type { TestRunCase } from '../tauri'

/**
 * The structured finding starter for a failed test case: its copied content, without the case
 * heading, under Steps to reproduce, and its remark under Actual result. The other sections stay
 * empty, as in the starter. Built on the editor document, so nothing is parsed from HTML.
 */
export function findingFromTestCase(testCase: Pick<TestRunCase, 'bodyJson' | 'remark'>): RichEditorDocument {
  const fills: Record<string, JSONContent[]> = {
    'Steps to reproduce': testRunCaseDocument(testCase).doc.content ?? [],
    'Actual result': testCase.remark ? [{ type: 'paragraph', content: [{ type: 'text', text: testCase.remark }] }] : [],
  }
  const starter = creationStarter({ kind: 'finding', template: 'structured' })
  const content = (starter.doc.content ?? []).flatMap((node, index, nodes): JSONContent[] => {
    const previous = nodes[index - 1]
    const section = previous?.type === 'heading' ? previous.content?.map((child) => child.text ?? '').join('') ?? '' : ''
    const fill = fills[section]
    return fill?.length && node.type === 'paragraph' && !node.content?.length ? fill : [node]
  })
  return normalizeRichEditorDocument({ ...starter, doc: { ...starter.doc, content } })
}
