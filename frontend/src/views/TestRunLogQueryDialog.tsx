import { useEffect, useRef, useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { Dialog } from '../components/Dialog'
import { commands, type ApplicationLogSource, type LogEvidenceSummary } from '../bindings'
import { formatError } from '../ui/format'

const SECOND_MS = 1_000

function dateField(date: Date): string {
  return date.toISOString().slice(0, 19)
}

export function TestRunLogQueryDialog({ caseId, onCapture, onClose }: {
  caseId: string
  onCapture: (evidence: LogEvidenceSummary) => void
  onClose: () => void
}) {
  const [sources, setSources] = useState<ApplicationLogSource[] | null>(null)
  const [targetId, setTargetId] = useState('')
  const [recent, setRecent] = useState<string[]>([])
  const [kql, setKql] = useState('')
  const [defaultEnd] = useState(() => Math.ceil(Date.now() / SECOND_MS) * SECOND_MS)
  const [start, setStart] = useState(() => dateField(new Date(defaultEnd - 15 * 60 * SECOND_MS)))
  const [end, setEnd] = useState(() => dateField(new Date(defaultEnd)))
  const [pending, setPending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const job = useRef<string | null>(null)

  useEffect(() => {
    let current = true
    void commands.getSettings().then((settings) => {
      if (!current) return
      const configured = settings.applicationLogSources ?? []
      setSources(configured)
      if (configured.length === 1) setTargetId(configured[0].resourceId)
    }).catch((cause: unknown) => {
      if (current) setError(formatError(cause))
    })
    return () => {
      current = false
      const queryId = job.current
      job.current = null
      if (queryId) void commands.cancelApplicationLogQuery(queryId).catch(() => {})
    }
  }, [])

  useEffect(() => {
    let current = true
    if (targetId) {
      void commands.recentApplicationLogQueries(caseId, targetId).then((queries) => {
        if (current) setRecent(queries)
      }).catch(() => {})
    }
    return () => { current = false }
  }, [caseId, targetId])

  function select(id: string) {
    setRecent([])
    setTargetId(id)
  }

  async function capture() {
    if (job.current) return
    const from = new Date(`${start}Z`)
    const to = new Date(`${end}Z`)
    if (!targetId || !kql.trim() || !(from < to)) {
      setError('Select a query target, enter KQL, and choose a start time before the end time.')
      return
    }
    const queryId = crypto.randomUUID()
    job.current = queryId
    setPending(true)
    setError(null)
    try {
      const evidence = await commands.captureApplicationLogs(caseId, queryId, {
        targetId, kql, start: from.toISOString(), end: to.toISOString(),
      })
      if (job.current === queryId) {
        job.current = null
        onCapture(evidence)
        onClose()
      }
    } catch (cause) {
      if (job.current === queryId) {
        job.current = null
        setError(formatError(cause))
        setPending(false)
        setCancelling(false)
      }
    }
  }

  async function cancel() {
    if (!job.current) {
      onClose()
      return
    }
    setCancelling(true)
    try {
      await commands.cancelApplicationLogQuery(job.current)
    } catch (cause) {
      setError(formatError(cause))
      setCancelling(false)
    }
  }

  return <Dialog portal title="Add log evidence" onCancel={() => void cancel()}
    onKeyDown={(event) => event.stopPropagation()}
    actions={<>
      <ActionButton disabled={cancelling} onClick={() => void cancel()}>{pending ? 'Cancel query' : 'Cancel'}</ActionButton>
      <ActionButton loading={pending} disabled={!targetId || !kql.trim() || !start || !end}
        onClick={() => void capture()}>Run query and attach</ActionButton>
    </>}>
    {sources?.length === 0 ? <p>Configure an Application Insights source in Settings first.</p> : null}
    {sources?.length ? <>
      <label className="field"><span>Application Insights query target</span>
        <select value={targetId} disabled={pending} onChange={(event) => select(event.target.value)}>
          <option value="" disabled>Choose a target</option>
          {sources.map((source) => <option key={source.resourceId} value={source.resourceId}>{source.label}</option>)}
        </select>
      </label>
      <p>Queries use your Azure CLI sign-in. KQL can reference other resources your Azure account can access.</p>
      <label className="field"><span>Start (UTC)</span><input type="datetime-local" step="1" value={start} disabled={pending}
        onChange={(event) => setStart(event.target.value)} /></label>
      <label className="field"><span>End (UTC)</span><input type="datetime-local" step="1" value={end} disabled={pending}
        onChange={(event) => setEnd(event.target.value)} /></label>
      {recent.length ? <label className="field"><span>Recent queries for this target</span>
        <select value="" disabled={pending} onChange={(event) => setKql(recent[Number(event.target.value)] ?? '')}>
          <option value="" disabled>Choose a query</option>
          {recent.map((query, index) => <option key={query} value={index}>{query.slice(0, 100)}</option>)}
        </select>
      </label> : null}
      <label className="field"><span>KQL query</span><textarea rows={5} value={kql} disabled={pending}
        onChange={(event) => setKql(event.target.value)} /></label>
    </> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
  </Dialog>
}
