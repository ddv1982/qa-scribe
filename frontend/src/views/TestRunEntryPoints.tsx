import { useMemo } from 'react'
import { ListChecks } from 'lucide-react'
import { ActionButton } from '../components/ActionButton'
import { lastTestRunText, testRunCasesFromDraft } from '../testware/testRuns'
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

/** One quiet line under the draft title that opens its newest test run. */
export function LastTestRunLine({ summary, onOpen }: { summary: TestRunSummary; onOpen: () => void }) {
  return <button type="button" className="last-test-run" onClick={onOpen}>{lastTestRunText(summary)}</button>
}
