import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { commands, type ApplicationInsightsComponent, type ApplicationLogSource, type AzureSubscription } from '../bindings'
import { ActionButton } from '../components/ActionButton'
import { writePlainClipboard } from '../editor/clipboardExport'
import { formatError, toCommandError } from '../ui/format'

const LABEL_LIMIT = 80
const SIGN_IN_COMMAND = 'az login'
const normalized = (value: string) => value.trim().toLowerCase()
const pendingMessages = {
  subscriptions: 'Loading Azure subscriptions…',
  components: 'Loading Application Insights resources…',
  signIn: 'Complete sign-in in your browser.',
  cancellingSignIn: 'Cancelling Azure CLI sign-in…',
}

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
  const [pending, setPending] = useState<keyof typeof pendingMessages | null>(null)
  const [error, setError] = useState<{ message: string; canSignIn: boolean } | null>(null)
  const [copyStatus, setCopyStatus] = useState('')
  const signInNoteId = useId()
  const active = useRef<{ id: string; cancelling: boolean } | null>(null)
  const cancelRequest = useCallback(() => {
    const request = active.current
    active.current = null
    if (request) void commands.cancelApplicationLogQuery(request.id).catch(() => {})
  }, [])

  useEffect(() => cancelRequest, [cancelRequest])

  async function load<T>(
    stage: Exclude<keyof typeof pendingMessages, 'cancellingSignIn'>,
    request: (id: string) => Promise<T>,
    onResult: (result: T) => void,
  ) {
    cancelRequest()
    const operation = { id: crypto.randomUUID(), cancelling: false }
    active.current = operation
    setPending(stage)
    setError(null)
    setCopyStatus('')
    try {
      const result = await request(operation.id)
      if (active.current !== operation || operation.cancelling) return
      active.current = null
      setPending(null)
      onResult(result)
    } catch (cause) {
      if (active.current === operation && !operation.cancelling) setError({
        message: formatError(cause),
        canSignIn: stage === 'signIn' || toCommandError(cause).kind === 'azureCliSignedOut',
      })
    } finally {
      if (active.current === operation) {
        active.current = null
        setPending(null)
        if (operation.cancelling) setError({ message: 'Azure CLI sign-in was cancelled.', canSignIn: true })
      }
    }
  }

  function refreshSubscriptions(previous = '') {
    setSubscriptions(null)
    setSubscription('')
    setComponents(null)
    setResourceId('')
    void load('subscriptions', commands.listAzureLogSubscriptions, (available) => {
      setSubscriptions(available)
      if (available.some(({ id }) => id === previous)) selectSubscription(previous)
    })
  }

  function discover() {
    setOpen(true)
    refreshSubscriptions()
  }

  function selectSubscription(id: string) {
    setSubscription(id)
    setResourceId('')
    setComponents(null)
    void load('components', (queryId) => commands.listApplicationInsightsComponents(queryId, id), setComponents)
  }

  function signIn() {
    if (active.current || disabled) return
    void load('signIn', commands.signInAzureCli, () => refreshSubscriptions(subscription))
  }

  function cancelSignIn() {
    const operation = active.current
    if (!operation || operation.cancelling) return
    operation.cancelling = true
    setPending('cancellingSignIn')
    void commands.cancelApplicationLogQuery(operation.id).catch(() => {})
  }

  async function copySignInCommand() {
    try {
      await writePlainClipboard(SIGN_IN_COMMAND)
      setCopyStatus('Command copied.')
    } catch {
      setCopyStatus('Could not copy the command.')
    }
  }

  function close() {
    cancelRequest()
    setOpen(false)
  }

  const configured = new Set(sources.map((source) => normalized(source.resourceId)))
  const selected = components?.find((component) => component.resourceId === resourceId)
  const canAdd = selected && !disabled && !configured.has(normalized(selected.resourceId))
  const signingIn = pending === 'signIn' || pending === 'cancellingSignIn'
  const canSignIn = error?.canSignIn || subscriptions?.length === 0

  if (!open) return <ActionButton variant={replacing ? "secondary" : "primary"} disabled={disabled} onClick={discover}>{replacing ? 'Change resource' : 'Discover from Azure'}</ActionButton>

  return <fieldset className="read-source-fieldset application-log-discovery">
    <legend>Discover from Azure</legend>
    <p className="settings-note">List Application Insights resources visible to your Azure CLI sign-in.</p>
    {subscriptions?.length ? <label className="field">
      <span>Azure subscription</span>
      <select value={subscription} disabled={signingIn} onChange={(event) => selectSubscription(event.target.value)}>
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
    {pending ? <p role="status">{pendingMessages[pending]}</p> : null}
    {!pending && subscriptions?.length === 0 ? <p role="status">No Azure subscriptions were found. Check your Azure CLI sign-in or enter a resource ID manually.</p> : null}
    {components?.length === 0 ? <p role="status">No Application Insights resources were found in this subscription.</p> : null}
    {error ? <p className="field-error" role="alert">{error.message}</p> : null}
    <div className="read-source-options">
      {components?.length ? <ActionButton variant={replacing ? "secondary" : "primary"} disabled={!canAdd} onClick={() => {
        if (!canAdd) return
        onAdd({ label: uniqueLabel(selected, sources), resourceId: selected.resourceId })
        close()
      }}>{replacing ? 'Use resource' : 'Add discovered source'}</ActionButton> : null}
      {!pending && canSignIn ? <ActionButton variant={error?.canSignIn && !replacing ? 'primary' : 'secondary'} aria-describedby={signInNoteId} disabled={disabled} onClick={signIn}>Sign in with Azure CLI</ActionButton> : null}
      {signingIn ? <ActionButton disabled={pending === 'cancellingSignIn'} onClick={cancelSignIn}>Cancel sign-in</ActionButton> : null}
      {canSignIn || signingIn ? <ActionButton variant="quiet" onClick={() => void copySignInCommand()}>Copy az login</ActionButton> : null}
      {!pending && (error || subscriptions?.length === 0) ? <ActionButton onClick={() => {
        if (subscription && !error?.canSignIn) selectSubscription(subscription)
        else refreshSubscriptions(subscription)
      }}>Retry discovery</ActionButton> : null}
      <ActionButton variant="quiet" onClick={close}>Close discovery</ActionButton>
    </div>
    {canSignIn || signingIn ? <p className="settings-note" id={signInNoteId}>
      Sign-in uses your Azure CLI profile and may change its default subscription. You can also run <code>{SIGN_IN_COMMAND}</code> in a terminal and retry discovery.
    </p> : null}
    {copyStatus ? <p role="status">{copyStatus}</p> : null}
  </fieldset>
}
