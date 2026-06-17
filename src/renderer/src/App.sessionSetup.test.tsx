// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../../shared/contracts'
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit Session details' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit Session details' }))
    fireEvent.click(screen.getByText('Optional context'))

    expect(screen.getByLabelText('Area, URL, or ticket (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Objective or notes (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Environment (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Build (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Related Reference (optional)')).toBeInTheDocument()
  })

  it('guards repeated New Session clicks and opens setup for the created Session', async () => {
    const snapshot = createSnapshot()
    const createdSession: Session = {
      ...baseSession(),
      id: 'session-2',
      title: 'New Session',
      testTarget: null,
      charter: null
    }
    const createdSnapshot = createSnapshot({ session: createdSession })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    let resolveCreate: (session: Session) => void = () => undefined
    vi.mocked(api.createSession).mockReturnValue(
      new Promise<Session>((resolve) => {
        resolveCreate = resolve
      })
    )
    vi.mocked(api.listSessions).mockResolvedValue([snapshot.session, createdSession])
    vi.mocked(api.getSession).mockImplementation(async (id) => (id === createdSession.id ? createdSnapshot : snapshot))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    const newSessionButton = screen.getByRole('button', { name: 'New Session' })
    fireEvent.click(newSessionButton)
    fireEvent.click(newSessionButton)

    expect(api.createSession).toHaveBeenCalledTimes(1)
    resolveCreate(createdSession)

    expect(await screen.findByRole('heading', { name: 'New Session' })).toBeInTheDocument()
    expect(screen.getByLabelText('Session setup fields')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Capture' })).toHaveClass('selected')
  })

  it('keeps Session row opening separate from the sidebar delete action', async () => {
    const currentSession = baseSession()
    const archiveSession: Session = {
      ...baseSession(),
      id: 'session-archive',
      title: 'Archive cleanup',
      testTarget: 'Archive',
      charter: 'Review saved sessions'
    }
    const currentSnapshot = createSnapshot({ session: currentSession })
    const archiveSnapshot = createSnapshot({ session: archiveSession })
    const api = installQaScribeApi(currentSnapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.listSessions).mockResolvedValue([currentSession, archiveSession])
    vi.mocked(api.getSession).mockImplementation(async (id) => (id === archiveSession.id ? archiveSnapshot : currentSnapshot))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Archive cleanup\./ }))
    expect(await screen.findByRole('heading', { name: 'Archive cleanup' })).toBeInTheDocument()

    vi.mocked(api.getSession).mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Session: Session' }))

    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith(currentSession.id))
    expect(api.getSession).not.toHaveBeenCalledWith(currentSession.id)
  })

  it('deletes the selected Session from the sidebar and returns to launch state when none remain', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.listSessions).mockResolvedValueOnce([snapshot.session]).mockResolvedValueOnce([snapshot.session]).mockResolvedValueOnce([])
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Session: Session' }))

    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith(snapshot.session.id))
    expect(await screen.findByText('Start a local testing Session and capture the raw material while it is still fresh.')).toBeInTheDocument()
  })
})
