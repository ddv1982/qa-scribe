import { useCallback, useEffect, useRef, useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { Dialog } from '../components/Dialog'
import { commands, type ApplicationInsightsComponent, type ApplicationLogSource, type AzureSubscription, type LogEvidenceSummary } from '../bindings'
import { pendingMessages, SIGN_IN_COMMAND, useAzureLogDiscovery } from '../hooks/useAzureLogDiscovery'
import { formatError, toCommandError } from '../ui/format'

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
  const [subscription, setSubscription] = useState<AzureSubscription | null>(null)
  const [components, setComponents] = useState<ApplicationInsightsComponent[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [queryHistory, setQueryHistory] = useState<{ caseId: string; targetId: string; queries: string[] } | null>(null)
  const [kql, setKql] = useState('')
  const [defaultEnd] = useState(() => Math.ceil(Date.now() / SECOND_MS) * SECOND_MS)
  const [start, setStart] = useState(() => dateField(new Date(defaultEnd - 15 * 60 * SECOND_MS)))
  const [end, setEnd] = useState(() => dateField(new Date(defaultEnd)))
  const [pending, setPending] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [querySignedOut, setQuerySignedOut] = useState(false)
  const job = useRef<string | null>(null)
  const { pending: discoveryPending, error: discoveryError, copyStatus, load, signingIn,
    cancelSignIn, copySignInCommand } = useAzureLogDiscovery()

  const discover = useCallback((id: string) => {
    setComponents(null)
    void load('components', (queryId) => commands.listApplicationInsightsComponents(queryId, id), setComponents)
  }, [load])

  const targets = new Map((sources ?? []).map((source) => [source.resourceId.toLowerCase(), source]))
  for (const { resourceId, name, resourceGroup } of components ?? []) {
    const id = resourceId.toLowerCase()
    if (!targets.has(id)) targets.set(id, { resourceId, label: `${name} (${resourceGroup})` })
  }
  const options = Array.from(targets.values())
  const targetId = targets.get(selectedId.toLowerCase())?.resourceId
    ?? (options.length === 1 && discoveryPending !== 'components' ? options[0].resourceId : '')
  const recent = queryHistory?.caseId === caseId && queryHistory.targetId === targetId ? queryHistory.queries : []
  const canSignIn = querySignedOut || discoveryError?.canSignIn
  const canRefresh = subscription && (discoveryError || error || components?.length === 0)

  useEffect(() => {
    let current = true
    void commands.getSettings().then((settings) => {
      if (!current) return
      setSources(settings.applicationLogSources ?? [])
      const savedSubscription = settings.applicationLogSubscription ?? null
      setSubscription(savedSubscription)
      if (savedSubscription) discover(savedSubscription.id)
    }).catch((cause: unknown) => {
      if (current) setError(formatError(cause))
    })
    return () => {
      current = false
      const queryId = job.current
      job.current = null
      if (queryId) void commands.cancelApplicationLogQuery(queryId).catch(() => {})
    }
  }, [discover])

  useEffect(() => {
    let current = true
    if (targetId) {
      void commands.recentApplicationLogQueries(caseId, targetId).then((queries) => {
        if (current) setQueryHistory({ caseId, targetId, queries })
      }).catch(() => {})
    }
    return () => { current = false }
  }, [caseId, targetId])

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
    setQuerySignedOut(false)
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
        setQuerySignedOut(toCommandError(cause).kind === 'azureCliSignedOut')
        setPending(false)
        setCancelling(false)
      }
    }
  }

  function signIn() {
    setError(null)
    setQuerySignedOut(false)
    void load('signIn', commands.signInAzureCli, () => {
      if (subscription) discover(subscription.id)
    })
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
      <ActionButton loading={pending} disabled={signingIn || !targetId || !kql.trim() || !start || !end}
        onClick={() => void capture()}>Run query and attach</ActionButton>
    </>}>
    {sources?.length === 0 && !subscription ? <p>Save an Azure subscription or an Application Insights source in Settings first.</p> : null}
    {discoveryPending ? <p role="status">{pendingMessages[discoveryPending]}</p> : null}
    {components?.length === 0 ? <p role="status">No Application Insights resources were found in {subscription?.name}.</p> : null}
    {discoveryError && !error ? <p className="field-error" role="alert">{discoveryError.message}</p> : null}
    {!pending && (canSignIn || signingIn || canRefresh) ? <div className="read-source-options">
      {!discoveryPending && canSignIn ? <ActionButton onClick={signIn}>Sign in with Azure CLI</ActionButton> : null}
      {signingIn ? <ActionButton disabled={discoveryPending === 'cancellingSignIn'} onClick={cancelSignIn}>Cancel sign-in</ActionButton> : null}
      {canSignIn || signingIn ? <ActionButton variant="quiet" onClick={() => void copySignInCommand()}>Copy {SIGN_IN_COMMAND}</ActionButton> : null}
      {!discoveryPending && canRefresh ? <ActionButton onClick={() => {
        setError(null)
        setQuerySignedOut(false)
        discover(subscription.id)
      }}>{discoveryError ? 'Retry discovery' : 'Refresh resources'}</ActionButton> : null}
    </div> : null}
    {copyStatus ? <p role="status">{copyStatus}</p> : null}
    {options.length ? <>
      <label className="field"><span>Application Insights query target</span>
        <select value={targetId} disabled={pending || signingIn} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="" disabled>Choose a target</option>
          {options.map((source) => <option key={source.resourceId} value={source.resourceId}>{source.label}</option>)}
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
