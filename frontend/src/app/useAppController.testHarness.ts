import { act, cleanup } from '@testing-library/react'
import { vi } from 'vitest'
import { draftFixture, entryFixture, findingFixture, providerStatusFixture, sessionFixture, settingsFixture } from '../test/fixtures'
import { chatFixture } from './useSessionChat.testSupport'
import type { ChatComposerRequest, ChatState, ChatRef } from '../bindings'

const tauriMock = vi.hoisted(() => ({
  cancelAiActionJob: vi.fn(), getAiActionJobStatus: vi.fn(), listActiveAiActionJobs: vi.fn(),
  copyHtmlToClipboard: vi.fn(), copyAttachmentImageToClipboard: vi.fn(),
  readNoteSource: vi.fn(), readClipboardImageDataUrl: vi.fn(),
  prepareCreationSave: vi.fn(), commitCreationSave: vi.fn(), abortCreationSave: vi.fn(), copyLocalImageToClipboard: vi.fn(),
  createDraft: vi.fn(), createEntry: vi.fn(), createFinding: vi.fn(), createSession: vi.fn(),
  deleteAttachment: vi.fn(), deleteDraft: vi.fn(), deleteFinding: vi.fn(), deleteSession: vi.fn(), getProviderStatus: vi.fn(),
  getAttachmentPreviewDataUrl: vi.fn(async (): Promise<string | null> => null), getSettings: vi.fn(), importClipboardScreenshot: vi.fn(), listDraftLibrary: vi.fn(), listDrafts: vi.fn(), listEntries: vi.fn(),
  listFindingLibrary: vi.fn(), listFindings: vi.fn(), listRecentSessions: vi.fn(), listSessions: vi.fn(), openSessionNoteState: vi.fn(),
  reopenSession: vi.fn(), refreshProviderStatus: vi.fn(), retryAttachmentCleanup: vi.fn(), startAiActionJob: vi.fn(), updateDraft: vi.fn(),
  updateEntry: vi.fn(), updateFinding: vi.fn(), updateSession: vi.fn(), updateSettings: vi.fn(),
  beginRecordChat: vi.fn(), getConversation: vi.fn<(reference: ChatRef) => Promise<ChatState>>(), activateConversation: vi.fn(), listChatHistory: vi.fn(),
  resolveRefinement: vi.fn(), getChat: vi.fn<(sessionId: string) => Promise<ChatState>>(), saveChatComposer: vi.fn(), startChatJob: vi.fn(), submitChat: vi.fn(), restartChat: vi.fn(),
  importChatImage: vi.fn(), readChatClipboardImageDataUrl: vi.fn(),
  EDITOR_HTML_TAGS: ['a', 'b', 'br', 'em', 'h2', 'h3', 'i', 'img', 'input', 'li', 'ol', 'p', 'strong', 'ul'],
  SELF_CLOSING_EDITOR_HTML_TAGS: ['br', 'img', 'input'],
  MANAGED_ATTACHMENT_PROTOCOL: 'qa-scribe-attachment://',
}))

const tauriWindowMock = vi.hoisted(() => {
  let closeRequestedHandler: ((event: { preventDefault: () => void }) => void | Promise<void>) | null = null
  const currentWindow = {
    onCloseRequested: vi.fn(async (handler: (event: { preventDefault: () => void }) => void | Promise<void>) => {
      closeRequestedHandler = handler
      return vi.fn()
    }),
    close: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  }
  return {
    currentWindow,
    closeRequestedHandler: () => closeRequestedHandler,
    reset: () => {
      closeRequestedHandler = null
      currentWindow.onCloseRequested.mockClear()
      currentWindow.close.mockClear()
      currentWindow.destroy.mockClear()
    },
  }
})

vi.mock('../tauri', () => tauriMock)
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => tauriWindowMock.currentWindow }))

// Load the controller only after this harness has installed its Tauri mocks.
// A static re-export would evaluate the controller dependency before the mock
// registrations in this module take effect.
export const { useAppController } = await import('./useAppController')

export function getTauriMock() {
  return tauriMock
}

export function getTauriWindowMock() {
  return tauriWindowMock
}

