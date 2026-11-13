import { Fragment, useMemo } from 'react'
import { criteriaCoverage, parseCriteria, type AcceptanceCriterion } from '../testware/acceptanceCriteria'
import { failedTestCaseTexts } from '../testware/testRuns'
import type { TestRun } from '../tauri'

/** How many ids a list names before it summarises the rest. */
const MAX_LISTED_IDS = 8

type CoverageRecord = { title: string; body: string }

/**
 * The plain text of a saved record: its title and its body. Blocks and line breaks are kept apart
 * by a space, or `AC-1</p><p>Expected` would read as `AC-1Expected`. Inline formatting is not, so
 * `AC-<strong>1</strong>` still reads as `AC-1`.
 */
function recordText(record: CoverageRecord): string {
  const body = new DOMParser().parseFromString(record.body, 'text/html').body
  for (const block of body.querySelectorAll('p, h2, h3, li, br')) block.after(' ')
  return `${record.title} ${body.textContent ?? ''}`
}

const noRuns: Pick<TestRun, 'cases'>[] = []

const criteriaNoun = (count: number) => count === 1 ? 'criterion' : 'criteria'

/**
 * One quiet line above the Session's Test cases: how many acceptance criteria the saved test
 * cases cite by id, which ones failed in the latest test run of a draft, and which ones no test
 * case cites yet. Renders nothing without criteria. Failing is counted, not coloured.
 */
export function CoverageLine({ acceptanceCriteria, records, latestRuns = noRuns }: {
  acceptanceCriteria: string | null
  /** The saved Test cases drafts; unsaved edits do not count. */
  records: CoverageRecord[]
  /** The newest test run of each Test cases draft of the Session. */
  latestRuns?: Pick<TestRun, 'cases'>[]
}) {
  const criteria = useMemo(() => parseCriteria(acceptanceCriteria), [acceptanceCriteria])
  const failedCases = useMemo(() => failedTestCaseTexts(latestRuns), [latestRuns])
  const coverage = useMemo(() => criteriaCoverage(criteria, records.map(recordText), failedCases), [criteria, records, failedCases])
  if (criteria.length === 0) return null

  const total = criteria.length
  const { uncovered, failing } = coverage
  const covered = uncovered.length === 0
    ? total === 1 ? '1 criterion covered' : `All ${total} criteria covered`
    : `${coverage.covered.length} of ${total} ${criteriaNoun(total)} covered`
  const lists = [['Failing', failing], ['Not covered', uncovered]] as const
  return (
    <p className="coverage-line" role="status">
      <strong>{covered}{failing.length ? `, ${failing.length} failing` : ''}.</strong>
      {lists.filter(([, listed]) => listed.length > 0).map(([label, listed], index) => (
        <Fragment key={label}>{index > 0 ? '.' : null} {label}: <CriterionIds criteria={listed} /></Fragment>
      ))}
    </p>
  )
}

/** Criterion ids with their text on hover: at most eight, then how many more. */
function CriterionIds({ criteria }: { criteria: readonly AcceptanceCriterion[] }) {
  const listed = criteria.slice(0, MAX_LISTED_IDS)
  const more = criteria.length - listed.length
  return <>
    {listed.map((criterion, index) => (
      <Fragment key={`${index}:${criterion.id}`}>
        {index > 0 ? ', ' : null}
        <span title={criterion.text || criterion.id}>{criterion.id}</span>
      </Fragment>
    ))}
    {more > 0 ? ` and ${more} more` : null}
  </>
}
