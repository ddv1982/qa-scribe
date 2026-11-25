import { useId, useState } from 'react'
import { commands, type ApplicationInsightsComponent, type ApplicationLogSource, type AzureSubscription } from '../bindings'
import { ActionButton } from '../components/ActionButton'
import { pendingMessages, SIGN_IN_COMMAND, useAzureLogDiscovery } from '../hooks/useAzureLogDiscovery'

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

export function ApplicationLogDiscovery({ sources, disabled, onAdd, replacing = false, savedSubscription, onSubscriptionChange }: {
  sources: ApplicationLogSource[]
  replacing?: boolean
  disabled: boolean
  onAdd: (source: ApplicationLogSource) => void
  savedSubscription?: AzureSubscription | null
  onSubscriptionChange?: (subscription: AzureSubscription | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [subscriptions, setSubscriptions] = useState<AzureSubscription[] | null>(null)
  const [localSubscription, setLocalSubscription] = useState('')
  const subscription = onSubscriptionChange ? savedSubscription?.id ?? '' : localSubscription
  const [loadedComponents, setComponents] = useState<ApplicationInsightsComponent[] | null>(null)
  const components = localSubscription === subscription ? loadedComponents : null
  const [resourceId, setResourceId] = useState('')
  const { pending, error, copyStatus, load, cancelRequest, cancelSignIn, copySignInCommand, signingIn } = useAzureLogDiscovery()
  const signInNoteId = useId()

  function refreshSubscriptions(previous = '') {
    setSubscriptions(null)
    setLocalSubscription('')
    setComponents(null)
    setResourceId('')
    void load('subscriptions', commands.listAzureLogSubscriptions, (available) => {
      setSubscriptions(available)
      if (available.some(({ id }) => id === previous)) selectSubscription(previous)
    })
  }

  function discover() {
    setOpen(true)
    refreshSubscriptions(savedSubscription?.id)
  }

  function selectSubscription(id: string) {
    setLocalSubscription(id)
    setResourceId('')
    setComponents(null)
    if (id) void load('components', (queryId) => commands.listApplicationInsightsComponents(queryId, id), setComponents)
  }

  function changeSubscription(id: string) {
    onSubscriptionChange?.(subscriptions?.find((entry) => entry.id === id) ?? null)
    selectSubscription(id)
  }

  function signIn() {
    if (pending) return
    void load('signIn', commands.signInAzureCli, () => refreshSubscriptions(subscription))
  }

  function close() {
    cancelRequest()
    setOpen(false)
  }

  const configured = new Set(sources.map((source) => normalized(source.resourceId)))
  const selected = components?.find((component) => component.resourceId === resourceId)
  const canAdd = selected && !disabled && !configured.has(normalized(selected.resourceId))
  const canSignIn = error?.canSignIn || subscriptions?.length === 0
  const subscriptionListed = subscriptions?.some(({ id }) => id === subscription)

  if (!open) return <>
    {savedSubscription ? <p className="settings-note">Azure subscription: {savedSubscription.name} ({savedSubscription.id})</p> : null}
    <ActionButton variant={replacing ? "secondary" : "primary"} disabled={disabled && !onSubscriptionChange}
      onClick={discover}>{replacing ? 'Change resource' : 'Discover from Azure'}</ActionButton>
    {savedSubscription ? <ActionButton variant="quiet" onClick={() => onSubscriptionChange?.(null)}>Clear subscription</ActionButton> : null}
  </>

  return <fieldset className="read-source-fieldset application-log-discovery">
    <legend>Discover from Azure</legend>
    <p className="settings-note">{onSubscriptionChange
      ? 'Save a subscription to discover resources when adding log evidence. You can also save a resource for reuse.'
      : 'List Application Insights resources visible to your Azure CLI sign-in.'}</p>
    {subscriptions?.length ? <label className="field">
      <span>Azure subscription</span>
      <select value={subscriptionListed ? subscription : ''} disabled={signingIn}
        onChange={(event) => changeSubscription(event.target.value)}>
        <option value="" disabled>Choose a subscription</option>
        {subscriptions.map(({ id, name }) => <option key={id} value={id}>{name} ({id})</option>)}
      </select>
    </label> : null}
    {components?.length ? <label className="field">
      <span>{onSubscriptionChange ? 'Application Insights resource (optional)' : 'Application Insights resource'}</span>
      <select value={resourceId} onChange={(event) => setResourceId(event.target.value)}>
        <option value="" disabled={!onSubscriptionChange}>Choose a resource</option>
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
      {!pending && canSignIn ? <ActionButton variant={error?.canSignIn && !replacing ? 'primary' : 'secondary'} aria-describedby={signInNoteId} onClick={signIn}>Sign in with Azure CLI</ActionButton> : null}
      {signingIn ? <ActionButton disabled={pending === 'cancellingSignIn'} onClick={cancelSignIn}>Cancel sign-in</ActionButton> : null}
      {canSignIn || signingIn ? <ActionButton variant="quiet" onClick={() => void copySignInCommand()}>Copy az login</ActionButton> : null}
      {!pending && (error || subscriptions?.length === 0) ? <ActionButton onClick={() => {
        if (subscriptionListed && !error?.canSignIn) selectSubscription(subscription)
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
