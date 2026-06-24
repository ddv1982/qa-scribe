import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { draftFixture, entryFixture, findingFixture, generationStatusFixture, providerStatusFixture, sessionFixture, settingsFixture } from './test/fixtures'

const tauriMock = vi.hoisted(() => ({
  cancelAiActionJob: vi.fn(),
  copyAttachmentImageToClipboard: vi.fn(),
  createDraft: vi.fn(),
  createEntry: vi.fn(),
  createFinding: vi.fn(),
  createSession: vi.fn(),
  deleteDraft: vi.fn(),
  deleteFinding: vi.fn(),
  deleteSession: vi.fn(),
  getProviderStatus: vi.fn(),
  getSettings: vi.fn(),
  importClipboardScreenshot: vi.fn(),
  listDrafts: vi.fn(),
  listEntries: vi.fn(),
  listFindings: vi.fn(),
  listSessions: vi.fn(),
  reopenSession: vi.fn(),
  startAiActionJob: vi.fn(),
  updateDraft: vi.fn(),
  updateEntry: vi.fn(),
  updateFinding: vi.fn(),
  updateSession: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock('./tauri', () => tauriMock)

vi.mock('./editor/RichTextEditor', () => ({
  FormatToolbar: () => <div data-testid="format-toolbar" />,
  RichTextEditor: ({ ariaLabel, editorId, onChange, readOnly, value }: { ariaLabel?: string; editorId?: string; onChange?: (value: string) => void; readOnly?: boolean; value: string }) => (
    <textarea
      aria-label={ariaLabel ?? editorId ?? 'Rich text editor'}
      readOnly={readOnly}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

describe('App workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })

    tauriMock.getSettings.mockResolvedValue(settingsFixture())
    tauriMock.getProviderStatus.mockResolvedValue(providerStatusFixture())
    tauriMock.listSessions.mockResolvedValue([sessionFixture()])
    tauriMock.reopenSession.mockResolvedValue(sessionFixture())
    tauriMock.listEntries.mockResolvedValue([entryFixture()])
    tauriMock.listDrafts.mockResolvedValue([])
    tauriMock.listFindings.mockResolvedValue([])
    tauriMock.createEntry.mockResolvedValue(entryFixture())
    tauriMock.createSession.mockResolvedValue(sessionFixture({ id: 'session-2', title: 'Untitled note 2' }))
    tauriMock.updateSession.mockImplementation(async (_id: string, patch: { title?: string | null }) => sessionFixture({ title: patch.title ?? 'Checkout note' }))
    tauriMock.updateEntry.mockImplementation(async (_id: string, patch: { body?: string | null }) => entryFixture({ body: patch.body ?? '<p>Checkout fails after payment.</p>' }))
    tauriMock.createDraft.mockResolvedValue(draftFixture())
    tauriMock.createFinding.mockResolvedValue(findingFixture())
    tauriMock.startAiActionJob.mockResolvedValue({ jobId: 'job-1', status: generationStatusFixture() })
    tauriMock.cancelAiActionJob.mockResolvedValue(generationStatusFixture({ state: 'cancelling' }))
    tauriMock.updateSettings.mockImplementation(async (settings) => settings)
  })

  afterEach(() => {
    cleanup()
  })

  it('boots the first note and creates a missing editable note entry', async () => {
    tauriMock.listEntries.mockResolvedValueOnce([])
    render(<App />)

    await waitFor(() => expect(screen.getByDisplayValue('Checkout note')).toBeInTheDocument())

    expect(tauriMock.createEntry).toHaveBeenCalledWith({
      sessionId: 'session-1',
      entryType: 'note',
      title: 'Note body',
      body: '',
      metadataJson: null,
      excludedFromGeneration: false,
    })
  })

  it('creates a new note from the top action', async () => {
    const user = userEvent.setup()
    tauriMock.listSessions.mockResolvedValueOnce([sessionFixture()]).mockResolvedValueOnce([sessionFixture({ id: 'session-2', title: 'Untitled note 2' })])
    render(<App />)

    await screen.findByDisplayValue('Checkout note')
    await user.click(screen.getByRole('button', { name: /^new note$/i }))

    await waitFor(() => expect(tauriMock.createSession).toHaveBeenCalledWith({ title: 'Untitled note 1', sessionContext: null, objectiveNotes: null }))
    expect(tauriMock.createEntry).toHaveBeenLastCalledWith({
      sessionId: 'session-2',
      entryType: 'note',
      title: 'Note body',
      body: '',
      metadataJson: null,
      excludedFromGeneration: false,
    })
  })

  it('confirms generation through preflight before starting an AI job', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByDisplayValue('Checkout note')
    await user.click(screen.getByRole('button', { name: /generate test cases/i }))
    const dialog = screen.getByRole('dialog', { name: /generate test cases/i })
    expect(dialog).toBeInTheDocument()
    expect(tauriMock.startAiActionJob).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: /^generate test cases$/i }))

    await waitFor(() =>
      expect(tauriMock.startAiActionJob).toHaveBeenCalledWith(
        {
          sessionId: 'session-1',
          provider: 'codex_cli',
          model: 'default',
          reasoningEffort: 'low',
          action: 'testware',
          noteEntryId: 'entry-1',
        },
        expect.any(Function),
      ),
    )
  })

  it('creates manual testware after saving pending note edits', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByDisplayValue('Checkout note')
    await user.click(screen.getByRole('button', { name: /testware/i }))
    await user.click(screen.getByRole('button', { name: /new testware/i }))

    await waitFor(() => expect(tauriMock.createDraft).toHaveBeenCalled())
    expect(tauriMock.createDraft.mock.calls[0][0]).toMatchObject({
      sessionId: 'session-1',
      aiRunId: null,
      kind: 'testware',
    })
  })
})
