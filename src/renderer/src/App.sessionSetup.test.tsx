// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import {
  baseSession,
  codexAvailable,
  createSnapshot,
  installQaScribeApi,
  providerStatus,
  setupAppTestHooks
} from './test/appTestHelpers'

describe('App Session setup', () => {
  setupAppTestHooks()

  it('allows Generation Context creation when optional Session context is empty', async () => {
    const snapshot = createSnapshot({
      session: {
        ...baseSession(),
        title: 'Minimal checkout notes',
        testTarget: null,
        charter: null
      }
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Minimal checkout notes' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title (required)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Test Target (required)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Test Objective (required)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Generate Testware/i }))

    await waitFor(() => expect(api.createGenerationContext).toHaveBeenCalledWith(snapshot.session.id))
    expect(api.generateTestware).not.toHaveBeenCalled()
  })

  it('keeps optional Session context behind an optional context disclosure', async () => {
    const snapshot = createSnapshot({
      session: {
        ...baseSession(),
        title: 'Checkout smoke',
        testTarget: 'Checkout',
        charter: 'Verify checkout completion'
      }
    })
    installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Checkout smoke' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Session setup'))
    fireEvent.click(screen.getByText('Optional context'))

    expect(screen.getByLabelText('Area, URL, or ticket (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Objective or notes (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Environment (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Build (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Related Reference (optional)')).toBeInTheDocument()
  })
})
