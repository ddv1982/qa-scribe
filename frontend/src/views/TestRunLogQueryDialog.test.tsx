import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('../bindings', () => ({
  commands: {
    getSettings: async () => ({ applicationLogSources: [{ label: 'Acceptance', resourceId: 'fixture' }] }),
    recentApplicationLogQueries: async () => [],
  },
}))

import { TestRunLogQueryDialog } from './TestRunLogQueryDialog'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('includes the current second in the default 15-minute UTC window', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-24T10:15:35.125Z'))
  render(<TestRunLogQueryDialog caseId="case-1" onCapture={vi.fn()} onClose={vi.fn()} />)
  const start = await screen.findByLabelText<HTMLInputElement>('Start (UTC)')
  const end = screen.getByLabelText<HTMLInputElement>('End (UTC)')
  expect([start, end].map((field) => new Date(field.value + 'Z').toISOString())).toEqual([
    '2026-11-24T10:00:36.000Z', '2026-11-24T10:15:36.000Z',
  ])
})
