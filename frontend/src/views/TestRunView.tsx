import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, Copy, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { COPIED_FEEDBACK_MS } from '../app/copyActions'
import { ActionButton } from '../components/ActionButton'
import { Badge } from '../components/Badge'
import { StatePanel } from '../components/Common'
import { Dialog } from '../components/Dialog'
import { Segmented, type SegmentedOption } from '../components/Segmented'
import { writePlainClipboard } from '../editor/clipboardExport'
import { RichTextEditor } from '../editor/RichTextEditor'
import { testRunCaseDocument } from '../testware/testRuns'
import { testRunReport } from '../testware/testRunReport'
import type { OpenTestRun } from '../testware/useTestRuns'
import type { CasePatch } from '../testware/caseSaveQueue'
import type { TestCaseResult, TestRun, TestRunCase, TestRunSummary } from '../tauri'
import { formatDateTime, formatError } from '../ui/format'

type RecordedResult = Exclude<TestCaseResult, 'not_run'>

const resultOptions: ReadonlyArray<SegmentedOption<RecordedResult>> = [
  { value: 'passed', label: 'Passed', tone: 'success' },
  { value: 'failed', label: 'Failed', tone: 'danger' },
  { value: 'blocked', label: 'Blocked', tone: 'warning' },
]

const resultKeys: Record<string, RecordedResult> = { p: 'passed', f: 'failed', b: 'blocked' }

const REMARK_MAX_LENGTH = 500

/**
 * A test run in place of its draft: the copied test cases in order, each with a Result and a Remark
 * saved the moment they change. There is no Save button.
 */
export function TestRunView({ open, draftRuns, error, askAi, onSelectRun, onBack, onDelete, onChangeCase, onCreateFinding, onOpenFinding }: {
  open: OpenTestRun
  /** The draft's test runs, newest first. */
  draftRuns: TestRunSummary[]
  error: string | null
  onSelectRun: (runId: string) => void
  onBack: () => void
  onDelete: (runId: string) => Promise<boolean>
  /** Changes one field of a case; the other keeps its value, so a remark and a result never overwrite each other. */
  onChangeCase: (caseId: string, patch: CasePatch) => void
  /** Starts a Finding from a failed case; without it no Create Finding is offered. */
  onCreateFinding?: (testCase: TestRunCase) => void
  /** Opens the Finding a case is linked to. */
  onOpenFinding?: (findingId: string) => void
  /** Ask AI on this test run, read-only; `expanded` while its panel is open. */
  askAi?: { expanded: boolean; onOpen: (runId: string) => void | Promise<void> }
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const toggleRefs = useRef<Array<HTMLButtonElement | null>>([])
  const { run } = open
  const cases = run?.cases ?? []
  const recorded = cases.filter((testCase) => testCase.result !== 'not_run').length

  function onCaseKeyDown(event: KeyboardEvent<HTMLElement>, index: number) {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) return
    const testCase = cases[index]
    const result = resultKeys[event.key.toLowerCase()]
    if (result) {
      event.preventDefault()
      onChangeCase(testCase.id, { result: testCase.result === result ? 'not_run' : result })
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    const target = step ? toggleRefs.current[index + step] : null
    if (!target) return
    event.preventDefault()
    target.focus()
  }

  async function confirmDelete() {
    setDeleting(true)
    await onDelete(open.runId)
    setDeleting(false)
    // Closed either way: a failure shows in the error line above the cases, which the dialog would cover.
    setConfirmingDelete(false)
  }

  return (
    <article className="test-run">
      <header className="test-run-header">
        <div className="test-run-heading">
          <h2 className="record-title">{run?.draftTitle ?? draftRuns.find((summary) => summary.id === open.runId)?.draftTitle ?? 'Test run'}</h2>
          {run ? <p>Test run of {formatDateTime(run.createdAt)}</p> : null}
        </div>
        <div className="test-run-actions">
          {run ? <Badge>{recorded} of {cases.length} run</Badge> : null}
          {draftRuns.length > 1 ? (
            <select aria-label="Test run" value={open.runId} onChange={(event) => onSelectRun(event.target.value)}>
              {draftRuns.map((summary) => <option key={summary.id} value={summary.id}>{formatDateTime(summary.createdAt)}</option>)}
            </select>
          ) : null}
          {run && askAi ? <ActionButton variant="secondary" className="ask-ai-trigger" icon={Sparkles} aria-expanded={askAi.expanded}
            onClick={() => void askAi.onOpen(run.id)}>Ask AI</ActionButton> : null}
          {run ? <CopyReportButton run={run} /> : null}
          {/* Kept together, so a narrow header never leaves the delete icon alone on a line. */}
          <span className="test-run-leave">
            <ActionButton variant="quiet" icon={ArrowLeft} onClick={onBack}>Back to test cases</ActionButton>
            <ActionButton variant="destructive-quiet" iconOnly icon={Trash2} aria-label="Delete test run" title="Delete test run"
              onClick={() => setConfirmingDelete(true)} />
          </span>
        </div>
      </header>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {open.error ? (
        <StatePanel icon={AlertTriangle} title="Could not open the test run" description={open.error}
          action={{ label: 'Try again', onClick: () => onSelectRun(open.runId) }} />
      ) : !run ? (
        <StatePanel icon={Loader2} title="Opening test run" description="Reading its test cases and results." />
      ) : (
        <div className="test-run-cases">
          {cases.map((testCase, index) => (
            <TestRunCaseRow key={testCase.id} testCase={testCase}
              finding={<CaseFinding testCase={testCase} onCreateFinding={onCreateFinding} onOpenFinding={onOpenFinding} />}
              group={testCase.groupTitle && testCase.groupTitle !== cases[index - 1]?.groupTitle ? testCase.groupTitle : null}
              toggleRef={(element) => { toggleRefs.current[index] = element }}
              onKeyDown={(event) => onCaseKeyDown(event, index)}
              onChangeCase={onChangeCase} />
          ))}
        </div>
      )}
      {confirmingDelete ? (
        <Dialog
          title="Delete this test run?"
          description={<p>Its results and remarks are removed. The test cases stay.</p>}
          initialFocus={cancelRef}
          onCancel={() => { if (!deleting) setConfirmingDelete(false) }}
          actions={<>
            <ActionButton ref={cancelRef} disabled={deleting} onClick={() => setConfirmingDelete(false)}>Cancel</ActionButton>
            <ActionButton variant="destructive-confirmation" loading={deleting} onClick={() => void confirmDelete()}>Delete test run</ActionButton>
          </>}
        />
      ) : null}
    </article>
  )
}

/** Copies the test run as plain text, and says Copied for a moment like the other Copy buttons. */
function CopyReportButton({ run }: { run: TestRun }) {
  const [copied, setCopied] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current) }, [])

  async function copy() {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setFailure(null)
    try {
      await writePlainClipboard(testRunReport(run))
      setCopied(true)
      timer.current = window.setTimeout(() => {
        timer.current = null
        setCopied(false)
      }, COPIED_FEEDBACK_MS)
    } catch (cause) {
      setCopied(false)
      setFailure(formatError(cause))
    }
  }

  return <>
    <ActionButton variant="secondary" icon={copied ? CheckCircle2 : Copy} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy report'}</ActionButton>
    <span className="sr-only" role="status">{copied ? 'Report copied' : ''}</span>
    {failure ? <span className="copy-error" role="alert">Copy failed: {failure}</span> : null}
  </>
}

