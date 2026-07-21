import { cleanup } from '@testing-library/react'
import { vi } from 'vitest'
import { draftFixture, entryFixture, findingFixture, providerStatusFixture, sessionFixture, settingsFixture } from '../test/fixtures'

const tauriMock = vi.hoisted(() => ({
  cancelAiActionJob: vi.fn(), getAiActionJobStatus: vi.fn(), listActiveAiActionJobs: vi.fn(),
  createDraft: vi.fn(), createEntry: vi.fn(), createFinding: vi.fn(), createSession: vi.fn(),
  deleteAttachment: vi.fn(), deleteDraft: vi.fn(), deleteFinding: vi.fn(), deleteSession: vi.fn(), getProviderStatus: vi.fn(),
  getSettings: vi.fn(), importClipboardScreenshot: vi.fn(), listDraftLibrary: vi.fn(), listDrafts: vi.fn(), listEntries: vi.fn(),
  listFindingLibrary: vi.fn(), listFindings: vi.fn(), listRecentSessions: vi.fn(), listSessions: vi.fn(), openSessionNoteState: vi.fn(),
  reopenSession: vi.fn(), refreshProviderStatus: vi.fn(), startAiActionJob: vi.fn(), updateDraft: vi.fn(),
  updateEntry: vi.fn(), updateFinding: vi.fn(), updateSession: vi.fn(), updateSettings: vi.fn(),
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

  tauriMock.getSettings.mockResolvedValue(settingsFixture())
  tauriMock.importClipboardScreenshot.mockResolvedValue({ id: 'attachment-1', filename: 'inline-image.png' })
  tauriMock.deleteAttachment.mockResolvedValue(true)
  tauriMock.getProviderStatus.mockResolvedValue(providerStatusFixture())
  tauriMock.refreshProviderStatus.mockResolvedValue(providerStatusFixture())
  tauriMock.listRecentSessions.mockResolvedValue([sessionFixture()])
  tauriMock.listSessions.mockResolvedValue([sessionFixture()])
  tauriMock.listActiveAiActionJobs.mockResolvedValue([])
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
  tauriMock.updateDraft.mockImplementation(async (_id: string, patch: { body?: string | null; bodyJson?: string | null; bodyFormat?: string | null }) => draftFixture({ body: patch.body ?? '<ol><li>Submit payment.</li></ol>', bodyJson: patch.bodyJson ?? null, bodyFormat: patch.bodyFormat ?? 'html' }))
  tauriMock.updateFinding.mockImplementation(async (_id: string, patch: { body?: string | null; bodyJson?: string | null; bodyFormat?: string | null }) => findingFixture({ body: patch.body ?? '<p>Payment submission returns a server error.</p>', bodyJson: patch.bodyJson ?? null, bodyFormat: patch.bodyFormat ?? 'html' }))
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
