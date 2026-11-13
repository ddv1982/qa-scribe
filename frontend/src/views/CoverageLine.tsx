import { Fragment, useMemo } from 'react'
import { criteriaCoverage, parseCriteria } from '../testware/acceptanceCriteria'

/** How many uncovered ids the line names before it summarises the rest. */
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

const criteriaNoun = (count: number) => count === 1 ? 'criterion' : 'criteria'

/**
 * One quiet line above the Session's Test cases: how many acceptance criteria the saved test
 * cases cite by id, and which ones none does yet. Renders nothing without criteria.
 */
export function CoverageLine({ acceptanceCriteria, records }: {
  acceptanceCriteria: string | null
  /** The saved Test cases drafts; unsaved edits do not count. */
  records: CoverageRecord[]
}) {
  const criteria = useMemo(() => parseCriteria(acceptanceCriteria), [acceptanceCriteria])
  const coverage = useMemo(() => criteriaCoverage(criteria, records.map(recordText)), [criteria, records])
  if (criteria.length === 0) return null

  const total = criteria.length
  if (coverage.uncovered.length === 0) {
    return (
      <p className="coverage-line" role="status">
        <strong>{total === 1 ? '1 criterion covered.' : `All ${total} criteria covered.`}</strong>
      </p>
    )
  }
  const listed = coverage.uncovered.slice(0, MAX_LISTED_IDS)
  const more = coverage.uncovered.length - listed.length
  return (
    <p className="coverage-line" role="status">
      <strong>{coverage.covered.length} of {total} {criteriaNoun(total)} covered.</strong>
      {' Not covered: '}
      {listed.map((criterion, index) => (
        <Fragment key={`${index}:${criterion.id}`}>
          {index > 0 ? ', ' : null}
          <span title={criterion.text || criterion.id}>{criterion.id}</span>
        </Fragment>
      ))}
      {more > 0 ? ` and ${more} more` : null}
    </p>
  )
}
