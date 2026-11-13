import { emptyRichEditorDocument, parseRichEditorDocument, richEditorDocumentFromStoredBody, serializeRichEditorDocument, type RichEditorDocument } from '../editor/editorDocument'
import type { JSONContent } from '@tiptap/core'
import type { Draft, TestRun, TestRunCase, TestRunCaseDraft, TestRunSummary } from '../tauri'
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

/** The newest test run of each draft, from summaries listed newest first. */
export function latestTestRunIds(summaries: Pick<TestRunSummary, 'id' | 'draftId'>[]): string[] {
  const latest = new Map<string, string>()
  for (const summary of summaries) if (!latest.has(summary.draftId)) latest.set(summary.draftId, summary.id)
  return Array.from(latest.values())
}

/**
 * The plain text of every case that failed in the given runs: its group title, its title and its
 * copied content. Blocks are kept apart by a space, so `AC-1` ending one paragraph never runs into
 * the next; text inside one block is joined as written, so `AC-` and a bold `1` still read `AC-1`.
 */
export function failedTestCaseTexts(runs: Pick<TestRun, 'cases'>[]): string[] {
  return runs.flatMap((run) => run.cases)
    .filter((testCase) => testCase.result === 'failed')
    .map((testCase) => [testCase.groupTitle ?? '', testCase.title, nodeText(testRunCaseDocument(testCase).doc)].join(' '))
}

function nodeText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return ' '
  const children = node.content ?? []
  const inline = children.every((child) => child.type === 'text' || child.type === 'hardBreak')
  return children.map(nodeText).join(inline ? '' : ' ')
}
