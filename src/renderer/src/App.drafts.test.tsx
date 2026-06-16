// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Draft } from '../../shared/contracts'
import { App } from './App'
import {
  codexAvailable,
  createSnapshot,
  installQaScribeApi,
  providerStatus,
  setupAppTestHooks
} from './test/appTestHelpers'

describe('App Drafts behavior', () => {
  setupAppTestHooks()

  it('deletes a persisted draft and leaves the Drafts view empty', async () => {
    const persistedDraft = sessionReportDraft()
    const snapshot = createSnapshot({ drafts: [persistedDraft] })
    const afterDelete = createSnapshot({ session: snapshot.session })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    let deleted = false
    vi.mocked(api.deleteDraft).mockImplementation(async () => {
      deleted = true
    })
    vi.mocked(api.getSession).mockImplementation(async () => (deleted ? afterDelete : snapshot))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }))
    expect(await screen.findByRole('heading', { name: 'Persisted Report' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Draft' }))

    await waitFor(() => expect(api.deleteDraft).toHaveBeenCalledWith('draft-1'))
    expect(await screen.findByRole('heading', { name: 'No draft' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Persisted Report' })).not.toBeInTheDocument()
    expect(api.createDraft).not.toHaveBeenCalled()
  })

  it('does not let a stale autosave recreate a dirty draft after deletion', async () => {
    const persistedDraft = sessionReportDraft()
    const snapshot = createSnapshot({ drafts: [persistedDraft] })
    const afterDelete = createSnapshot({ session: snapshot.session })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    let deleted = false
    vi.mocked(api.deleteDraft).mockImplementation(async () => {
      deleted = true
    })
    vi.mocked(api.getSession).mockImplementation(async () => (deleted ? afterDelete : snapshot))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Draft' }))
    fireEvent.change(screen.getByLabelText('Session Report Draft'), { target: { value: '# Dirty report' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Draft' }))

    await waitFor(() => expect(api.deleteDraft).toHaveBeenCalledWith('draft-1'))
    await sleep(750)
    expect(api.updateDraft).not.toHaveBeenCalled()
    expect(api.createDraft).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'No draft' })).toBeInTheDocument()
  })
})

function sessionReportDraft(input: Partial<Draft> = {}): Draft {
  return {
    id: 'draft-1',
    sessionId: 'session-1',
    aiRunId: null,
    kind: 'session_report',
    title: 'Persisted Report',
    body: '# Persisted report',
    createdAt: '2026-06-15T00:04:00.000Z',
    updatedAt: '2026-06-15T00:04:01.000Z',
    ...input
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
