import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { commands, type ApplicationInsightsComponent, type ApplicationLogSource, type AzureSubscription } from '../bindings'
import { ApplicationLogsSettings } from './ApplicationLogsSettings'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const accounts = [{ id: first, name: 'Acceptance' }, { id: second, name: 'Production' }]
const signedOut = { kind: 'azureCliSignedOut', message: 'Sign in to Azure CLI to continue discovery.' }

function component(subscription: string, resourceGroup: string): ApplicationInsightsComponent {
  return {
    name: 'checkout', resourceGroup,
    resourceId: `/subscriptions/${subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Insights/components/checkout`,
  }
}

function renderSettings(initial: ApplicationLogSource[] = []) {
  function Settings() {
    const [sources, setSources] = useState(initial)
    return <ApplicationLogsSettings sources={sources} onChange={setSources} />
  }
  return render(<Settings />)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('updates the subscription draft independently of resource discovery', async () => {
  const user = userEvent.setup()
  vi.spyOn(commands, 'listAzureLogSubscriptions').mockResolvedValue(accounts)
  vi.spyOn(commands, 'listApplicationInsightsComponents').mockResolvedValueOnce([])
    .mockResolvedValueOnce([component(second, 'prod')])
  const onChange = vi.fn()
  function Settings() {
    const [subscription, setSubscription] = useState<AzureSubscription | null>(null)
    return <ApplicationLogsSettings sources={[]} onChange={onChange}
      subscription={subscription} onSubscriptionChange={setSubscription} />
  }
  render(<Settings />)
  await user.click(screen.getByRole('button', { name: 'Discover from Azure' }))
  const subscriptions = await screen.findByLabelText('Azure subscription')
  await user.selectOptions(subscriptions, first)
  await screen.findByText('No Application Insights resources were found in this subscription.')
  await user.selectOptions(subscriptions, second)
  expect(await screen.findByLabelText('Application Insights resource (optional)')).toHaveValue('')
  expect(onChange).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Close discovery' }))
  expect(screen.getByText(`Azure subscription: Production (${second})`)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Clear subscription' }))
  expect(screen.queryByText(`Azure subscription: Production (${second})`)).not.toBeInTheDocument()
})

it.each([false, true])('reloads the subscription list when retrying discovery (initial list empty: %s)', async (empty) => {
  const user = userEvent.setup()
  const listSubscriptions = vi.spyOn(commands, 'listAzureLogSubscriptions')
  if (empty) listSubscriptions.mockResolvedValueOnce([])
  else listSubscriptions.mockRejectedValueOnce({ kind: 'validation', message: 'Azure discovery timed out.' })
  listSubscriptions.mockResolvedValueOnce(accounts)
  const listResources = vi.spyOn(commands, 'listApplicationInsightsComponents')
    .mockResolvedValue([component(first, 'qa')])
  render(<ApplicationLogsSettings sources={[]} onChange={vi.fn()} subscription={accounts[0]}
    onSubscriptionChange={vi.fn()} />)
  await user.click(screen.getByRole('button', { name: 'Discover from Azure' }))
  await user.click(await screen.findByRole('button', { name: 'Retry discovery' }))
  expect(await screen.findByLabelText('Azure subscription')).toHaveValue(first)
  expect(await screen.findByLabelText('Application Insights resource (optional)')).toHaveValue('')
  expect(listSubscriptions).toHaveBeenCalledTimes(2)
  expect(listResources).toHaveBeenCalledExactlyOnceWith(expect.any(String), first)
})

it('keeps the latest subscription results when an older request finishes later', async () => {
  const user = userEvent.setup()
  const cancellation = vi.spyOn(commands, 'cancelApplicationLogQuery').mockResolvedValue(null)
  vi.spyOn(commands, 'listAzureLogSubscriptions').mockResolvedValue(accounts)
  let resolveOlder!: (components: ApplicationInsightsComponent[]) => void
  const older = new Promise<ApplicationInsightsComponent[]>((resolve) => { resolveOlder = resolve })
  const newer = component(second, 'prod')
  const list = vi.spyOn(commands, 'listApplicationInsightsComponents')
    .mockImplementation((_, subscription) => subscription === first ? older : Promise.resolve([newer]))
  renderSettings()

  await user.click(screen.getByRole('button', { name: 'Discover from Azure' }))
  const subscriptions = await screen.findByLabelText('Azure subscription')
  await user.selectOptions(subscriptions, first)
  await user.selectOptions(subscriptions, second)
  expect(cancellation).toHaveBeenCalledWith(list.mock.calls[0]?.[0])
  await screen.findByRole('option', { name: 'checkout (prod)' })
  await act(async () => resolveOlder([component(first, 'qa')]))
  expect(screen.queryByRole('option', { name: 'checkout (qa)' })).not.toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Application Insights resource'), newer.resourceId)
  await user.click(screen.getByRole('button', { name: 'Add discovered source' }))
  expect(screen.getByLabelText('Application Insights resource ID')).toHaveValue(newer.resourceId)
})

it('marks a saved resource as already added and labels a different resource with the same name', async () => {
  const user = userEvent.setup()
  const saved = component(first, 'qa')
  const other = component(first, 'staging')
  const check = vi.spyOn(commands, 'checkApplicationLogAccess').mockResolvedValue('ready')
  vi.spyOn(commands, 'listAzureLogSubscriptions').mockResolvedValue(accounts)
  vi.spyOn(commands, 'listApplicationInsightsComponents').mockResolvedValue([saved, other])
  renderSettings([{ label: 'Checkout', resourceId: saved.resourceId.toUpperCase() }])

  await user.click(screen.getByRole('button', { name: 'Discover from Azure' }))
  await user.selectOptions(await screen.findByLabelText('Azure subscription'), first)
  expect(await screen.findByRole('option', { name: 'checkout (qa) · already added' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Add discovered source' })).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('Application Insights resource'), other.resourceId)
  await user.click(screen.getByRole('button', { name: 'Add discovered source' }))
  expect(screen.getByDisplayValue('checkout (staging)')).toBeInTheDocument()
  expect(screen.getByDisplayValue(other.resourceId)).toBeInTheDocument()
  expect(check).not.toHaveBeenCalled()
})

it('offers manual entry after discovery fails and keeps access checking separate', async () => {
  const user = userEvent.setup()
  vi.spyOn(commands, 'listAzureLogSubscriptions').mockRejectedValue(signedOut)
  const check = vi.spyOn(commands, 'checkApplicationLogAccess').mockResolvedValue('ready')
  renderSettings()

  await user.click(screen.getByRole('button', { name: 'Discover from Azure' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(signedOut.message)
  await user.click(screen.getByRole('button', { name: 'Enter resource ID manually' }))
  const target = { label: 'Manual target', resourceId: component(first, 'qa').resourceId }
  await user.type(screen.getByLabelText('Source label'), target.label)
  await user.type(screen.getByLabelText('Application Insights resource ID'), target.resourceId)
  await user.click(screen.getByRole('button', { name: 'Check access' }))
  expect(check).toHaveBeenCalledWith(target)
  expect(await screen.findByText('Azure CLI can query this target.')).toBeInTheDocument()
})

it.each([
  ['Sign in with Azure CLI', true],
  ['Sign in with Azure CLI', false],
  ['Retry discovery', true],
  ['Retry discovery', false],
] as const)('refreshes subscriptions via %s (previous subscription available: %s)', async (action, retained) => {
  const user = userEvent.setup()
  const listSubscriptions = vi.spyOn(commands, 'listAzureLogSubscriptions')
    .mockResolvedValueOnce(accounts)
    .mockResolvedValue(retained ? accounts : accounts.slice(1))
  const listResources = vi.spyOn(commands, 'listApplicationInsightsComponents')
    .mockRejectedValueOnce(signedOut)
    .mockResolvedValue([component(first, 'qa')])
  const login = vi.spyOn(commands, 'signInAzureCli').mockResolvedValue(null)
  renderSettings()

  await user.click(screen.getByRole('button', { name: 'Discover from Azure' }))
  await user.selectOptions(await screen.findByLabelText('Azure subscription'), first)
  const recovery = await screen.findByRole('button', { name: action })
  expect(login).not.toHaveBeenCalled()
  await user.click(recovery)

  expect(login).toHaveBeenCalledTimes(action === 'Sign in with Azure CLI' ? 1 : 0)
  expect(listSubscriptions).toHaveBeenCalledTimes(2)
  expect(await screen.findByLabelText('Azure subscription')).toHaveValue(retained ? first : '')
  if (retained) {
    expect(listResources).toHaveBeenLastCalledWith(expect.any(String), first)
    expect(await screen.findByLabelText('Application Insights resource')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Add discovered source' })).toBeDisabled()
  } else {
    expect(listResources).toHaveBeenCalledTimes(1)
    expect(screen.queryByLabelText('Application Insights resource')).not.toBeInTheDocument()
  }
})

it.each(['Cancel sign-in', 'Close discovery'])('ignores a late sign-in completion after %s', async (action) => {
  const user = userEvent.setup()
  const list = vi.spyOn(commands, 'listAzureLogSubscriptions').mockResolvedValue([])
  const cancellation = vi.spyOn(commands, 'cancelApplicationLogQuery').mockResolvedValue(null)
  let finish!: (result: null) => void
  const login = vi.spyOn(commands, 'signInAzureCli').mockReturnValue(new Promise((resolve) => { finish = resolve }))
  renderSettings()

  await user.click(screen.getByRole('button', { name: 'Discover from Azure' }))
  await user.click(await screen.findByRole('button', { name: 'Sign in with Azure CLI' }))
  expect(screen.getByRole('status')).toHaveTextContent('Complete sign-in in your browser.')
  await user.click(screen.getByRole('button', { name: action }))
  expect(cancellation).toHaveBeenCalledWith(login.mock.calls[0]?.[0])
  expect(screen.queryByRole('button', { name: 'Sign in with Azure CLI' })).not.toBeInTheDocument()
  if (action === 'Cancel sign-in') {
    expect(screen.getByRole('status')).toHaveTextContent('Cancelling Azure CLI sign-in')
  }
  await act(async () => finish(null))
  expect(list).toHaveBeenCalledTimes(1)
  if (action === 'Cancel sign-in') {
    expect(screen.getByRole('button', { name: 'Sign in with Azure CLI' })).toBeEnabled()
  }
})

it('keeps terminal recovery available after a failed login and only retries discovery on request', async () => {
  const user = userEvent.setup()
  const copy = vi.spyOn(navigator.clipboard, 'writeText')
  const list = vi.spyOn(commands, 'listAzureLogSubscriptions')
    .mockResolvedValueOnce([])
    .mockResolvedValue(accounts)
  const login = vi.spyOn(commands, 'signInAzureCli')
    .mockRejectedValue({ kind: 'validation', message: 'Azure CLI sign-in did not complete.' })
  renderSettings()

  await user.click(screen.getByRole('button', { name: 'Discover from Azure' }))
  await user.click(await screen.findByRole('button', { name: 'Sign in with Azure CLI' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Azure CLI sign-in did not complete.')
  await user.click(screen.getByRole('button', { name: 'Copy az login' }))
  expect(copy).toHaveBeenCalledWith('az login')
  await user.click(screen.getByRole('button', { name: 'Retry discovery' }))
  expect(await screen.findByLabelText('Azure subscription')).toBeInTheDocument()
  expect(login).toHaveBeenCalledTimes(1)
  expect(list).toHaveBeenCalledTimes(2)
})

it('keeps access denial separate from sign-in recovery', async () => {
  const user = userEvent.setup()
  const message = 'Azure denied access to discovery metadata for this subscription.'
  vi.spyOn(commands, 'listAzureLogSubscriptions').mockResolvedValue(accounts)
  vi.spyOn(commands, 'listApplicationInsightsComponents').mockRejectedValue({ kind: 'validation', message })
  renderSettings()

  await user.click(screen.getByRole('button', { name: 'Discover from Azure' }))
  await user.selectOptions(await screen.findByLabelText('Azure subscription'), first)
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(screen.queryByRole('button', { name: 'Sign in with Azure CLI' })).not.toBeInTheDocument()
})

it('replaces a configured resource through discovery and allows removing the final source', async () => {
  const user = userEvent.setup()
  const saved = component(first, 'qa')
  const replacement = component(second, 'prod')
  vi.spyOn(commands, 'listAzureLogSubscriptions').mockResolvedValue(accounts)
  vi.spyOn(commands, 'listApplicationInsightsComponents').mockResolvedValue([replacement])
  renderSettings([{ label: 'My logs', resourceId: saved.resourceId }])

  await user.click(screen.getByRole('button', { name: 'Change resource' }))
  await user.selectOptions(await screen.findByLabelText('Azure subscription'), second)
  await user.selectOptions(await screen.findByLabelText('Application Insights resource'), replacement.resourceId)
  await user.click(screen.getByRole('button', { name: 'Use resource' }))
  expect(screen.getAllByLabelText('Application Insights resource ID')).toHaveLength(1)
  expect(screen.getByLabelText('Application Insights resource ID')).toHaveValue(replacement.resourceId)
  expect(screen.getByLabelText('Source label')).toHaveValue('My logs')
  await user.click(screen.getByRole('button', { name: 'Remove source' }))
  expect(screen.queryByLabelText('Application Insights resource ID')).not.toBeInTheDocument()
})

it('closes a replacement picker when its source is removed', async () => {
  const user = userEvent.setup()
  const removed = component(first, 'qa')
  const retained = component(first, 'staging')
  const replacement = component(second, 'prod')
  vi.spyOn(commands, 'listAzureLogSubscriptions').mockResolvedValue(accounts)
  vi.spyOn(commands, 'listApplicationInsightsComponents').mockResolvedValue([replacement])
  renderSettings([{ label: 'Remove me', resourceId: removed.resourceId }, { label: 'Keep me', resourceId: retained.resourceId }])

  const firstSource = within(screen.getByRole('group', { name: 'Source 1' }))
  await user.click(firstSource.getByRole('button', { name: 'Change resource' }))
  await user.selectOptions(await firstSource.findByLabelText('Azure subscription'), second)
  await user.selectOptions(await firstSource.findByLabelText('Application Insights resource'), replacement.resourceId)
  expect(firstSource.getByRole('button', { name: 'Use resource' })).toBeEnabled()
  await user.click(firstSource.getByRole('button', { name: 'Remove source' }))

  expect(screen.queryByRole('button', { name: 'Use resource' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Application Insights resource ID')).toHaveValue(retained.resourceId)
})
