import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { draftFixture, entryFixture, findingFixture, generationStatusFixture, providerStatusFixture, sessionFixture, settingsFixture } from './test/fixtures'
import { richEditorDocumentFromHtml, richEditorDocumentToStoredBody } from './editor/editorDocument'
import { managedAttachmentImageHtml } from './editor/editorHtml'

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
  listRecentSessions: vi.fn(),
  listSessions: vi.fn(),
  openSessionNoteState: vi.fn(),
  reopenSession: vi.fn(),
  refreshProviderStatus: vi.fn(),
  startAiActionJob: vi.fn(),
  updateDraft: vi.fn(),
  updateEntry: vi.fn(),
  updateFinding: vi.fn(),
  updateSession: vi.fn(),
  updateSettings: vi.fn(),
  EDITOR_HTML_TAGS: ['a', 'b', 'br', 'em', 'h2', 'h3', 'i', 'img', 'input', 'li', 'ol', 'p', 'strong', 'ul'],
  SELF_CLOSING_EDITOR_HTML_TAGS: ['br', 'img', 'input'],
  MANAGED_ATTACHMENT_PROTOCOL: 'qa-scribe-attachment://',
}))

const tauriWindowMock = vi.hoisted(() => ({
  currentWindow: {
    onCloseRequested: vi.fn(async () => vi.fn()),
    close: vi.fn(async () => undefined),
  },
}))

vi.mock('./tauri', () => tauriMock)
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => tauriWindowMock.currentWindow }))

vi.mock('./editor/RichTextEditor', () => ({
  FormatToolbar: () => <div data-testid="format-toolbar" />,
  RichTextEditor: ({
    ariaLabel,
    editorId,
    onChange,
    readOnly,
    value,
  }: {
    ariaLabel?: string
    editorId?: string
    onChange?: (value: { schemaVersion: 1; doc: { type: string; content?: unknown[] } }) => void
    readOnly?: boolean
    value: { doc?: { content?: Array<{ content?: Array<{ text?: string }> }> } }
  }) => (
    <textarea
      aria-label={ariaLabel ?? editorId ?? 'Rich text editor'}
      readOnly={readOnly}
      value={value.doc?.content?.[0]?.content?.[0]?.text ?? ''}
      onChange={(event) =>
        onChange?.({
          schemaVersion: 1,
          doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: event.target.value }] }] },
        })
      }
    />
  ),
}))

