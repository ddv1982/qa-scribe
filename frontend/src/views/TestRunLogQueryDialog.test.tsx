import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { commands } from '../bindings'
import { settingsFixture } from '../test/fixtures'

import { TestRunLogQueryDialog } from './TestRunLogQueryDialog'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('includes the current second in the default 15-minute UTC window', async () => {
  vi.spyOn(commands, 'getSettings').mockResolvedValue(settingsFixture({
    applicationLogSources: [{ label: 'Acceptance', resourceId: 'fixture' }],
  }))
  vi.spyOn(commands, 'recentApplicationLogQueries').mockResolvedValue([])
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-24T10:15:35.125Z'))
  render(<TestRunLogQueryDialog caseId="case-1" onCapture={vi.fn()} onClose={vi.fn()} />)
  const start = await screen.findByLabelText<HTMLInputElement>('Start (UTC)')
  const end = screen.getByLabelText<HTMLInputElement>('End (UTC)')
  expect([start, end].map((field) => new Date(field.value + 'Z').toISOString())).toEqual([
    '2026-11-24T10:00:36.000Z', '2026-11-24T10:15:36.000Z',
  ])
})

it('refreshes the saved subscription after sign-in and queries a discovered resource', async () => {
  const user = userEvent.setup()
  const subscription = { id: '11111111-1111-4111-8111-111111111111', name: 'Acceptance' }
  const resource = { resourceId: `/subscriptions/${subscription.id}/resourceGroups/qa/providers/Microsoft.Insights/components/checkout`,
    name: 'checkout', resourceGroup: 'qa' }
  vi.spyOn(commands, 'getSettings').mockResolvedValue(settingsFixture({ applicationLogSubscription: subscription }))
  vi.spyOn(commands, 'listApplicationInsightsComponents')
    .mockRejectedValueOnce({ kind: 'azureCliSignedOut', message: 'Sign in to Azure CLI to continue discovery.' })
    .mockResolvedValueOnce([resource])
  const login = vi.spyOn(commands, 'signInAzureCli').mockResolvedValue(null)
  vi.spyOn(commands, 'recentApplicationLogQueries').mockResolvedValue([])
  const capture = vi.spyOn(commands, 'captureApplicationLogs').mockRejectedValue(new Error('Fixture'))

  render(<TestRunLogQueryDialog caseId="case-1" onCapture={vi.fn()} onClose={vi.fn()} />)
  await user.click(await screen.findByRole('button', { name: 'Sign in with Azure CLI' }))
  expect(login).toHaveBeenCalledOnce()
  expect((await screen.findByLabelText<HTMLSelectElement>('Application Insights query target')).value).toBe(resource.resourceId)
  await user.type(screen.getByLabelText('KQL query'), 'traces')
  await user.click(screen.getByRole('button', { name: 'Run query and attach' }))
  expect(capture).toHaveBeenCalledWith('case-1', expect.any(String), expect.objectContaining({
    targetId: resource.resourceId, kql: 'traces',
  }))
})
