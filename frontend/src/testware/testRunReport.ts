import type { TestCaseResult, TestRun, TestRunCase } from '../tauri'
import { formatDateTime } from '../ui/format'

const resultLabels: Record<TestCaseResult, string> = { passed: 'Passed', failed: 'Failed', blocked: 'Blocked', not_run: 'Not run' }

/** Every Result once, in the order the totals line names them. */
const resultOrder: TestCaseResult[] = ['passed', 'failed', 'blocked', 'not_run']

/**
 * A test run as plain Markdown-style text: the draft title, when it started, the totals and every
 * test case with its Result, its Remark and the title of its linked Finding.
 * Cases without a group come first; the others follow under their group title in the order the
 * groups first appear. This is the one place a test run becomes text.
 */
export function testRunReport(run: Pick<TestRun, 'draftTitle' | 'createdAt' | 'cases'>): string {
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
    ...testCase.remark ? [`  Remark: ${testCase.remark}`] : [],
    ...testCase.findingTitle ? [`  Finding: ${testCase.findingTitle}`] : [],
  ]
  const sections = [
    ...ungrouped.length ? [ungrouped.flatMap(caseLines).join('\n')] : [],
    ...Array.from(groups, ([group, cases]) => [`### ${group}`, ...cases.flatMap(caseLines)].join('\n')),
  ]
  return [`## Test run: ${run.draftTitle}\n${formatDateTime(run.createdAt)}`, totals, ...sections].join('\n\n')
}
