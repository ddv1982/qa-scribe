import { emptyRichEditorDocument, parseRichEditorDocument, richEditorDocumentFromStoredBody, serializeRichEditorDocument, type RichEditorDocument } from '../editor/editorDocument'
import type { Draft, TestRunCase, TestRunCaseDraft, TestRunSummary } from '../tauri'
import { formatShortDate } from '../ui/format'
import { draftOutputFormat, splitTestCases } from './testCases'

/**
 * The test cases a test run copies from a saved Test cases draft, or null when the draft cannot be
 * run. Each body holds only the case's own content, stored in the shape drafts use.
 */
export function testRunCasesFromDraft(draft: Pick<Draft, 'body' | 'bodyJson' | 'metadataJson'>): TestRunCaseDraft[] | null {
  const split = splitTestCases(richEditorDocumentFromStoredBody(draft), draftOutputFormat(draft))
  return split?.cases.map((testCase) => ({
    groupTitle: testCase.group === null ? null : limitTitle(testCase.group),
    title: limitTitle(testCase.title),
    bodyJson: serializeRichEditorDocument({ schemaVersion: 1, doc: { type: 'doc', content: testCase.content } }),
  })) ?? null
}

/** The store limits a title to 160 characters. A longer one is cut; the case's content keeps it whole. */
const TITLE_MAX_LENGTH = 160
function limitTitle(title: string): string {
  const characters = Array.from(title)
  return characters.length <= TITLE_MAX_LENGTH ? title : `${characters.slice(0, TITLE_MAX_LENGTH - 1).join('').trimEnd()}…`
}

/**
 * A copied case's content to show under its title. A heading-based case starts with its own heading,
 * which the title already shows, so it is left out.
 */
export function testRunCaseDocument(testCase: Pick<TestRunCase, 'bodyJson'>): RichEditorDocument {
  const document = parseRichEditorDocument(testCase.bodyJson) ?? emptyRichEditorDocument
  const [first, ...rest] = document.doc.content ?? []
  if (first?.type !== 'heading') return document
  return { ...document, doc: { ...document.doc, content: rest } }
}

/** `Last test run 13 Nov: 3 passed, 1 failed`, leaving out zero counts. */
export function lastTestRunText(summary: Pick<TestRunSummary, 'createdAt' | 'passed' | 'failed' | 'blocked'>): string {
  const counts = ([['passed', summary.passed], ['failed', summary.failed], ['blocked', summary.blocked]] as const)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`)
  return `Last test run ${formatShortDate(summary.createdAt)}: ${counts.length ? counts.join(', ') : 'nothing recorded yet'}`
}
