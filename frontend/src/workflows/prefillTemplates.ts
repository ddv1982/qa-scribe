import type { JSONContent } from '@tiptap/core'
import { stripHtml } from '../editor/editorHtml'
import { escapeHtml } from '../editor/htmlUtils'
import { normalizeRichEditorDocument, richEditorDocumentToHtml, type RichEditorDocument } from '../editor/editorDocument'
import { creationStarter, type CreationFormat } from '../app/creationFormats'
import { testRunCaseDocument } from '../testware/testRuns'
import type { TestRunCase } from '../tauri'

/** The Note goes in as a labelled paragraph, not under a heading: a heading would count as a test case. */
export function renderPrefilledTestware(_title: string, body: string, outputFormat: import('../tauri').TestwareOutputFormat = 'qa_cases'): string {
  const note = stripHtml(body)
  return `${note ? `<p><strong>Source note:</strong> ${escapeHtml(note)}</p>` : ''}${richEditorDocumentToHtml(creationStarter({ kind: 'testware', outputFormat }))}`
}

export function renderPrefilledFinding(body: string, template: Extract<CreationFormat, { kind: 'finding' }>['template'] = 'structured'): string {
  const note = escapeHtml(stripHtml(body).slice(0, 4000))
  if (template === 'blank') return note ? `<p>${note}</p>` : ''
  return richEditorDocumentToHtml(creationStarter({ kind: 'finding', template })).replace('<h3>Evidence</h3><p></p>', `<h3>Evidence</h3><p>${note}</p>`)
}

/**
 * The structured finding starter for a failed test case: its copied content, without the case
 * heading, under Steps to reproduce, and its remark under Actual result. The other sections stay
 * empty, as in the starter. Built on the editor document, so nothing is parsed from HTML.
 */
export function prefilledFindingFromTestCase(testCase: Pick<TestRunCase, 'bodyJson' | 'remark'>): RichEditorDocument {
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
