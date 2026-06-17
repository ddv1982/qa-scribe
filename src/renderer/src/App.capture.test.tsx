// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Entry, Finding as StoredFinding } from '../../shared/contracts'
import { App } from './App'
import {
  baseEntry,
  baseImageAttachment,
  baseSession,
  codexAvailable,
  createSnapshot,
  defaultSettings,
  installQaScribeApi,
  providerStatus,
  setupAppTestHooks
} from './test/appTestHelpers'
import { richTextMetadataSchema } from './domain/richText'

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
    fireEvent.change(screen.getByLabelText('Finding title (required)'), {
      target: { value: 'Valid card payment fails' }
    })
    fireEvent.input(screen.getByLabelText('Actual result'), {
      target: { textContent: 'The payment form shows a card error.' }
    })
    fireEvent.input(screen.getByLabelText('Expected result'), {
      target: { textContent: 'The order should be confirmed.' }
    })
    await waitFor(() => expect(screen.getByLabelText('Actual result')).toHaveTextContent('The payment form shows a card error.'))
    await waitFor(() => expect(screen.getByLabelText('Expected result')).toHaveTextContent('The order should be confirmed.'))
    fireEvent.change(screen.getByLabelText('Steps to reproduce'), {
      target: { value: 'Open checkout\nSubmit valid test card' }
    })
    fireEvent.click(screen.getByRole('radio', { name: 'High' }))
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
        actualMetadataJson: expect.any(String),
        expected: 'The order should be confirmed.',
        expectedMetadataJson: expect.any(String),
        steps: ['Open checkout', 'Submit valid test card'],
        severity: 'high',
        priority: 'high',
        environment: 'Staging / 2026.06.16'
      })
    )
  })

  it('creates a Finding from a title-only finding draft', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.createFinding).mockResolvedValue({
      id: 'finding-1',
      sessionId: snapshot.session.id,
      title: 'Clarify empty checkout state',
      body: 'No additional finding details yet.',
      kind: 'bug',
      metadataJson: null,
      createdAt: '2026-06-15T00:04:00.000Z',
      updatedAt: '2026-06-15T00:04:00.000Z'
    } satisfies StoredFinding)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finding' }))
    fireEvent.change(screen.getByLabelText('Finding title (required)'), {
      target: { value: 'Clarify empty checkout state' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add Finding' }))

    await waitFor(() =>
      expect(api.createFinding).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: snapshot.session.id,
          title: 'Clarify empty checkout state',
          body: 'No additional finding details yet.'
        })
      )
    )
  })

  it('applies finding template visibility and order without breaking Finding serialization', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    const settings = defaultSettings()
    settings.templates.finding = {
      fields: [
        settings.templates.finding.fields.find((field) => field.id === 'title')!,
        { ...settings.templates.finding.fields.find((field) => field.id === 'expected')!, type: 'textarea' as const },
        { ...settings.templates.finding.fields.find((field) => field.id === 'actual')!, type: 'textarea' as const },
        { ...settings.templates.finding.fields.find((field) => field.id === 'severity')!, enabled: false },
        { ...settings.templates.finding.fields.find((field) => field.id === 'priority')!, enabled: false },
        settings.templates.finding.fields.find((field) => field.id === 'notes')!
      ]
    }
    vi.mocked(api.getSettings).mockResolvedValue(settings)
    vi.mocked(api.createFinding).mockResolvedValue({
      id: 'finding-1',
      sessionId: snapshot.session.id,
      title: 'Template-driven finding',
      body: 'Structured finding body',
      kind: 'bug',
      metadataJson: null,
      createdAt: '2026-06-15T00:04:00.000Z',
      updatedAt: '2026-06-15T00:04:00.000Z'
    } satisfies StoredFinding)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finding' }))
    expect(screen.queryByLabelText('Severity')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Priority')).not.toBeInTheDocument()
    const expectedEditor = screen.getByLabelText('Expected result')
    const actualEditor = screen.getByLabelText('Actual result')
    expect(expectedEditor.tagName).toBe('TEXTAREA')
    expect(actualEditor.tagName).toBe('TEXTAREA')
    expect(expectedEditor.compareDocumentPosition(actualEditor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Finding title (required)'), { target: { value: 'Template-driven finding' } })
    fireEvent.input(expectedEditor, { target: { textContent: 'Expected value remains visible.' } })
    fireEvent.input(actualEditor, { target: { textContent: 'Actual value remains visible.' } })
    await waitFor(() => expect(expectedEditor).toHaveTextContent('Expected value remains visible.'))
    await waitFor(() => expect(actualEditor).toHaveTextContent('Actual value remains visible.'))
    fireEvent.click(screen.getByRole('button', { name: 'Add Finding' }))

    await waitFor(() => expect(api.createFinding).toHaveBeenCalled())
    const payload = vi.mocked(api.createFinding).mock.calls[0]?.[0]
    expect(JSON.parse(payload?.metadataJson ?? '{}')).toEqual(
      expect.objectContaining({
        expected: 'Expected value remains visible.',
        actual: 'Actual value remains visible.',
        severity: 'medium',
        priority: 'medium'
      })
    )
  })

  it('attaches evidence from a finding result editor and links it after saving the Finding', async () => {
    const draftAttachment = { ...baseImageAttachment(), id: 'finding-attachment-1', entryId: null }
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.importAttachment).mockResolvedValue(draftAttachment)
    vi.mocked(api.createFinding).mockResolvedValue({
      id: 'finding-1',
      sessionId: snapshot.session.id,
      title: 'Finding with attached result evidence',
      body: 'Structured finding body',
      kind: 'bug',
      metadataJson: null,
      createdAt: '2026-06-15T00:04:00.000Z',
      updatedAt: '2026-06-15T00:04:00.000Z'
    } satisfies StoredFinding)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finding' }))
    fireEvent.change(screen.getByLabelText('Finding title (required)'), {
      target: { value: 'Finding with attached result evidence' }
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Attach evidence' })[0]!)
    const dialog = screen.getByRole('dialog', { name: 'Attach Evidence' })
    expect(within(dialog).getByText('Attach to Finding draft expected result')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /Browse/ }))

    expect(await screen.findByText(/1 draft Evidence/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add Finding' }))

    await waitFor(() => expect(api.createFinding).toHaveBeenCalled())
    expect(api.importAttachment).toHaveBeenCalledWith(snapshot.session.id, undefined)
    expect(api.createEvidenceLink).toHaveBeenCalledWith({ findingId: 'finding-1', attachmentId: 'finding-attachment-1' })
  })

  it('applies note template visibility and field types', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    const settings = defaultSettings()
    settings.templates.note = {
      fields: [
        { ...settings.templates.note.fields.find((field) => field.id === 'title')!, enabled: false },
        { ...settings.templates.note.fields.find((field) => field.id === 'body')!, type: 'textarea' as const },
        settings.templates.note.fields.find((field) => field.id === 'evidence')!
      ]
    }
    vi.mocked(api.getSettings).mockResolvedValue(settings)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Note title')).not.toBeInTheDocument()
    const noteBody = screen.getByLabelText('Note body')
    expect(noteBody.tagName).toBe('TEXTAREA')
    fireEvent.change(noteBody, { target: { value: 'Template note body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))

    await waitFor(() =>
      expect(api.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '',
          body: 'Template note body',
          metadataJson: null
        })
      )
    )
  })

  it('saves a note when the template disables the body field', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    const settings = defaultSettings()
    settings.templates.note = {
      fields: [
        settings.templates.note.fields.find((field) => field.id === 'title')!,
        { ...settings.templates.note.fields.find((field) => field.id === 'body')!, enabled: false }
      ]
    }
    vi.mocked(api.getSettings).mockResolvedValue(settings)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Note body')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Title-only template note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))

    await waitFor(() =>
      expect(api.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Title-only template note',
          body: 'Title-only template note'
        })
      )
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

  it('renders non-image attachment metadata in the timeline and inspector', async () => {
    const logAttachment = {
      ...baseImageAttachment(),
      id: 'attachment-log',
      filename: 'console.log',
      mimeType: 'text/plain',
      sizeBytes: 2048,
      relativePath: 'session-1/attachment-log.txt'
    }
    const snapshot = createSnapshot({
      entries: [baseEntry()],
      attachments: [logAttachment]
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    const timeline = await screen.findByLabelText('Session Timeline')
    expect(within(timeline).getByText('console.log')).toBeInTheDocument()
    expect(within(timeline).getByText('text/plain')).toBeInTheDocument()
    expect(within(timeline).getByText('2 KB')).toBeInTheDocument()
    expect(api.getAttachmentPreviewDataUrl).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('heading', { name: 'Checkout completed' }))
    const inspector = screen.getByLabelText('Inspector')
    expect(within(inspector).getByLabelText('Selected Entry content')).toHaveTextContent('Order confirmation displayed.')
    expect(within(inspector).getByText('console.log')).toBeInTheDocument()
    expect(within(inspector).getByText('text/plain / 2 KB')).toBeInTheDocument()
  })

  it('edits selected Entry content from the inspector', async () => {
    let snapshot = createSnapshot({ entries: [baseEntry()] })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.getSession).mockImplementation(async () => snapshot)
    vi.mocked(api.updateEntry).mockImplementation(async (_id, input) => {
      const updated = {
        ...baseEntry(),
        title: input.title ?? null,
        body: input.body ?? '',
        metadataJson: input.metadataJson ?? null,
        updatedAt: '2026-06-15T00:05:00.000Z'
      } satisfies Entry
      snapshot = createSnapshot({ entries: [updated] })
      return updated
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('heading', { name: 'Checkout completed' }))
    const inspector = screen.getByLabelText('Inspector')
    fireEvent.click(within(inspector).getByRole('button', { name: 'Edit' }))
    fireEvent.change(within(inspector).getByLabelText('Entry title'), { target: { value: 'Edited checkout note' } })
    fireEvent.change(within(inspector).getByLabelText('Entry body'), {
      target: { value: 'Edited entry body.' }
    })
    fireEvent.click(within(inspector).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(api.updateEntry).toHaveBeenCalledWith(
        'entry-1',
        expect.objectContaining({
          title: 'Edited checkout note',
          body: 'Edited entry body.'
        })
      )
    )
    expect(
      await within(screen.getByLabelText('Session Timeline')).findByRole('heading', { name: 'Edited checkout note' })
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Inspector')).toHaveTextContent('Edited entry body.')
  })

  it('opens the evidence import modal and browses for session evidence', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.importAttachment).mockResolvedValue({
      ...baseImageAttachment(),
      entryId: null
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Evidence' }))

    const dialog = screen.getByRole('dialog', { name: 'Attach Evidence' })
    expect(within(dialog).getByRole('button', { name: /Paste Screenshot\/Image/ })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: /Browse/ }))

    await waitFor(() => expect(api.importAttachment).toHaveBeenCalledWith(snapshot.session.id, undefined))
    expect(api.importClipboardScreenshot).not.toHaveBeenCalled()
  })

  it('persists formatted note content after saving and reopening the Session', async () => {
    let snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.getSession).mockImplementation(async () => snapshot)
    vi.mocked(api.createEntry).mockImplementation(async (input) => {
      const entry = {
        ...baseEntry(),
        id: 'entry-rich',
        title: input.title ?? null,
        body: input.body,
        metadataJson: input.metadataJson ?? null,
        createdAt: '2026-06-15T00:02:00.000Z',
        updatedAt: '2026-06-15T00:02:00.000Z'
      } satisfies Entry
      snapshot = createSnapshot({
        entries: [entry]
      })
      return entry
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Formatted note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    fireEvent.input(screen.getByLabelText('Note body'), { target: { textContent: 'Important behavior' } })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Note' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))

    await waitFor(() => expect(api.createEntry).toHaveBeenCalled())
    const payload = vi.mocked(api.createEntry).mock.calls[0]?.[0]
    expect(payload?.metadataJson).toBeTruthy()
    expect(JSON.parse(payload?.metadataJson ?? '{}')).toEqual(
      expect.objectContaining({
        schema: richTextMetadataSchema,
        text: 'Important behavior'
      })
    )
    expect(await within(screen.getByLabelText('Session Timeline')).findByRole('heading', { name: 'Formatted note' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Session Timeline')).getByText('Important behavior').tagName).toBe('STRONG')
  })

  it('reveals a saved note even when timeline filters were active', async () => {
    let snapshot = createSnapshot({ entries: [baseEntry()] })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.getSession).mockImplementation(async () => snapshot)
    vi.mocked(api.createEntry).mockImplementation(async (input) => {
      const entry = {
        ...baseEntry(),
        id: 'entry-filtered',
        type: 'note',
        title: input.title ?? null,
        body: input.body,
        metadataJson: input.metadataJson ?? null,
        createdAt: '2026-06-15T00:03:00.000Z',
        updatedAt: '2026-06-15T00:03:00.000Z'
      } satisfies Entry
      snapshot = createSnapshot({ entries: [baseEntry(), entry] })
      return entry
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter by Entry type'), { target: { value: 'observation' } })
    expect(screen.getByRole('heading', { name: 'No matching Entries' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Filtered note' } })
    fireEvent.input(screen.getByLabelText('Note body'), { target: { textContent: 'Saved under an active filter.' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Note' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Add Note' }))

    expect(await within(screen.getByLabelText('Session Timeline')).findByRole('heading', { name: 'Filtered note' })).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by Entry type')).toHaveValue('all')
    expect(screen.getByLabelText('Search Entries')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Select Entry: Filtered note' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('finds Entries by attachment filename', async () => {
    const snapshot = createSnapshot({
      entries: [baseEntry()],
      attachments: [{ ...baseImageAttachment(), filename: 'network.har', mimeType: 'application/json' }]
    })
    installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search Entries'), { target: { value: 'network.har' } })

    expect(screen.getByRole('heading', { name: 'Checkout completed' })).toBeInTheDocument()
    expect(screen.getByText('1 of 1 Entries')).toBeInTheDocument()
  })

  it('prefills a structured Finding draft from an Entry instead of immediately saving a bug', async () => {
    const snapshot = createSnapshot({ entries: [baseEntry()] })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create Finding from Entry' }))

    expect(api.createFinding).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Finding' })).toHaveClass('selected')
    expect(screen.getByLabelText('Finding title (required)')).toHaveValue('Checkout completed')
    expect(screen.getByLabelText('Actual result')).toHaveTextContent('Order confirmation displayed.')
    expect(screen.getByLabelText('Link selected Entry: Checkout completed')).toBeChecked()
  })

  it('attaches evidence from the note editor by first saving the draft note', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.createEntry).mockResolvedValue({
      ...baseEntry(),
      id: 'entry-draft',
      title: 'Screenshot note',
      body: 'Attach this screenshot',
      metadataJson: null
    })
    vi.mocked(api.importAttachment).mockResolvedValue({
      ...baseImageAttachment(),
      entryId: 'entry-draft'
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Screenshot note' } })
    fireEvent.input(screen.getByLabelText('Note body'), { target: { textContent: 'Attach this screenshot' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Note' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Attach evidence' }))

    expect(api.createEntry).not.toHaveBeenCalled()
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Attach Evidence' })).getByRole('button', { name: /Browse/ }))

    await waitFor(() =>
      expect(api.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: snapshot.session.id,
          type: 'note',
          title: 'Screenshot note',
          body: 'Attach this screenshot'
        })
      )
    )
    expect(api.importAttachment).toHaveBeenCalledWith(snapshot.session.id, 'entry-draft')
  })

  it('attaches clipboard evidence from the note editor after saving the draft note', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.createEntry).mockResolvedValue({
      ...baseEntry(),
      id: 'entry-draft',
      title: 'Pasted screenshot',
      body: 'Clipboard image',
      metadataJson: null
    })
    vi.mocked(api.importClipboardScreenshot).mockResolvedValue({
      ...baseImageAttachment(),
      entryId: 'entry-draft'
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Pasted screenshot' } })
    fireEvent.input(screen.getByLabelText('Note body'), { target: { textContent: 'Clipboard image' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Note' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Attach evidence' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Attach Evidence' })).getByRole('button', { name: /Paste Screenshot\/Image/ }))

    await waitFor(() =>
      expect(api.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: snapshot.session.id,
          type: 'note',
          title: 'Pasted screenshot',
          body: 'Clipboard image'
        })
      )
    )
    expect(api.importClipboardScreenshot).toHaveBeenCalledWith(snapshot.session.id, 'entry-draft')
    expect(api.importAttachment).not.toHaveBeenCalled()
  })

  it('deletes the draft note when clipboard evidence import returns null', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.createEntry).mockResolvedValue({
      ...baseEntry(),
      id: 'entry-draft',
      title: 'No image',
      body: 'Try paste',
      metadataJson: null
    })
    vi.mocked(api.importClipboardScreenshot).mockResolvedValue(null)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'No image' } })
    fireEvent.input(screen.getByLabelText('Note body'), { target: { textContent: 'Try paste' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Note' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Attach evidence' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Attach Evidence' })).getByRole('button', { name: /Paste Screenshot\/Image/ }))

    await waitFor(() => expect(api.importClipboardScreenshot).toHaveBeenCalledWith(snapshot.session.id, 'entry-draft'))
    expect(api.deleteEntry).toHaveBeenCalledWith('entry-draft')
    expect(api.importAttachment).not.toHaveBeenCalled()
  })

  it('deletes the draft note when file evidence import throws', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.createEntry).mockResolvedValue({
      ...baseEntry(),
      id: 'entry-draft',
      title: 'Failed file',
      body: 'Try browse',
      metadataJson: null
    })
    vi.mocked(api.importAttachment).mockRejectedValue(new Error('file dialog failed'))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Failed file' } })
    fireEvent.input(screen.getByLabelText('Note body'), { target: { textContent: 'Try browse' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Note' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Attach evidence' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Attach Evidence' })).getByRole('button', { name: /Browse/ }))

    await waitFor(() => expect(api.importAttachment).toHaveBeenCalledWith(snapshot.session.id, 'entry-draft'))
    expect(api.deleteEntry).toHaveBeenCalledWith('entry-draft')
    expect(await screen.findByText('file dialog failed')).toBeInTheDocument()
  })

  it('clears timeline filters from the filtered empty state', async () => {
    const snapshot = createSnapshot({ entries: [baseEntry()] })
    installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search Entries'), { target: { value: 'missing text' } })

    expect(screen.getByRole('heading', { name: 'No matching Entries' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))

    expect(screen.getByRole('heading', { name: 'Checkout completed' })).toBeInTheDocument()
    expect(screen.getByLabelText('Search Entries')).toHaveValue('')
  })

  it('keeps an Entry selected after attaching evidence to it', async () => {
    const snapshot = createSnapshot({ entries: [baseEntry()] })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.importAttachment).mockResolvedValue(baseImageAttachment())

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Inspector')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('heading', { name: 'Checkout completed' }))
    const inspector = screen.getByLabelText('Inspector')
    expect(within(inspector).getByRole('heading', { name: 'Checkout completed' })).toBeInTheDocument()
    expect(within(inspector).getByLabelText('Selected Entry content')).toHaveTextContent('Order confirmation displayed.')

    fireEvent.click(within(inspector).getByRole('button', { name: 'Attach Evidence' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Attach Evidence' })).getByRole('button', { name: /Browse/ }))

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
    fireEvent.click(screen.getByLabelText('Session actions'))
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

    expect(screen.queryByLabelText('Inspector')).not.toBeInTheDocument()
  })
})