function TestRunCaseRow({ testCase, group, finding, toggleRef, onKeyDown, onChangeCase }: {
  testCase: TestRunCase
  group: string | null
  /** What follows the remark: the linked Finding, or Create Finding for a failed case. */
  finding: ReactNode
  toggleRef: (element: HTMLButtonElement | null) => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  onChangeCase: (caseId: string, patch: CasePatch) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const document = useMemo(() => expanded ? testRunCaseDocument(testCase) : null, [expanded, testCase])
  const { id, title, result, remark } = testCase
  const showRemark = result === 'failed' || result === 'blocked' || Boolean(remark)
  return <>
    {group ? <h3 className="test-run-group">{group}</h3> : null}
    <section className="test-run-case" aria-label={title} onKeyDown={onKeyDown}>
      <button ref={toggleRef} type="button" className="test-run-case-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <ChevronRight size={16} className="disclosure-chevron" aria-hidden="true" />
        <span>{title}</span>
      </button>
      <Segmented label={`Result for ${title}`} allowDeselect options={resultOptions}
        value={result === 'not_run' ? null : result}
        onChange={(next) => onChangeCase(id, { result: next ?? 'not_run' })} />
      {showRemark ? (
        <div className="test-run-remark-row">
          <RemarkInput title={title} remark={remark} onSave={(next) => onChangeCase(id, { remark: next })} />
          {finding}
        </div>
      ) : null}
      {document ? (
        <div className="test-run-case-body">
          <RichTextEditor value={document} ariaLabel={`${title} test case`} readOnly />
        </div>
      ) : null}
    </section>
  </>
}

/**
 * For a failed case: the Finding it is linked to, as a quiet line that opens it, or Create Finding
 * when it has none.
 */
function CaseFinding({ testCase, onCreateFinding, onOpenFinding }: {
  testCase: TestRunCase
  onCreateFinding?: (testCase: TestRunCase) => void
  onOpenFinding?: (findingId: string) => void
}) {
  if (testCase.result !== 'failed') return null
  const { findingId, findingTitle } = testCase
  if (findingId) return <button type="button" className="test-run-finding" onClick={() => onOpenFinding?.(findingId)}>Finding: {findingTitle}</button>
  return onCreateFinding ? <ActionButton variant="secondary" onClick={() => onCreateFinding(testCase)}>Create Finding</ActionButton> : null
}

/** One line for what happened, saved on blur and on Enter when it changed. */
function RemarkInput({ title, remark, onSave }: { title: string; remark: string | null; onSave: (remark: string | null) => void }) {
  const [value, setValue] = useState(remark ?? '')
  const [stored, setStored] = useState(remark)
  if (stored !== remark) {
    setStored(remark)
    setValue(remark ?? '')
  }
  function commit() {
    const next = value.trim() || null
    if (next !== remark) onSave(next)
  }
  // A remark still being typed is kept when the screen goes away without a blur, as a shortcut does.
  const commitRef = useRef(commit)
  useEffect(() => { commitRef.current = commit })
  useEffect(() => () => commitRef.current(), [])
  return (
    <div className="field test-run-remark">
      <input aria-label={`Remark for ${title}`} placeholder="What happened?" maxLength={REMARK_MAX_LENGTH} value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }} />
    </div>
  )
}
