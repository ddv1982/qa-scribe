import { useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { commands, type LogEvidenceDetails, type LogEvidenceSummary } from '../bindings'
import { writePlainClipboard } from '../editor/clipboardExport'
import { formatError } from '../ui/format'
import { TestRunLogQueryDialog } from './TestRunLogQueryDialog'

type LogTable = { name: string, columns: { name: string }[], rows: unknown[][] }

export function TestRunLogEvidence({ caseId, captures, disabled, onCapture, onDetach }: {
  caseId: string
  captures: LogEvidenceSummary[]
  disabled: boolean
  onCapture: (capture: LogEvidenceSummary) => void
  onDetach: (captureId: string) => void
}) {
  const [query, setQuery] = useState(false)

  return <div className="test-run-log-evidence" onKeyDown={(event) => event.stopPropagation()}>
    {captures.map((capture) => <CaptureView key={capture.id} capture={capture} disabled={disabled}
      onDetach={() => onDetach(capture.id)} />)}
    <ActionButton variant="quiet" disabled={disabled || captures.length >= 10}
      onClick={() => setQuery(true)}>Add log evidence</ActionButton>
    {query ? <TestRunLogQueryDialog caseId={caseId} onCapture={onCapture} onClose={() => setQuery(false)} /> : null}
  </div>
}

function CaptureView({ capture, disabled, onDetach }: {
  capture: LogEvidenceSummary
  disabled: boolean
  onDetach: () => void
}) {
  const [details, setDetails] = useState<LogEvidenceDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [detaching, setDetaching] = useState(false)

  async function load() {
    if (details || loading) return
    setLoading(true)
    setError(null)
    try {
      setDetails(await commands.getApplicationLogDetails(capture.caseId, capture.id))
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setLoading(false)
    }
  }

  async function copy(label: string, text: string) {
    setCopied(null)
    setError(null)
    try {
      await writePlainClipboard(text)
      setCopied(label)
    } catch (cause) {
      setError(formatError(cause))
    }
  }

  async function detach() {
    setDetaching(true)
    setError(null)
    try {
      await commands.detachApplicationLogs(capture.caseId, capture.id)
      onDetach()
    } catch (cause) {
      setError(formatError(cause))
      setDetaching(false)
    }
  }

  const tables = details ? (JSON.parse(details.resultJson) as { tables: LogTable[] }).tables : []
  const rowLabel = capture.rowCount === 1 ? 'row' : 'rows'
  return <details onToggle={(event) => { if (event.currentTarget.open) void load() }}>
    <summary>Application logs · {capture.sourceLabels.join(', ')} · {capture.rowCount} {rowLabel}{capture.truncated ? ', truncated' : ''}</summary>
    <p><time dateTime={capture.start}>{capture.start}</time> to <time dateTime={capture.end}>{capture.end}</time></p>
    <ActionButton variant="quiet" onClick={() => void copy('link', capture.portalUrl)}>
      {copied === 'link' ? 'Portal link copied' : 'Copy Azure portal link'}
    </ActionButton>
    <p>Set the recorded UTC time range in the portal.</p>
    {details ? <>
      <pre className="log-evidence-kql">{details.kql}</pre>
      <ActionButton variant="quiet"
        onClick={() => void copy('query', `// Start (UTC): ${capture.start}\n// End (UTC): ${capture.end}\n${details.kql}`)}>
        {copied === 'query' ? 'KQL and UTC window copied' : 'Copy KQL and UTC window'}
      </ActionButton>
      {tables.map((table, index) => <div className="log-evidence-table" key={index}>
        <table>
          <caption>{table.name}</caption>
          <thead><tr>{table.columns.map((column, col) => <th key={col} scope="col">{column.name}</th>)}</tr></thead>
          <tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>
            {row.map((value, col) => <td key={col}>{typeof value === 'string' ? value : JSON.stringify(value)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>)}
      <ActionButton variant="quiet" onClick={() => void copy('rows', details.resultJson)}>
        {copied === 'rows' ? 'Rows copied' : 'Copy rows'}
      </ActionButton>
    </> : null}
    <ActionButton variant="quiet" loading={detaching} disabled={disabled}
      onClick={() => void detach()}>Detach evidence</ActionButton>
    {loading ? <p role="status">Loading log evidence…</p> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
  </details>
}
