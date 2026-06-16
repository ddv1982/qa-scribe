// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Finding as StoredFinding } from '../../shared/contracts'
import { App } from './App'
import {
  baseEntry,
  baseImageAttachment,
  baseSession,
  codexAvailable,
  createSnapshot,
  installQaScribeApi,
  providerStatus,
  setupAppTestHooks
} from './test/appTestHelpers'

describe('App capture and evidence', () => {
  setupAppTestHooks()

  it('creates a structured Finding from the capture composer with selected Entry evidence', async () => {
    const snapshot = createSnapshot({
      entries: [baseEntry()],
      session: {
        ...baseSession(),
        title: 'Checkout finding',
        environment: 'Staging',
        buildVersion: '2026.06.16'
      }
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.createFinding).mockResolvedValue({
      id: 'finding-1',
      sessionId: snapshot.session.id,
      title: 'Valid card payment fails',
      body: 'Structured finding body',
      kind: 'bug',
      metadataJson: null,
      createdAt: '2026-06-15T00:04:00.000Z',
      updatedAt: '2026-06-15T00:04:00.000Z'
    } satisfies StoredFinding)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Checkout finding' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('heading', { name: 'Checkout completed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finding' }))
    fireEvent.change(screen.getByLabelText('Finding summary (required)'), {
      target: { value: 'Valid card payment fails' }
    })
    fireEvent.change(screen.getByLabelText('Actual result (required)'), {
      target: { value: 'The payment form shows a card error.' }
    })
    fireEvent.change(screen.getByLabelText('Expected result'), {
      target: { value: 'The order should be confirmed.' }
    })
    fireEvent.change(screen.getByLabelText('Steps to reproduce'), {
      target: { value: 'Open checkout\nSubmit valid test card' }
    })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'major' } })
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add Finding' }))

    await waitFor(() =>
      expect(api.createFinding).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: snapshot.session.id,
          title: 'Valid card payment fails',
          kind: 'bug',
          entryId: 'entry-1'
        })
      )
    )
    const payload = vi.mocked(api.createFinding).mock.calls[0]?.[0]
    expect(payload?.body).toContain('**Actual Result**')
    expect(payload?.body).toContain('The payment form shows a card error.')
    expect(JSON.parse(payload?.metadataJson ?? '{}')).toEqual(
      expect.objectContaining({
        schema: 'qa-scribe.structured-finding.v1',
        actual: 'The payment form shows a card error.',
        expected: 'The order should be confirmed.',
        steps: ['Open checkout', 'Submit valid test card'],
        severity: 'major',
        priority: 'high',
        environment: 'Staging / 2026.06.16'
      })
    )
  })

  it('renders screenshot attachment previews in the timeline', async () => {
    const snapshot = createSnapshot({
      entries: [baseEntry()],
      attachments: [baseImageAttachment()]
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.getAttachmentPreviewDataUrl).mockResolvedValue('data:image/png;base64,c2NyZWVu')

    render(<App />)

    const timeline = await screen.findByLabelText('Session Timeline')
    const preview = await within(timeline).findByRole('img', { name: 'Screenshot preview: checkout.png' })

    expect(preview).toHaveAttribute('src', 'data:image/png;base64,c2NyZWVu')
    expect(api.getAttachmentPreviewDataUrl).toHaveBeenCalledWith('attachment-1')
  })

  it('keeps an Entry selected after attaching evidence to it', async () => {
    const snapshot = createSnapshot({ entries: [baseEntry()] })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.importAttachment).mockResolvedValue(baseImageAttachment())

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('heading', { name: 'Checkout completed' }))
    const inspector = screen.getByLabelText('Inspector')
    expect(within(inspector).getByRole('heading', { name: 'Checkout completed' })).toBeInTheDocument()

    fireEvent.click(within(inspector).getByRole('button', { name: 'Attach Evidence' }))

    await waitFor(() => expect(api.importAttachment).toHaveBeenCalledWith(snapshot.session.id, 'entry-1'))
    expect(within(inspector).getByRole('heading', { name: 'Checkout completed' })).toBeInTheDocument()
  })

  it('asks before deleting Entries and Sessions', async () => {
    const snapshot = createSnapshot({ entries: [baseEntry()] })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Entry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Session' }))

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(api.deleteEntry).not.toHaveBeenCalled()
    expect(api.deleteSession).not.toHaveBeenCalled()
  })

  it('does not select an Entry when keyboarding nested Entry actions', async () => {
    const snapshot = createSnapshot({ entries: [baseEntry()] })
    installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Delete Entry' }), { key: 'Enter' })

    expect(within(screen.getByLabelText('Inspector')).queryByRole('heading', { name: 'Checkout completed' })).not.toBeInTheDocument()
  })
})
