// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import {
  baseEntry,
  baseSession,
  codexAvailable,
  createSnapshot,
  installQaScribeApi,
  providerStatus,
  setupAppTestHooks
} from './test/appTestHelpers'

describe('App autosave behavior', () => {
  setupAppTestHooks()

  it('autosaves Session setup edits after a short pause', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Session details' }))
    fireEvent.change(screen.getByLabelText('Title (required)'), { target: { value: 'Updated Session' } })

    await waitFor(
      () => {
        expect(api.updateSession).toHaveBeenCalledWith(snapshot.session.id, expect.objectContaining({ title: 'Updated Session' }))
      },
      { timeout: 1500 }
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('flushes dirty Session setup edits before opening Generation Context', async () => {
    const snapshot = createSnapshot({ entries: [baseEntry()] })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Session details' }))
    fireEvent.click(screen.getByText('Optional context'))
    fireEvent.change(screen.getByLabelText('Area, URL, or ticket (optional)'), { target: { value: 'Updated checkout' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate Testware/i }))

    await waitFor(() => expect(api.createGenerationContext).toHaveBeenCalledWith(snapshot.session.id))
    expect(api.updateSession).toHaveBeenCalledWith(
      snapshot.session.id,
      expect.objectContaining({ testTarget: 'Updated checkout' })
    )
    expect(vi.mocked(api.updateSession).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.createGenerationContext).mock.invocationCallOrder[0]
    )
  })

  it('flushes dirty Session setup edits before switching Sessions', async () => {
    const snapshot = createSnapshot()
    const otherSnapshot = createSnapshot({
      session: { ...baseSession(), id: 'session-2', title: 'Other Session', testTarget: 'Search' }
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.listSessions).mockResolvedValue([snapshot.session, otherSnapshot.session])
    vi.mocked(api.getSession).mockImplementation(async (id) => (id === otherSnapshot.session.id ? otherSnapshot : snapshot))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Session details' }))
    fireEvent.change(screen.getByLabelText('Title (required)'), { target: { value: 'Before switch' } })
    fireEvent.click(screen.getByText('Other Session').closest('button') as HTMLButtonElement)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Other Session' })).toBeInTheDocument())
    expect(api.updateSession).toHaveBeenCalledWith(snapshot.session.id, expect.objectContaining({ title: 'Before switch' }))
    expect(vi.mocked(api.updateSession).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.getSession).mock.invocationCallOrder[1]
    )
  })

  it('blocks Session switching when the dirty title is empty', async () => {
    const snapshot = createSnapshot()
    const otherSnapshot = createSnapshot({
      session: { ...baseSession(), id: 'session-2', title: 'Other Session', testTarget: 'Search' }
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.listSessions).mockResolvedValue([snapshot.session, otherSnapshot.session])
    vi.mocked(api.getSession).mockImplementation(async (id) => (id === otherSnapshot.session.id ? otherSnapshot : snapshot))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Session details' }))
    fireEvent.change(screen.getByLabelText('Title (required)'), { target: { value: '' } })
    fireEvent.click(screen.getByText('Other Session').closest('button') as HTMLButtonElement)

    expect(await screen.findByText('Title is required.')).toBeInTheDocument()
    expect(await screen.findByText('Add a Session title before continuing')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Session' })).toBeInTheDocument()
    expect(api.updateSession).not.toHaveBeenCalled()
    expect(api.getSession).toHaveBeenCalledTimes(1)
  })

  it('autosaves Session Report Draft edits', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.createDraft).mockImplementation(async (input) => ({
      id: 'draft-1',
      sessionId: input.sessionId,
      aiRunId: null,
      kind: 'session_report',
      title: input.title,
      body: input.body,
      createdAt: '2026-06-15T00:04:00.000Z',
      updatedAt: '2026-06-15T00:04:01.000Z'
    }))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Output' }))
    fireEvent.click(screen.getByLabelText('More draft actions'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Draft' }))
    fireEvent.change(screen.getByLabelText('Session Report Draft'), { target: { value: '# Edited report' } })

    await waitFor(
      () => {
        expect(api.createDraft).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: snapshot.session.id, body: '# Edited report' })
        )
      },
      { timeout: 1500 }
    )
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('shows a failed status when Draft autosave fails', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.createDraft).mockRejectedValue(new Error('disk full'))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Output' }))
    fireEvent.click(screen.getByLabelText('More draft actions'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Draft' }))
    fireEvent.change(screen.getByLabelText('Session Report Draft'), { target: { value: '# Unsaved report' } })

    expect(await screen.findByText('Save failed', {}, { timeout: 1500 })).toBeInTheDocument()
  })
})
