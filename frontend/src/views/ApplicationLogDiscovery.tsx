import { useCallback, useEffect, useRef, useState } from 'react'
import { commands, type ApplicationInsightsComponent, type ApplicationLogSource, type AzureSubscription } from '../bindings'
import { ActionButton } from '../components/ActionButton'
import { formatError } from '../ui/format'

const LABEL_LIMIT = 80
const normalized = (value: string) => value.trim().toLowerCase()

function uniqueLabel(component: ApplicationInsightsComponent, sources: ApplicationLogSource[]): string {
  const used = new Set(sources.map((source) => normalized(source.label)))
  const name = component.name.slice(0, LABEL_LIMIT)
  if (!used.has(normalized(name))) return name
  const group = ` (${component.resourceGroup.slice(0, 24)})`
  const base = name.slice(0, LABEL_LIMIT - group.length) + group
  let label = base
  for (let index = 2; used.has(normalized(label)); index += 1) {
    const suffix = ` ${index}`
    label = base.slice(0, LABEL_LIMIT - suffix.length) + suffix
  }
  return label
}

export function ApplicationLogDiscovery({ sources, disabled, onAdd, replacing = false }: {
  sources: ApplicationLogSource[]
  replacing?: boolean
  disabled: boolean
  onAdd: (source: ApplicationLogSource) => void
}) {
  const [open, setOpen] = useState(false)
  const [subscriptions, setSubscriptions] = useState<AzureSubscription[] | null>(null)
  const [subscription, setSubscription] = useState('')
  const [components, setComponents] = useState<ApplicationInsightsComponent[] | null>(null)
  const [resourceId, setResourceId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef<string | null>(null)
  const cancelRequest = useCallback(() => {
    const id = active.current
    active.current = null
    if (id) void commands.cancelApplicationLogQuery(id).catch(() => {})
  }, [])

  useEffect(() => cancelRequest, [cancelRequest])

  async function load<T>(request: (id: string) => Promise<T>, onResult: (result: T) => void) {
    cancelRequest()
    const id = crypto.randomUUID()
    active.current = id
    setLoading(true)
    setError(null)
    try {
      const result = await request(id)
      if (active.current === id) onResult(result)
    } catch (cause) {
      if (active.current === id) setError(formatError(cause))
    } finally {
      if (active.current === id) {
        active.current = null
        setLoading(false)
      }
    }
  }

  function discover() {
    setOpen(true)
    setSubscriptions(null)
    setSubscription('')
    setComponents(null)
    setResourceId('')
    void load(commands.listAzureLogSubscriptions, setSubscriptions)
  }

  function selectSubscription(id: string) {
    setSubscription(id)
    setResourceId('')
    setComponents(null)
    void load((queryId) => commands.listApplicationInsightsComponents(queryId, id), setComponents)
  }

  function close() {
    cancelRequest()
    setOpen(false)
  }

  const configured = new Set(sources.map((source) => normalized(source.resourceId)))
  const selected = components?.find((component) => component.resourceId === resourceId)
  const canAdd = selected && !disabled && !configured.has(normalized(selected.resourceId))

  if (!open) return <ActionButton variant={replacing ? "secondary" : "primary"} disabled={disabled} onClick={discover}>{replacing ? 'Change resource' : 'Discover from Azure'}</ActionButton>

  return <fieldset className="read-source-fieldset">
    <legend>Discover from Azure</legend>
    <p className="settings-note">List Application Insights resources visible to your Azure CLI sign-in.</p>
    {subscriptions?.length ? <label className="field">
      <span>Azure subscription</span>
      <select value={subscription} onChange={(event) => selectSubscription(event.target.value)}>
        <option value="" disabled>Choose a subscription</option>
        {subscriptions.map(({ id, name }) => <option key={id} value={id}>{name} ({id})</option>)}
      </select>
    </label> : null}
    {components?.length ? <label className="field">
      <span>Application Insights resource</span>
      <select value={resourceId} onChange={(event) => setResourceId(event.target.value)}>
        <option value="" disabled>Choose a resource</option>
        {components.map(({ name, resourceGroup, resourceId: id }) => {
          const added = configured.has(normalized(id))
          return <option key={id} value={id} disabled={added}>{name} ({resourceGroup}){added ? ' · already added' : ''}</option>
        })}
      </select>
    </label> : null}
    {loading ? <p role="status">{subscription ? 'Loading Application Insights resources…' : 'Loading Azure subscriptions…'}</p> : null}
    {subscriptions?.length === 0 ? <p role="status">No Azure subscriptions were found. Check your Azure CLI sign-in or enter a resource ID manually.</p> : null}
    {components?.length === 0 ? <p role="status">No Application Insights resources were found in this subscription.</p> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
    <div className="read-source-options">
      {components?.length ? <ActionButton variant={replacing ? "secondary" : "primary"} disabled={!canAdd} onClick={() => {
        if (!canAdd) return
        onAdd({ label: uniqueLabel(selected, sources), resourceId: selected.resourceId })
        close()
      }}>{replacing ? 'Use resource' : 'Add discovered source'}</ActionButton> : null}
      {error || subscriptions?.length === 0 ? <ActionButton onClick={() => {
        if (subscription) selectSubscription(subscription)
        else discover()
      }}>Retry discovery</ActionButton> : null}
      <ActionButton variant="quiet" onClick={close}>Close discovery</ActionButton>
    </div>
  </fieldset>
}
