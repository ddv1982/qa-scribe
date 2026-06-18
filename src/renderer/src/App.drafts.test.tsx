// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Draft, Finding as StoredFinding } from '../../shared/contracts'
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
    fireEvent.click(screen.getByRole('button', { name: 'Output' }))
    expect(await screen.findByRole('heading', { name: 'Persisted Report' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('More draft actions'))
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
    fireEvent.click(screen.getByRole('button', { name: 'Output' }))
    fireEvent.click(screen.getByLabelText('More draft actions'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Draft' }))
    fireEvent.change(screen.getByLabelText('Session Report Draft'), { target: { value: '# Dirty report' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Draft' }))

    await waitFor(() => expect(api.deleteDraft).toHaveBeenCalledWith('draft-1'))
    await sleep(750)
    expect(api.updateDraft).not.toHaveBeenCalled()
    expect(api.createDraft).not.toHaveBeenCalled()
    expect(await screen.findByRole('heading', { name: 'No draft' })).toBeInTheDocument()
  })

  it('uses edited Jira markdown for bug cards and scoped draft copy actions', async () => {
    const initialBody = [
      '# Stored report',
      '',
      '## Jira Bug Drafts',
      '',
      '### Stored checkout bug',
      '',
      'Stored stale description.',
      '',
      '**Steps to Reproduce**',
      '1. Use the old checkout'
    ].join('\n')
    const editedBody = [
      '# Edited report',
      '',
      '## What Was Tested',
      '',
      'Checkout smoke.',
      '',
      '## Jira Bug Drafts',
      '',
      '### Edited checkout bug',
      '',
      'Edited draft description.',
      '',
      '**Steps to Reproduce**',
      '1. Submit a valid card',
      '',
      '**Expected Result:** The order is confirmed.',
      '',
      '**Actual Result:** Checkout remains blocked.',
      '',
      '**Evidence**',
      '- checkout.png'
    ].join('\n')
    const snapshot = createSnapshot({
      drafts: [sessionReportDraft({ body: initialBody })],
      findings: [storedFinding({ title: 'Fallback Finding bug' })]
    })
    installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Output' }))
    expect(await screen.findByText('Stored checkout bug')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('More draft actions'))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Draft' }))
    fireEvent.change(screen.getByLabelText('Session Report Draft'), { target: { value: editedBody } })

    expect(await screen.findByText('Edited checkout bug')).toBeInTheDocument()
    expect(screen.queryByText('Stored checkout bug')).not.toBeInTheDocument()
    expect(screen.queryByText('Fallback Finding bug')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Copy Jira bug draft'))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('Title: Edited checkout bug')))
    expect(writeText.mock.calls.at(-1)?.[0]).toContain('Expected:\nThe order is confirmed.')
    expect(writeText.mock.calls.at(-1)?.[0]).not.toContain('Stored stale description')

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith('# Edited report\n\n## What Was Tested\n\nCheckout smoke.')
    )

    fireEvent.click(screen.getByRole('button', { name: 'Copy Full Draft' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(editedBody))
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

function storedFinding(input: Partial<StoredFinding> = {}): StoredFinding {
  return {
    id: 'finding-1',
    sessionId: 'session-1',
    title: 'Checkout failure',
    body: 'Checkout cannot complete.',
    kind: 'bug',
    metadataJson: null,
    createdAt: '2026-06-15T00:04:00.000Z',
    updatedAt: '2026-06-15T00:04:00.000Z',
    ...input
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
