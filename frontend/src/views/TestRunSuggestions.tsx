import { useId, useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { Badge } from '../components/Badge'
import { parseRichEditorDocument } from '../editor/editorDocument'
import { RichTextEditor } from '../editor/RichTextEditor'
import {
  applyAllTestRunSuggestions, applyTestRunSuggestion, undoTestRunSuggestion,
  type ChatRef, type TestRunCase, type TestRunSuggestion, type TestRunSuggestionOutcome,
} from '../tauri'
import { resultLabels } from '../testware/testRunReport'
import { runTestRunSuggestionAction } from '../testware/useTestRuns'
import { formatError } from '../ui/format'

type TestRunSuggestionsProps = {
  reference: ChatRef
  assistantMessageId: string
  runId: string
  rows: TestRunSuggestion[]
  cases: TestRunCase[]
  editsBlocked?: boolean
}

export function TestRunSuggestions({ reference, assistantMessageId, runId, rows, cases, editsBlocked }: TestRunSuggestionsProps) {
  const [updates, setUpdates] = useState<Record<string, TestRunSuggestion>>({})
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  if (!rows.length) return null

  const items = rows.map(saved => {
    const row = updates[saved.id] ?? saved
    const testCase = cases.find(item => item.id === row.caseId)
    const applied = row.appliedFingerprint !== null
    const outOfDate = testCase?.suggestionFingerprint !== (row.appliedFingerprint ?? row.baseFingerprint)
    return { row, testCase, applied, outOfDate }
  })
  async function act(write: () => Promise<TestRunSuggestionOutcome[]>, action: 'apply' | 'undo') {
    setPending(true)
    setNotice('')
    setError('')
    try {
      const outcomes = await runTestRunSuggestionAction(runId, write)
      setUpdates(previous => {
        const next = { ...previous }
        for (const outcome of outcomes) {
          if (outcome.kind !== 'failed') next[outcome.suggestion.id] = outcome.suggestion
        }
        return next
      })
      const saved = outcomes.filter(outcome => outcome.kind === 'saved').length
      const skipped = outcomes.filter(outcome => outcome.kind === 'out_of_date').length
      const success = saved > 0 ? action === 'undo' ? 'Update undone.' : `Updated ${saved} ${saved === 1 ? 'case' : 'cases'}.` : ''
      const stale = skipped > 0 ? skipped === 1 ? '1 case was out of date.' : `${skipped} cases were out of date.` : ''
      setNotice([success, stale].filter(Boolean).join(' '))
      setError(outcomes.flatMap(outcome => outcome.kind === 'failed'
        ? [`${cases.find(item => item.id === outcome.caseId)?.title ?? 'Test case'}: ${outcome.message}`]
        : []).join('\n'))
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setPending(false)
    }
  }
  function update(row: TestRunSuggestion, undo: boolean) {
    const request = { reference, suggestionId: row.id }
    const write = undo ? undoTestRunSuggestion : applyTestRunSuggestion
    return act(async () => [await write(request)], undo ? 'undo' : 'apply')
  }
  return <section className="chat-proposal chat-proposal--record test-run-suggestions" aria-label="Suggested results">
    <h3>Suggested results</h3>
    {items.map(item => <SuggestionRow key={item.row.id} {...item} disabled={pending || Boolean(editsBlocked)} update={() => void update(item.row, item.applied)} />)}
    <div>
      <ActionButton variant="secondary" disabled={pending || editsBlocked || !items.some(item => !item.applied && !item.outOfDate)}
        onClick={() => void act(() => applyAllTestRunSuggestions({ reference, assistantMessageId }), 'apply')}>Apply all</ActionButton>
    </div>
    <div role="status">{notice}</div>
    {error ? <p role="alert" className="field-error">{error}</p> : null}
  </section>
}

function SuggestionRow({ row, testCase, applied, outOfDate, disabled, update }: {
  row: TestRunSuggestion; testCase?: TestRunCase; applied: boolean; outOfDate: boolean; disabled: boolean; update: () => void
}) {
  const id = useId()
  const title = testCase?.title ?? 'Test case unavailable'
  const notes = parseRichEditorDocument(row.notesJson)
  return <div role="group" aria-label={title} className="test-run-suggestion-row">
    <div className="test-run-suggestion-heading">
      <h4>{title}</h4>
      <Badge>{outOfDate ? 'Out of date' : applied ? 'Applied' : 'Suggested'}</Badge>
    </div>
    <dl>
      <dt>Current Result</dt><dd>{testCase ? resultLabels[testCase.result] : 'Unavailable'}</dd>
      <dt>Proposed Result</dt><dd>{row.result ? resultLabels[row.result] : 'No change'}</dd>
    </dl>
    {row.rationale ? <p>{row.rationale}</p> : null}
    {notes ? <RichTextEditor value={notes} ariaLabel={`Result notes to append for ${title}`} readOnly /> : null}
    {outOfDate ? <p id={id} className="chat-help">The test case changed. Ask AI again to get a fresh suggestion.</p> : null}
    <div>
      <ActionButton variant="quiet" disabled={disabled || outOfDate} aria-describedby={outOfDate ? id : undefined}
        aria-label={applied ? `Undo update for ${title}` : `Update result for ${title}`} onClick={update}>
        {applied ? 'Undo' : 'Update'}
      </ActionButton>
    </div>
  </div>
}
