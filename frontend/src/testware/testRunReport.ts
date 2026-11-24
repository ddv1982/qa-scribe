import type { TestCaseResult, TestRun, TestRunCase } from '../tauri'
import { formatDateTime } from '../ui/format'
import { resultNotesLines } from './testRunNotes'

export const resultLabels: Record<TestCaseResult, string> = { passed: 'Passed', failed: 'Failed', blocked: 'Blocked', not_run: 'Not run' }

/** Every Result once, in the order the totals line names them. */
const resultOrder: TestCaseResult[] = ['passed', 'failed', 'blocked', 'not_run']

/**
 * A test run as plain Markdown-style text: the draft title, when it started, the totals and every
 * test case with its Result, its Remark and the title of its linked Finding.
 * Cases without a group come first; the others follow under their group title in the order the
 * groups first appear. The AI report uses the same result and notes labels.
 */
export function testRunReport(run: Pick<TestRun, 'draftTitle' | 'createdAt' | 'cases' | 'logEvidence'>): string {
  const totals = resultOrder
    .map((result) => `${run.cases.filter((testCase) => testCase.result === result).length} ${resultLabels[result].toLowerCase()}`)
    .join(', ')
  const groups = new Map<string, TestRunCase[]>()
  const ungrouped: TestRunCase[] = []
  for (const testCase of run.cases) {
    if (!testCase.groupTitle) ungrouped.push(testCase)
    else groups.set(testCase.groupTitle, [...groups.get(testCase.groupTitle) ?? [], testCase])
  }
  const caseLines = (testCase: TestRunCase) => [
    `- ${resultLabels[testCase.result]}: ${testCase.title}`,
    ...(testCase.notes ? resultNotesLines(testCase.notes) : testCase.remark ? [`  Remark: ${testCase.remark}`] : []),
    ...testCase.findingTitle ? [`  Finding: ${testCase.findingTitle}`] : [],
    ...(run.logEvidence ?? []).filter((capture) => capture.caseId === testCase.id).map((capture) => {
      const rows = capture.rowCount === 1 ? 'row' : 'rows'
      const truncated = capture.truncated ? ', truncated' : ''
      return `  Application logs: ${capture.sourceLabels.join(', ')} · ${capture.start} to ${capture.end} · ${capture.rowCount} ${rows}${truncated} · ${capture.portalUrl}`
    }),
  ]
  const sections = [
    ...ungrouped.length ? [ungrouped.flatMap(caseLines).join('\n')] : [],
    ...Array.from(groups, ([group, cases]) => [`### ${group}`, ...cases.flatMap(caseLines)].join('\n')),
  ]
  return [`## Test run: ${run.draftTitle}\n${formatDateTime(run.createdAt)}`, totals, ...sections].join('\n\n')
}
