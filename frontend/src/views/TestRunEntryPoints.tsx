import { useMemo, useState } from 'react'
import { ListChecks } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { Badge } from '../components/Badge'
import { testRunCasesFromDraft, testRunSummaryText } from '../testware/testRuns'
import type { Draft, TestRunCaseDraft, TestRunSummary } from '../tauri'

/** Start test run on a saved draft that splits into test cases; nothing for one that cannot be run. */
export function StartTestRunButton({ draft, starting, disabled, onStart }: {
  /** The draft as last saved. */
  draft: Draft
  starting: boolean
  disabled: boolean
  onStart: (cases: TestRunCaseDraft[]) => void
}) {
  const { body, bodyJson, metadataJson } = draft
  const cases = useMemo(() => testRunCasesFromDraft({ body, bodyJson, metadataJson }), [body, bodyJson, metadataJson])
  if (!cases) return null
  return <ActionButton variant="secondary" icon={ListChecks} loading={starting} disabled={disabled} onClick={() => onStart(cases)}>Start test run</ActionButton>
}

/** How many test runs show before Show all. */
const VISIBLE_TEST_RUNS = 5

/** Every test run of a draft under its title, newest first; each opens with one click. Nothing at zero test runs. */
export function TestRunList({ runs, onOpen }: {
  /** The draft's test runs, newest first. */
  runs: TestRunSummary[]
  onOpen: (runId: string) => void
}) {
  const [showAll, setShowAll] = useState(false)
  if (runs.length === 0) return null
  const shown = showAll ? runs : runs.slice(0, VISIBLE_TEST_RUNS)
  return (
    <section className="test-run-list" aria-label="Test runs">
      <ul>
        {shown.map((summary, index) => (
          <li key={summary.id}>
            <button type="button" className="test-run-list-item" onClick={() => onOpen(summary.id)}>
              {testRunSummaryText(summary)}{index === 0 ? <Badge>Latest</Badge> : null}
            </button>
          </li>
        ))}
      </ul>
      {runs.length > VISIBLE_TEST_RUNS ? (
        <button type="button" className="test-run-list-more" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer' : `Show all (${runs.length})`}
        </button>
      ) : null}
    </section>
  )
}
