// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('blocks Generation Context creation when required Session fields are missing', async () => {
    const snapshot = createSnapshot({
      session: {
        ...baseSession(),
        title: 'Incomplete checkout',
        testTarget: null,
        charter: null
      }
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Incomplete checkout' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title (required)')).toBeInTheDocument()
    expect(screen.getByLabelText('Test Target (required)')).toBeInTheDocument()
    expect(screen.getByLabelText('Test Objective (required)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Generate Testware/i }))

    expect(await screen.findByText('Test Target is required.')).toBeInTheDocument()
    expect(screen.getByText('Test Objective is required.')).toBeInTheDocument()
    expect(api.createGenerationContext).not.toHaveBeenCalled()
    expect(api.generateTestware).not.toHaveBeenCalled()
  })

  it('keeps optional Session metadata behind an optional details disclosure', async () => {
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
    fireEvent.click(screen.getByText('Optional details'))

    expect(screen.getByLabelText('Environment (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Build (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Related Reference (optional)')).toBeInTheDocument()
  })
})