export function setupControllerTest() {
  vi.clearAllMocks()
  tauriWindowMock.reset()
  ensureTestLocalStorage()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })

  tauriMock.readClipboardImageDataUrl.mockReset().mockResolvedValue(null)
  tauriMock.readChatClipboardImageDataUrl.mockReset().mockResolvedValue(null)
  tauriMock.importChatImage.mockReset()
  tauriMock.readNoteSource.mockReset().mockResolvedValue({ entry: entryFixture(), revision: 0 })
  tauriMock.prepareCreationSave.mockReset().mockImplementation(async (request: { attemptId: string }) => ({ attemptId: request.attemptId, images: [], outcome: { state: 'preparing' } }))
  tauriMock.commitCreationSave.mockReset()
  tauriMock.abortCreationSave.mockReset().mockResolvedValue({ state: 'aborted' })
  tauriMock.startAiActionJob.mockReset()
  tauriMock.copyHtmlToClipboard.mockResolvedValue(undefined)
  tauriMock.getSettings.mockResolvedValue(settingsFixture())
  tauriMock.deleteSession.mockResolvedValue({ pendingFiles: 0 })
  tauriMock.retryAttachmentCleanup.mockResolvedValue({ pendingFiles: 0 })
  tauriMock.importClipboardScreenshot.mockResolvedValue({ id: 'attachment-1', filename: 'inline-image.png' })
  tauriMock.deleteAttachment.mockResolvedValue(true)
  tauriMock.getProviderStatus.mockResolvedValue(providerStatusFixture())
  tauriMock.refreshProviderStatus.mockResolvedValue(providerStatusFixture())
  tauriMock.listRecentSessions.mockResolvedValue([sessionFixture()])
  tauriMock.listSessions.mockResolvedValue([sessionFixture()])
  tauriMock.listActiveAiActionJobs.mockResolvedValue([])
  tauriMock.getChat.mockReset().mockImplementation(async (sessionId: string) => chatFixture({ sessionId, draftId: `chat-${sessionId}` }))
  const rows = new Map<string, import('../bindings').ChatState>()
  tauriMock.getConversation.mockReset().mockImplementation(async (reference: import('../bindings').ChatRef) => {
    const row = rows.get(reference.draftId)
    if (row) {
      if (row.sessionId !== reference.sessionId) throw new Error('Wrong exact draft Session')
      return row
    }
    const notes = await tauriMock.getChat(reference.sessionId)
    if (notes.draftId !== reference.draftId || notes.sessionId !== reference.sessionId) throw new Error('Exact draft not found')
    return notes
  })
  tauriMock.beginRecordChat.mockReset().mockImplementation(async (request: import('../bindings').BeginRecordChatRequest) => {
    const row = rows.get(request.draftId) ?? chatFixture({ sessionId: request.sessionId, draftId: request.draftId, mode: 'chat', owner: { kind: 'record', sessionId: request.sessionId, record: request.record } })
    rows.set(row.draftId, row); return row
  })
  tauriMock.activateConversation.mockReset().mockImplementation(async (reference: import('../bindings').ChatRef) => tauriMock.getConversation(reference))
  tauriMock.listChatHistory.mockReset().mockResolvedValue([])
  tauriMock.saveChatComposer.mockReset().mockImplementation(async (request: ChatComposerRequest) => {
    const previous = rows.get(request.scope.draftId)
    const saved = chatFixture({ ...previous,
      sessionId: request.scope.sessionId, draftId: request.scope.draftId,
      revision: request.scope.expectedRevision + 1, composer: request.composer, composerIntent: request.intent ?? { kind: 'message' }, mode: request.mode,
      composerImages: (request.attachmentIds ?? []).map(id => previous?.composerImages.find(image => image.attachmentId === id) ?? { attachmentId: id, filename: id, mimeType: 'image/png', sizeBytes: 1 }),
    })
    if (previous) rows.set(saved.draftId, saved)
    return saved
  })
  tauriMock.resolveRefinement.mockReset()
  tauriMock.startChatJob.mockReset()
  tauriMock.submitChat.mockReset()
  tauriMock.restartChat.mockReset()
  tauriMock.openSessionNoteState.mockResolvedValue(sessionNoteStateFixture())
  tauriMock.reopenSession.mockResolvedValue(sessionFixture())
  tauriMock.listEntries.mockResolvedValue([entryFixture()])
  tauriMock.listDrafts.mockResolvedValue([])
  tauriMock.listDraftLibrary.mockResolvedValue([])
  tauriMock.listFindings.mockResolvedValue([])
  tauriMock.listFindingLibrary.mockResolvedValue([])
  tauriMock.createEntry.mockResolvedValue(entryFixture())
  tauriMock.createSession.mockResolvedValue(sessionFixture({ id: 'session-2', title: 'Untitled session 2' }))
  tauriMock.updateSession.mockImplementation(async (_id: string, patch: { title?: string | null }) => sessionFixture({ title: patch.title ?? 'Checkout session' }))
  tauriMock.updateEntry.mockImplementation(async (_id: string, patch: { body?: string | null; bodyJson?: string | null; bodyFormat?: string | null }) => entryFixture({ body: patch.body ?? '<p>Checkout fails after payment.</p>', bodyJson: patch.bodyJson ?? null, bodyFormat: patch.bodyFormat ?? 'html' }))
  tauriMock.updateDraft.mockReset().mockImplementation(async (_id: string, patch: { body?: string | null; bodyJson?: string | null; bodyFormat?: string | null }) => draftFixture({ body: patch.body ?? '<ol><li>Submit payment.</li></ol>', bodyJson: patch.bodyJson ?? null, bodyFormat: patch.bodyFormat ?? 'html' }))
  tauriMock.updateFinding.mockReset().mockImplementation(async (_id: string, patch: { body?: string | null; bodyJson?: string | null; bodyFormat?: string | null }) => findingFixture({ body: patch.body ?? '<p>Payment submission returns a server error.</p>', bodyJson: patch.bodyJson ?? null, bodyFormat: patch.bodyFormat ?? 'html' }))
}

export async function renderWithControllerStartup<T>(renderSubject: () => T): Promise<T> {
  vi.useFakeTimers()
  try {
    const subject = renderSubject()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    return subject
  } finally {
    vi.useRealTimers()
  }
}

export function cleanupControllerTest() {
  cleanup()
  vi.useRealTimers()
}

export function sessionNoteStateFixture(overrides: Partial<{ session: ReturnType<typeof sessionFixture>; noteEntry: ReturnType<typeof entryFixture>; testwareDraftCount: number; findingCount: number }> = {}) {
  return { session: sessionFixture(), noteEntry: entryFixture(), testwareDraftCount: 0, findingCount: 0, ...overrides }
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

function ensureTestLocalStorage() {
  if (typeof window.localStorage.clear === 'function') return
  const storage = new Map<string, string>()
  const localStorage = {
    get length() { return storage.size },
    clear() { storage.clear() },
    getItem(key: string) { return storage.get(key) ?? null },
    key(index: number) { return Array.from(storage.keys())[index] ?? null },
    removeItem(key: string) { storage.delete(key) },
    setItem(key: string, value: string) { storage.set(key, value) },
  } satisfies Storage
  Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorage })
}
