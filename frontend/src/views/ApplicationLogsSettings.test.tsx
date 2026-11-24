import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { commands, type ApplicationInsightsComponent, type ApplicationLogSource } from '../bindings'
import { ApplicationLogsSettings } from './ApplicationLogsSettings'

const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const accounts = [{ id: first, name: 'Acceptance' }, { id: second, name: 'Production' }]

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
  vi.spyOn(commands, 'listAzureLogSubscriptions').mockRejectedValue('Sign in to Azure CLI with az login.')
  const check = vi.spyOn(commands, 'checkApplicationLogAccess').mockResolvedValue('ready')
  renderSettings()

  await user.click(screen.getByRole('button', { name: 'Discover from Azure' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign in to Azure CLI with az login.')
  await user.click(screen.getByRole('button', { name: 'Enter resource ID manually' }))
  const target = { label: 'Manual target', resourceId: component(first, 'qa').resourceId }
  await user.type(screen.getByLabelText('Source label'), target.label)
  await user.type(screen.getByLabelText('Application Insights resource ID'), target.resourceId)
  await user.click(screen.getByRole('button', { name: 'Check access' }))
  expect(check).toHaveBeenCalledWith(target)
  expect(await screen.findByText('Azure CLI can query this target.')).toBeInTheDocument()
})