describe('App workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureTestLocalStorage()
    window.localStorage.clear()
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })

    tauriMock.getSettings.mockResolvedValue(settingsFixture())
    tauriMock.getProviderStatus.mockResolvedValue(providerStatusFixture())
    tauriMock.refreshProviderStatus.mockResolvedValue(providerStatusFixture())
    tauriMock.listRecentSessions.mockResolvedValue([sessionFixture()])
    tauriMock.listSessions.mockResolvedValue([sessionFixture()])
    tauriMock.openSessionNoteState.mockResolvedValue(sessionNoteStateFixture())
    tauriMock.reopenSession.mockResolvedValue(sessionFixture())
    tauriMock.listEntries.mockResolvedValue([entryFixture()])
    tauriMock.listDrafts.mockResolvedValue([])
    tauriMock.listFindings.mockResolvedValue([])
    tauriMock.createEntry.mockResolvedValue(entryFixture())
    tauriMock.createSession.mockResolvedValue(sessionFixture({ id: 'session-2', title: 'Untitled note 2' }))
    tauriMock.updateSession.mockImplementation(async (_id: string, patch: { title?: string | null }) => sessionFixture({ title: patch.title ?? 'Checkout note' }))
    tauriMock.updateEntry.mockImplementation(async (_id: string, patch: { body?: string | null; bodyJson?: string | null; bodyFormat?: string | null }) =>
      entryFixture({
        body: patch.body ?? '<p>Checkout fails after payment.</p>',
        bodyJson: patch.bodyJson ?? null,
        bodyFormat: patch.bodyFormat ?? 'html',
      }),
    )
    tauriMock.createDraft.mockResolvedValue(draftFixture())
    tauriMock.createFinding.mockResolvedValue(findingFixture())
    tauriMock.startAiActionJob.mockResolvedValue({ jobId: 'job-1', status: generationStatusFixture() })
    tauriMock.cancelAiActionJob.mockResolvedValue(generationStatusFixture({ state: 'cancelling' }))
    tauriMock.updateSettings.mockImplementation(async (settings) => settings)
  })

  afterEach(() => {
    cleanup()
  })

  it('boots the first note from bounded Session Note state', async () => {
    render(<App />)

    await waitFor(() => expect(screen.getByDisplayValue('Checkout note')).toBeInTheDocument())

    expect(tauriMock.listRecentSessions).toHaveBeenCalledWith(50)
    expect(tauriMock.openSessionNoteState).toHaveBeenCalledWith('session-1')
    expect(tauriMock.listEntries).not.toHaveBeenCalled()
    expect(tauriMock.createEntry).not.toHaveBeenCalled()
  })

  it('opens the first note before provider status resolves', async () => {
    let resolveProviderStatus: (status: ReturnType<typeof providerStatusFixture>) => void = () => {}
    tauriMock.getProviderStatus.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProviderStatus = resolve
      }),
    )
    render(<App />)

    await screen.findByDisplayValue('Checkout note')
    const generateButton = screen.getByRole('button', { name: /generate test cases/i })
    expect(generateButton).toBeDisabled()

    resolveProviderStatus(providerStatusFixture())

    await waitFor(() => expect(generateButton).toBeEnabled())
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
      bodyJson: expect.any(String),
      bodyFormat: 'tiptap_json',
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
          testwarePreferences: expect.objectContaining({
            technique: 'auto',
            outputFormat: 'qa_cases',
            depth: 'balanced',
            includeNegativeCases: true,
            includeBoundaryCases: true,
            includeTestData: true,
            preserveEvidence: true,
            customInstructions: null,
          }),
        },
        expect.any(Function),
      ),
    )
  })

  it('passes the selected test design technique to testware generation', async () => {
    const user = userEvent.setup()
    render(<App />)

    await screen.findByDisplayValue('Checkout note')
    await user.click(screen.getByRole('button', { name: /generate test cases/i }))
    const dialog = screen.getByRole('dialog', { name: /generate test cases/i })
    await user.click(within(dialog).getByRole('button', { name: /boundaries/i }))
    await user.click(within(dialog).getByRole('button', { name: /^generate test cases$/i }))

    await waitFor(() =>
      expect(tauriMock.startAiActionJob).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'testware',
          testwarePreferences: expect.objectContaining({
            technique: 'equivalence_boundary',
          }),
        }),
        expect.any(Function),
      ),
    )
  })

  it('preserves managed images after note summary generation and can undo the result', async () => {
    const user = userEvent.setup()
    const originalBody = `<p>Original note.</p>${managedAttachmentImageHtml('attachment-1', 'gmail-error.png')}`
    const originalStoredBody = richEditorDocumentToStoredBody(richEditorDocumentFromHtml(originalBody))
    const generatedEntry = entryFixture({ body: '<p>Generated summary.</p>', bodyJson: null, bodyFormat: 'html' })
    tauriMock.openSessionNoteState.mockResolvedValueOnce(
      sessionNoteStateFixture({
        noteEntry: entryFixture(originalStoredBody),
      }),
    )

    render(<App />)

    await screen.findByDisplayValue('Original note.')
    await user.click(screen.getByRole('button', { name: /summarize notes/i }))
    const dialog = screen.getByRole('dialog', { name: /summarize note/i })
    await user.click(within(dialog).getByRole('button', { name: /summarize note/i }))

    await waitFor(() => expect(tauriMock.startAiActionJob).toHaveBeenCalled())
    const onEvent = tauriMock.startAiActionJob.mock.calls[0][1]
    onEvent({
      type: 'completed',
      jobId: 'job-1',
      status: generationStatusFixture({ action: 'summary', state: 'completed', progressMessage: 'Completed' }),
      result: {
        generationContext: { id: 'context-1', sessionId: 'session-1', createdAt: '2026-06-24T10:00:00.000Z' },
        aiRun: {
          id: 'ai-run-1',
          sessionId: 'session-1',
          generationContextId: 'context-1',
          provider: 'codex_cli',
          model: 'default',
          reasoningEffort: 'low',
          promptVersion: 'note-summary-v4',
          status: 'completed',
          errorMessage: null,
          createdAt: '2026-06-24T10:00:00.000Z',
          completedAt: '2026-06-24T10:00:01.000Z',
        },
        draft: null,
        finding: null,
        noteEntry: generatedEntry,
      },
    })

    await waitFor(() => expect(screen.getByDisplayValue('Generated summary.')).toBeInTheDocument())
    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({
        body: expect.stringContaining('data-attachment-id="attachment-1"'),
        bodyFormat: 'tiptap_json',
      }),
    )

    await user.click(screen.getByRole('button', { name: /undo generation/i }))

    await waitFor(() => expect(screen.getByDisplayValue('Original note.')).toBeInTheDocument())
    expect(tauriMock.updateEntry).toHaveBeenLastCalledWith(
      'entry-1',
      expect.objectContaining({
        body: expect.stringContaining('Original note.'),
        bodyJson: originalStoredBody.bodyJson,
        bodyFormat: 'tiptap_json',
      }),
    )
  })

  it('moves note picker focus with arrow keys and opens the focused note', async () => {
    const user = userEvent.setup()
    const firstSession = sessionFixture({ id: 'session-1', title: 'Alpha note' })
    const secondSession = sessionFixture({ id: 'session-2', title: 'Beta note' })
    tauriMock.listRecentSessions.mockResolvedValueOnce([firstSession, secondSession])
    tauriMock.openSessionNoteState.mockImplementation(async (sessionId: string) =>
      sessionNoteStateFixture({
        session: sessionId === secondSession.id ? secondSession : firstSession,
        noteEntry: entryFixture({ sessionId }),
      }),
    )
    render(<App />)

    await screen.findByDisplayValue('Alpha note')
    const alphaOption = screen.getByRole('option', { name: /alpha note/i })
    const betaOption = screen.getByRole('option', { name: /beta note/i })

    alphaOption.focus()
    await user.keyboard('{ArrowDown}')
    expect(betaOption).toHaveFocus()

    await user.keyboard('{Enter}')

    await waitFor(() => expect(tauriMock.openSessionNoteState).toHaveBeenLastCalledWith('session-2'))
    expect(await screen.findByDisplayValue('Beta note')).toBeInTheDocument()
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
      metadataJson: null,
    })
  })
})

function ensureTestLocalStorage() {
  if (typeof window.localStorage.clear === 'function') return

  const storage = new Map<string, string>()
  const localStorage = {
    get length() {
      return storage.size
    },
    clear() {
      storage.clear()
    },
    getItem(key: string) {
      return storage.get(key) ?? null
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null
    },
    removeItem(key: string) {
      storage.delete(key)
    },
    setItem(key: string, value: string) {
      storage.set(key, value)
    },
  } satisfies Storage

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: localStorage,
  })
}

function sessionNoteStateFixture(overrides: Partial<{ session: ReturnType<typeof sessionFixture>; noteEntry: ReturnType<typeof entryFixture>; testwareDraftCount: number; findingCount: number }> = {}) {
  return {
    session: sessionFixture(),
    noteEntry: entryFixture(),
    testwareDraftCount: 0,
    findingCount: 0,
    ...overrides,
  }
}
