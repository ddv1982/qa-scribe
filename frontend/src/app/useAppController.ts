import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSettings, listDrafts, listFindings, listRecentSessions, listSessions, type Draft, type Entry, type Finding, type GenerateAiActionKind, type GenerationJobStatus, type Session } from '../tauri'
import { emptyRichEditorDocument, richEditorDocumentToHtml, richEditorDocumentToPlainText, serializeRichEditorDocument } from '../editor/editorDocument'
import { managedAttachmentReferencesForClipboard } from '../editor/clipboardExport'
import { countWords, formatError } from '../ui/format'
import type { BusyAction, PendingAiActions, MainView } from '../ui/types'
import { useSettingsController } from '../hooks/useSettingsController'
import { deleteConfirmationCopy, type DeleteConfirmation } from '../workflows/deleteConfirmation'
import { createAttachmentActions } from './attachmentActions'
import { createCopyActions } from './copyActions'
import { createGenerationActions, generationIsActive } from './generationActions'
import { createRecordActions } from './recordActions'
import { createSessionActions } from './sessionActions'
import type { AppWorkflowContext, CopiedTarget, LatestNoteGenerationUndo } from './types'

const STARTUP_MARK_PREFIX = 'qa-scribe:startup:'
const STARTUP_SESSION_LIMIT = 50

function startupMark(name: string) {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  try {
    performance.mark(`${STARTUP_MARK_PREFIX}${name}`)
  } catch {
    // Startup marks are diagnostic only and must never affect app readiness.
  }
}

function startupMeasure(name: string, start: string, end: string) {
  if (typeof performance === 'undefined' || typeof performance.measure !== 'function') return
  try {
    performance.measure(`qa-scribe startup ${name}`, `${STARTUP_MARK_PREFIX}${start}`, `${STARTUP_MARK_PREFIX}${end}`)
  } catch {
    // A missing mark should not turn instrumentation into a boot failure.
  }
}

function markFirstPaintAfterBoot() {
  const mark = () => {
    startupMark('first-paint-after-boot')
    startupMeasure('boot-to-first-paint-after-boot', 'boot-start', 'first-paint-after-boot')
  }

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(mark)
  } else {
    window.setTimeout(mark, 0)
  }
}

export function useAppController() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [noteEntry, setNoteEntry] = useState<Entry | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [testwareDraftCount, setTestwareDraftCount] = useState(0)
  const [findingCount, setFindingCount] = useState(0)
  const [sessionLibraryComplete, setSessionLibraryComplete] = useState(false)
  const [noteTitle, setNoteTitle] = useState('')
  const [noteBody, setNoteBody] = useState(emptyRichEditorDocument)
  const [generationJobs, setGenerationJobs] = useState<Record<string, GenerationJobStatus>>({})
  const [busyAction, setBusyAction] = useState<BusyAction | null>('boot')
  const [copiedTarget, setCopiedTarget] = useState<CopiedTarget | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<MainView>('notes')
  const [pendingGenerationAction, setPendingGenerationAction] = useState<GenerateAiActionKind | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteConfirmation | null>(null)
  const [latestNoteGenerationUndo, setLatestNoteGenerationUndo] = useState<LatestNoteGenerationUndo | null>(null)

  const savedTitleRef = useRef('')
  const savedBodyRef = useRef(serializeRichEditorDocument(emptyRichEditorDocument))
  const noteBodyRef = useRef(emptyRichEditorDocument)
  const noteTitleWriteVersionRef = useRef(0)
  const noteBodyWriteVersionRef = useRef(0)
  const deletingSessionIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const noteEntryIdRef = useRef<string | null>(null)
  const draftsSessionIdRef = useRef<string | null>(null)
  const findingsSessionIdRef = useRef<string | null>(null)
  const draftsRef = useRef<Draft[]>([])
  const findingsRef = useRef<Finding[]>([])
  const dirtyDraftIdsRef = useRef<Set<string>>(new Set())
  const dirtyFindingIdsRef = useRef<Set<string>>(new Set())
  const recordLoadVersionRef = useRef(0)
  const copySuccessResetRef = useRef<number | null>(null)
  const bootedRef = useRef(false)
  const saveAllPendingChangesRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const hasPendingNoteChangesRef = useRef(false)
  const closingAfterSaveRef = useRef(false)
  const suppressAmbientNoteSaveRef = useRef(false)
  const forcedPendingSaveRef = useRef<Promise<boolean> | null>(null)
  const saveDirtyRecordsNowRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const {
    activeProvider,
    loadProviderStatus,
    loadSettings,
    providerStatus,
    refreshProviderStatus,
    selectedModel,
    selectedProvider,
    selectedReasoningEffort,
    setTheme,
    settingsDraft,
    settingsSaveState,
    theme,
    updateSettingsDraft,
    handleSaveSettings: saveSettingsDraft,
  } = useSettingsController({ setError, setNotice })

  // Memoized so its reference is stable across renders: `draftScreenshotCounts`
  // depends on it, and an inline `drafts.filter(...)` would produce a fresh array
  // every keystroke and re-run that DOMParser-backed memo needlessly.
  const testwareDrafts = useMemo(() => drafts.filter((draft) => draft.kind === 'testware'), [drafts])
  const noteBodyHtml = useMemo(() => richEditorDocumentToHtml(noteBody), [noteBody])
  const noteScreenshotCount = useMemo(
    () => managedAttachmentReferencesForClipboard({ title: noteTitle, bodyHtml: noteBodyHtml }).length,
    [noteBodyHtml, noteTitle],
  )
  const draftScreenshotCounts = useMemo(
    () =>
      Object.fromEntries(
        testwareDrafts.map((draft) => [
          draft.id,
          managedAttachmentReferencesForClipboard({ title: draft.title, bodyHtml: draft.body }).length,
        ]),
      ),
    [testwareDrafts],
  )
  const findingScreenshotCounts = useMemo(
    () =>
      Object.fromEntries(
        findings.map((finding) => [
          finding.id,
          managedAttachmentReferencesForClipboard({ title: finding.title, bodyHtml: finding.body }).length,
        ]),
      ),
    [findings],
  )
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    if (!query) return sessions
    return sessions.filter((session) => session.title.toLocaleLowerCase().includes(query))
  }, [sessions, searchQuery])
  // Memoized: `richEditorDocumentToPlainText` walks/serializes the document, so
  // recomputing it on every unrelated render (e.g. a sibling state change) was
  // wasted work on the keystroke path.
  const noteWordCount = useMemo(() => countWords(richEditorDocumentToPlainText(noteBody)), [noteBody])
  const noteIsReady = Boolean(activeSession && noteEntry)
  const isBusy = busyAction !== null
  const deleteCopy = deleteConfirmation ? deleteConfirmationCopy(deleteConfirmation) : null
  const activeSessionJobs = useMemo(
    () => Object.values(generationJobs).filter((job) => activeSession && job.sessionId === activeSession.id && generationIsActive(job)),
    [generationJobs, activeSession],
  )
  const pendingAiActions = useMemo<PendingAiActions>(() => {
    const pending: PendingAiActions = {}
    // `job.action` is the backend's `GenerationJobStatus.action: String`, which
    // is always a `GenerateAiActionKind` value.
    for (const job of activeSessionJobs) pending[job.action as GenerateAiActionKind] = true
    return pending
  }, [activeSessionJobs])
  const activeTestwareJob = activeSessionJobs.find((job) => job.action === 'testware') ?? null
  const activeFindingJob = activeSessionJobs.find((job) => job.action === 'finding') ?? null

  function invalidateRecordLoads() {
    recordLoadVersionRef.current += 1
  }

  function resetRecordHydration() {
    invalidateRecordLoads()
    draftsSessionIdRef.current = null
    findingsSessionIdRef.current = null
    draftsRef.current = []
    findingsRef.current = []
  }

  async function loadDraftsForSession(sessionId: string, options: { force?: boolean; replace?: boolean } = {}): Promise<Draft[]> {
    const { force = false, replace = false } = options
    if (!force && draftsSessionIdRef.current === sessionId) return draftsRef.current

    const loadVersion = recordLoadVersionRef.current
    const loaded = await listDrafts(sessionId)
    if (recordLoadVersionRef.current !== loadVersion || activeSessionIdRef.current !== sessionId) return draftsRef.current

    const nextDrafts = replace ? loaded : mergeRecordLists(loaded, draftsRef.current, sessionId)
    draftsSessionIdRef.current = sessionId
    draftsRef.current = nextDrafts
    setDrafts(nextDrafts)
    setTestwareDraftCount(nextDrafts.filter((draft) => draft.kind === 'testware').length)
    return nextDrafts
  }

  async function loadFindingsForSession(sessionId: string, options: { force?: boolean; replace?: boolean } = {}): Promise<Finding[]> {
    const { force = false, replace = false } = options
    if (!force && findingsSessionIdRef.current === sessionId) return findingsRef.current

    const loadVersion = recordLoadVersionRef.current
    const loaded = await listFindings(sessionId)
    if (recordLoadVersionRef.current !== loadVersion || activeSessionIdRef.current !== sessionId) return findingsRef.current

    const nextFindings = replace ? loaded : mergeRecordLists(loaded, findingsRef.current, sessionId)
    findingsSessionIdRef.current = sessionId
    findingsRef.current = nextFindings
    setFindings(nextFindings)
    setFindingCount(nextFindings.length)
    return nextFindings
  }

  const workflowContext: AppWorkflowContext = {
    activeSession,
    noteEntry,
    drafts,
    findings,
    testwareDraftCount,
    findingCount,
    sessions,
    testwareDrafts,
    noteTitle,
    noteBody,
    noteBodyHtml,
    selectedProvider,
    selectedModel,
    selectedReasoningEffort,
    latestNoteGenerationUndo,
    deleteConfirmation,
    savedTitleRef,
    savedBodyRef,
    noteBodyRef,
    noteTitleWriteVersionRef,
    noteBodyWriteVersionRef,
    deletingSessionIdRef,
    activeSessionIdRef,
    noteEntryIdRef,
    dirtyDraftIdsRef,
    dirtyFindingIdsRef,
    draftsRef,
    findingsRef,
    suppressAmbientNoteSaveRef,
    forcedPendingSaveRef,
    copySuccessResetRef,
    setSessions,
    setActiveSession,
    setNoteEntry,
    setDrafts,
    setFindings,
    setTestwareDraftCount,
    setFindingCount,
    setNoteTitle,
    setNoteBody,
    setGenerationJobs,
    setBusyAction,
    setCopiedTarget,
    setNotice,
    setError,
    setActiveView,
    setDeleteConfirmation,
    setLatestNoteGenerationUndo,
  }
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const attachmentActions = createAttachmentActions(workflowContext)
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const sessionActions = createSessionActions(workflowContext, attachmentActions.materializeInlineImages, invalidateRecordLoads, resetRecordHydration, () =>
    saveDirtyRecordsNowRef.current(),
  )
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const generationActions = createGenerationActions(workflowContext, sessionActions.saveNoteNow)
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const recordActions = createRecordActions(workflowContext, sessionActions.saveNoteNow, sessionActions.handleDeleteSession, {
    loadDraftsForSession,
    loadFindingsForSession,
  })
  // eslint-disable-next-line react-hooks/refs -- factories only close over refs; .current reads happen later in event handlers/effects.
  const copyActions = createCopyActions(workflowContext)

  useEffect(() => {
    saveDirtyRecordsNowRef.current = recordActions.saveDirtyRecordsNow
    saveAllPendingChangesRef.current = sessionActions.savePendingSessionEdits
  })

  function hasPendingChanges() {
    return hasPendingNoteChangesRef.current || dirtyDraftIdsRef.current.size > 0 || dirtyFindingIdsRef.current.size > 0
  }

  async function boot() {
    try {
      startupMark('boot-start')
      setBusyAction('boot')
      setError(null)
      const settingsRequest = getSettings().then((settings) => {
        startupMark('settings-loaded')
        startupMeasure('boot-to-settings-loaded', 'boot-start', 'settings-loaded')
        return settings
      })
      const sessionsRequest = listRecentSessions(STARTUP_SESSION_LIMIT).then((nextSessions) => {
        startupMark('sessions-loaded')
        startupMeasure('boot-to-sessions-loaded', 'boot-start', 'sessions-loaded')
        return nextSessions
      })
      const [nextSettings, nextSessions] = await Promise.all([settingsRequest, sessionsRequest])
      loadSettings(nextSettings)
      setSessions(nextSessions)
      setSessionLibraryComplete(nextSessions.length < STARTUP_SESSION_LIMIT)
      bootedRef.current = true
      if (nextSessions[0]) {
        await sessionActions.openSession(nextSessions[0], false)
        startupMark('first-session-opened')
        startupMeasure('boot-to-first-session-opened', 'boot-start', 'first-session-opened')
      } else {
        setNotice('Create a note to start')
        startupMark('empty-session-library-ready')
        startupMeasure('boot-to-empty-session-library-ready', 'boot-start', 'empty-session-library-ready')
      }
      // Recover any generation jobs the backend is still running from before a
      // webview reload; the busy/pending UI was lost with the previous webview.
      void generationActions.reconcileActiveJobs()
      window.setTimeout(() => {
        void loadProviderStatusAfterBoot()
      }, 0)
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
      startupMark('boot-busy-cleared')
      startupMeasure('boot-to-busy-cleared', 'boot-start', 'boot-busy-cleared')
      markFirstPaintAfterBoot()
    }
  }

  async function loadProviderStatusAfterBoot() {
    try {
      await loadProviderStatus()
      startupMark('provider-fast-status-complete')
      startupMeasure('boot-to-provider-fast-status', 'boot-start', 'provider-fast-status-complete')
    } catch (cause) {
      setError(formatError(cause))
    }
  }

  async function handleLoadSessionLibrary() {
    try {
      setBusyAction('load-session-library')
      setError(null)
      const nextSessions = await listSessions()
      setSessions(nextSessions)
      setSessionLibraryComplete(true)
      setNotice('Session Library loaded')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleRefreshProviderStatus() {
    try {
      setBusyAction('refresh-providers')
      setError(null)
      await refreshProviderStatus()
      startupMark('provider-deep-refresh-complete')
      startupMeasure('boot-to-provider-deep-refresh', 'boot-start', 'provider-deep-refresh-complete')
      setNotice('Provider status refreshed')
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusyAction(null)
    }
  }

  async function handleSaveSettings() {
    try {
      setBusyAction('save-settings')
      await saveSettingsDraft()
    } finally {
      setBusyAction(null)
    }
  }

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id ?? null
    noteEntryIdRef.current = noteEntry?.id ?? null
  }, [activeSession?.id, noteEntry?.id])

  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])

  useEffect(() => {
    findingsRef.current = findings
  }, [findings])

  useEffect(() => {
    noteBodyRef.current = noteBody
  }, [noteBody])

  useEffect(() => {
    if (!activeSession || activeView !== 'testware') return
    void loadDraftsForSession(activeSession.id).catch((cause) => setError(formatError(cause)))
  }, [activeSession?.id, activeView]) // eslint-disable-line react-hooks/exhaustive-deps -- lazy loader is keyed by active Session and view only.

  useEffect(() => {
    if (!activeSession || activeView !== 'findings') return
    void loadFindingsForSession(activeSession.id).catch((cause) => setError(formatError(cause)))
  }, [activeSession?.id, activeView]) // eslint-disable-line react-hooks/exhaustive-deps -- lazy loader is keyed by active Session and view only.

  useEffect(() => {
    const titleDirty = Boolean(activeSession && noteTitle.trim() && noteTitle.trim() !== savedTitleRef.current)
    const bodyDirty = Boolean(noteEntry && serializeRichEditorDocument(noteBody) !== savedBodyRef.current)
    hasPendingNoteChangesRef.current = titleDirty || bodyDirty
  }, [activeSession, noteEntry, noteTitle, noteBody])

  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup must clear the latest copy-success timeout.
      const resetTimeout = copySuccessResetRef.current
      if (resetTimeout) window.clearTimeout(resetTimeout)
    }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void boot()
    }, 0)
    return () => window.clearTimeout(timeout)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- desktop boot is intentionally one-shot

  useEffect(() => {
    if (!activeSession || !bootedRef.current) return
    const trimmedTitle = noteTitle.trim()
    if (!trimmedTitle || trimmedTitle === savedTitleRef.current) return

    const timeout = window.setTimeout(() => {
      if (suppressAmbientNoteSaveRef.current) return
      void sessionActions.saveTitle(trimmedTitle)
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [activeSession, noteTitle]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity and title

  useEffect(() => {
    if (!noteEntry || !bootedRef.current) return
    const nextBody = serializeRichEditorDocument(noteBody)
    if (nextBody === savedBodyRef.current) return

    const timeout = window.setTimeout(() => {
      if (suppressAmbientNoteSaveRef.current) return
      void sessionActions.saveNoteNow()
    }, 850)
    return () => window.clearTimeout(timeout)
  }, [noteEntry, noteBody]) // eslint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity and body

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasPendingChanges()) return
      event.preventDefault()
      event.returnValue = ''
      void saveAllPendingChangesRef.current()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  useEffect(() => {
    let disposed = false
    let removeListener: (() => void) | null = null

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closingAfterSaveRef.current || !hasPendingChanges()) return
        event.preventDefault()
        const saved = await saveAllPendingChangesRef.current()
        if (!saved) return
        closingAfterSaveRef.current = true
        await getCurrentWindow().close()
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
        } else {
          removeListener = unlisten
        }
      })
      .catch(() => {
        // The beforeunload fallback still protects browser/dev-preview usage.
      })

    return () => {
      disposed = true
      removeListener?.()
    }
  }, [])

  return {
    ...attachmentActions,
    ...copyActions,
    ...generationActions,
    ...recordActions,
    ...sessionActions,
    activeFindingJob,
    activeProvider,
    activeTestwareJob,
    activeSession,
    activeView,
    busyAction,
    copiedTarget,
    deleteConfirmation,
    deleteCopy,
    draftScreenshotCounts,
    error,
    filteredSessions,
    findingCount,
    findingScreenshotCounts,
    findings,
    isBusy,
    latestNoteGenerationUndo,
    noteBody,
    noteEntry,
    noteIsReady,
    noteScreenshotCount,
    noteTitle,
    noteWordCount,
    notice,
    pendingAiActions,
    pendingGenerationAction,
    providerStatus,
    searchQuery,
    selectedModel,
    selectedProvider,
    sessionLibraryComplete,
    sessions,
    settingsDraft,
    settingsSaveState,
    setActiveView,
    setDeleteConfirmation,
    setError,
    setLatestNoteGenerationUndo,
    setNoteBody,
    setNoteTitle,
    setPendingGenerationAction,
    setSearchQuery,
    setTheme,
    testwareDrafts,
    testwareDraftCount,
    theme,
    updateSettingsDraft,
    uploadEditorImage: attachmentActions.uploadEditorImage,
    handleLoadSessionLibrary,
    handleRefreshProviderStatus,
    handleSaveSettings,
  }
}

export type AppController = ReturnType<typeof useAppController>

function mergeRecordLists<T extends { id: string; sessionId: string }>(loaded: T[], previous: T[], sessionId: string): T[] {
  const loadedIds = new Set(loaded.map((record) => record.id))
  const localOnly = previous.filter((record) => record.sessionId === sessionId && !loadedIds.has(record.id))
  return [...localOnly, ...loaded]
}
