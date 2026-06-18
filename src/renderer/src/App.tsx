import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { FileJson, FileText, Loader2, MoreHorizontal, PanelRightOpen, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { defaultReasoningEffortFor, reasoningEffortsFor, validateSessionRequirements } from '../../shared/contracts'
import type {
  Attachment,
  AppSettings,
  AppSettingsPatch,
  Entry,
  EntryType,
  AiProviderId,
  GenerationContextReview,
  ProviderStatus,
  ReasoningEffort,
  Session,
  SessionDraft,
  SessionRequirementKey,
  SessionSnapshot
} from '../../shared/contracts'
import {
  CapturePane,
  DraftsPane,
  EntryInspector,
  GenerationReviewPane,
  ModeTabs,
  SettingsPane,
  StatusPill
} from './components/AppSections'
import type { EntryInspectorSavePatch } from './components/inspector/Inspectors'
import { SessionSetupPanel, type SessionAutosaveStatus } from './components/SessionSetupPanel'
import { SessionSidebar } from './components/SessionSidebar'
import { AttachmentImportDialog, type AttachmentImportSource } from './components/evidence/AttachmentImportDialog'
import { buildGenerationOptions, normalizeContextRows } from './domain/generation'
import {
  createLocalReviewDraft,
  draftFromGenerationResult,
  normalizeDraft,
  normalizeFinding
} from './domain/reviewDrafts'
import {
  createEmptyStructuredFindingDraft,
  createStructuredFindingDetails,
  renderStructuredFindingBody,
  serializeStructuredFindingDetails
} from './domain/findingDetails'
import { formatEntryType } from './domain/formatters'
import { emptyDraft, hasSessionOptionalDetails } from './domain/session'
import type {
  CaptureMode,
  ContextAttachment,
  ContextRow,
  Finding,
  ReviewDraft,
  StructuredFindingDraft,
  WorkspaceMode
} from './domain/types'

type AutosaveStatus = SessionAutosaveStatus
type AttachmentImportTarget = { kind: 'entry'; entryId?: string } | { kind: 'draft-note' } | { kind: 'draft-finding'; field: 'actual' | 'expected' }
type AttachmentImportResult = Attachment | null | undefined
type OpenSessionOptions = {
  mode?: WorkspaceMode
  openSetup?: boolean
  preserveGenerationContext?: boolean
}

export function App(): ReactElement {
  const [sessions, setSessions] = useState<Session[]>([])
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>(emptyDraft)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('note')
  const [entryTitle, setEntryTitle] = useState('')
  const [entryBody, setEntryBody] = useState('')
  const [entryMetadataJson, setEntryMetadataJson] = useState<string | null>(null)
  const [richTextResetKey, setRichTextResetKey] = useState(0)
  const [findingDraft, setFindingDraft] = useState<StructuredFindingDraft>(createEmptyStructuredFindingDraft)
  const [filter, setFilter] = useState<EntryType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [entrySaveBusy, setEntrySaveBusy] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('capture')
  const [sessionRequirementErrors, setSessionRequirementErrors] = useState<SessionRequirementKey[]>([])
  const [sessionDraftDirty, setSessionDraftDirty] = useState(false)
  const [sessionAutosaveStatus, setSessionAutosaveStatus] = useState<AutosaveStatus>('idle')
  const [sessionSetupOpen, setSessionSetupOpen] = useState(false)
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false)
  const [generationContext, setGenerationContext] = useState<GenerationContextReview | null>(null)
  const [generationContextId, setGenerationContextId] = useState<string | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [draft, setDraft] = useState<ReviewDraft | null>(null)
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftAutosaveStatus, setDraftAutosaveStatus] = useState<AutosaveStatus>('idle')
  const [draftPlaceholderSuppressed, setDraftPlaceholderSuppressed] = useState(false)
  const [draftEvidenceAttachments, setDraftEvidenceAttachments] = useState<Attachment[]>([])
  const [findingDraftAttachments, setFindingDraftAttachments] = useState<Attachment[]>([])
  const [deletingDraft, setDeletingDraft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [attachmentImportTarget, setAttachmentImportTarget] = useState<AttachmentImportTarget | null>(null)
  const [attachmentImportBusy, setAttachmentImportBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const creatingSessionRef = useRef(false)
  const sessionSaveVersionRef = useRef(0)
  const draftSaveVersionRef = useRef(0)

  useEffect(() => {
    void bootstrap()
    return () => {
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    }
  }, [])

  const selectedEntry = snapshot?.entries.find((entry) => entry.id === selectedEntryId) ?? null
  const hasOptionalDetails = hasSessionOptionalDetails(sessionDraft)
  const sessionRequirementState = useMemo(() => validateSessionRequirements(sessionDraft), [sessionDraft])
  const sessionSetupNeedsAttention = !sessionRequirementState.valid || sessionRequirementErrors.length > 0
  const availableProviders = useMemo(() => providerStatus?.providers.filter((provider) => provider.available) ?? [], [providerStatus])
  const selectedProviderStatus = useMemo(
    () => availableProviders.find((provider) => provider.provider === selectedProvider) ?? null,
    [availableProviders, selectedProvider]
  )
  const selectedReasoningEfforts = useMemo(
    () => (selectedProviderStatus ? reasoningEffortsFor(selectedProviderStatus, selectedModel) : []),
    [selectedModel, selectedProviderStatus]
  )
  const selectedDefaultReasoningEffort = useMemo(
    () => (selectedProviderStatus ? defaultReasoningEffortFor(selectedProviderStatus, selectedModel) : null),
    [selectedModel, selectedProviderStatus]
  )

  useEffect(() => {
    if (!providerStatus) return
    const lastProvider = window.localStorage.getItem('qa-scribe:last-provider')
    const nextProvider =
      availableProviders.find((provider) => provider.provider === lastProvider)?.provider ??
      availableProviders.find((provider) => provider.provider === providerStatus.selectedProvider)?.provider ??
      availableProviders[0]?.provider ??
      null
    setSelectedProvider((current) =>
      current && availableProviders.some((provider) => provider.provider === current) ? current : nextProvider
    )
  }, [availableProviders, providerStatus])

  useEffect(() => {
    if (!selectedProviderStatus) {
      setSelectedModel('')
      setSelectedReasoningEffort(null)
      return
    }

    const lastProvider = window.localStorage.getItem('qa-scribe:last-provider')
    const lastModel = window.localStorage.getItem('qa-scribe:last-model')
    const preferredModel =
      lastProvider === selectedProviderStatus.provider && lastModel
        ? lastModel
        : providerStatus?.selectedProvider === selectedProviderStatus.provider
          ? providerStatus.selectedModel
          : null
    const nextModel = preferredModel ?? selectedProviderStatus.defaultModel ?? selectedProviderStatus.models[0] ?? ''
    setSelectedModel(nextModel)

    const reasoningEfforts = reasoningEffortsFor(selectedProviderStatus, nextModel)
    if (reasoningEfforts.length === 0) {
      setSelectedReasoningEffort(null)
      return
    }
    const lastReasoningEffort = window.localStorage.getItem('qa-scribe:last-reasoning-effort') as ReasoningEffort | null
    const preferredReasoningEffort =
      lastProvider === selectedProviderStatus.provider && lastReasoningEffort
        ? lastReasoningEffort
        : providerStatus?.selectedProvider === selectedProviderStatus.provider
          ? providerStatus.selectedReasoningEffort
          : null
    const nextReasoningEffort =
      preferredReasoningEffort && reasoningEfforts.includes(preferredReasoningEffort)
        ? preferredReasoningEffort
        : defaultReasoningEffortFor(selectedProviderStatus, nextModel) ?? reasoningEfforts[0] ?? null
    setSelectedReasoningEffort(nextReasoningEffort)
  }, [providerStatus, selectedProviderStatus])

  useEffect(() => {
    if (!selectedProviderStatus) return
    if (selectedReasoningEfforts.length === 0) {
      setSelectedReasoningEffort(null)
      return
    }
    if (selectedReasoningEffort === null) return
    if (selectedReasoningEffort && selectedReasoningEfforts.includes(selectedReasoningEffort)) return
    setSelectedReasoningEffort(selectedDefaultReasoningEffort ?? selectedReasoningEfforts[0] ?? null)
  }, [selectedDefaultReasoningEffort, selectedProviderStatus, selectedReasoningEffort, selectedReasoningEfforts])

  useEffect(() => {
    if (!selectedProvider) return
    window.localStorage.setItem('qa-scribe:last-provider', selectedProvider)
  }, [selectedProvider])

  useEffect(() => {
    if (selectedModel.trim().length === 0) return
    window.localStorage.setItem('qa-scribe:last-model', selectedModel.trim())
  }, [selectedModel])

  useEffect(() => {
    if (selectedReasoningEffort) {
      window.localStorage.setItem('qa-scribe:last-reasoning-effort', selectedReasoningEffort)
    } else {
      window.localStorage.removeItem('qa-scribe:last-reasoning-effort')
    }
  }, [selectedReasoningEffort])

  useEffect(() => {
    if (hasOptionalDetails) setMoreDetailsOpen(true)
  }, [hasOptionalDetails])

  useEffect(() => {
    if (snapshot && sessionSetupNeedsAttention) setSessionSetupOpen(true)
  }, [sessionSetupNeedsAttention, snapshot])

  useEffect(() => {
    if (!snapshot || !sessionDraftDirty) return
    if (!sessionDraft.title?.trim()) {
      setSessionAutosaveStatus('idle')
      return
    }

    const version = sessionSaveVersionRef.current
    const timer = window.setTimeout(() => {
      void persistSessionDraft(false, version)
    }, 600)

    return () => window.clearTimeout(timer)
  }, [sessionDraft, sessionDraftDirty, snapshot?.session.id])

  useEffect(() => {
    if (!draft || !draftDirty) return

    const version = draftSaveVersionRef.current
    const timer = window.setTimeout(() => {
      if (version !== draftSaveVersionRef.current) return
      void persistDraft(draft, false, version).catch((error) => {
        if (version !== draftSaveVersionRef.current) return
        setDraftAutosaveStatus('error')
        flashError(error, 'Draft could not be autosaved')
      })
    }, 600)

    return () => window.clearTimeout(timer)
  }, [draft, draftDirty])

  useEffect(() => {
    const draftId = draft?.id
    if (!draftId || draftId.startsWith('local-draft-')) {
      setDraftEvidenceAttachments([])
      return
    }

    let cancelled = false
    void window.qaScribe
      .getDraftEvidenceAttachments(draftId)
      .then((attachments) => {
        if (!cancelled) setDraftEvidenceAttachments(attachments)
      })
      .catch(() => {
        if (!cancelled) setDraftEvidenceAttachments([])
      })

    return () => {
      cancelled = true
    }
  }, [draft?.id])

  const contextRows = useMemo(() => {
    if (!snapshot) return []
    return normalizeContextRows(generationContext, snapshot)
  }, [generationContext, snapshot])

  const sessionLevelAttachments = useMemo(() => {
    if (!snapshot) return []
    return (
      generationContext?.attachments ??
      snapshot.attachments
        .filter((attachment) => attachment.entryId === null)
        .map((attachment) => ({ attachment, included: true }))
    )
  }, [generationContext, snapshot])

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return (snapshot?.entries ?? []).filter((entry) => {
      const attachmentNames =
        snapshot?.attachments
          .filter((attachment) => attachment.entryId === entry.id)
          .map((attachment) => attachment.filename.toLowerCase()) ?? []
      const matchesType = filter === 'all' || entry.type === filter
      const matchesQuery =
        normalizedQuery.length === 0 ||
        entry.title?.toLowerCase().includes(normalizedQuery) ||
        entry.body.toLowerCase().includes(normalizedQuery) ||
        attachmentNames.some((filename) => filename.includes(normalizedQuery))
      return matchesType && matchesQuery
    })
  }, [filter, query, snapshot])

  async function bootstrap(): Promise<void> {
    setBusy(true)
    try {
      const [sessionList, aiStatus, appSettings] = await Promise.all([
        window.qaScribe.listSessions(),
        window.qaScribe.getProviderStatus(),
        window.qaScribe.getSettings()
      ])
      setSessions(sessionList)
      setProviderStatus(aiStatus)
      setSettings(appSettings)
      setSettingsDraft(appSettings)

      const lastActive = window.localStorage.getItem('qa-scribe:last-session')
      const preferred = sessionList.find((session) => session.id === lastActive) ?? sessionList[0]
      if (preferred) await openSession(preferred.id)
    } finally {
      setBusy(false)
    }
  }

  async function refreshSessions(): Promise<void> {
    setSessions(await window.qaScribe.listSessions())
  }

  function updateSettingsDraft(patch: AppSettingsPatch): void {
    setSettingsDraft((current) => {
      if (!current) return current
      return {
        ...current,
        providers: {
          ...current.providers,
          ...patch.providers
        },
        generation: {
          ...current.generation,
          ...patch.generation
        },
        templates: {
          note: patch.templates?.note ?? current.templates.note,
          finding: patch.templates?.finding ?? current.templates.finding
        }
      }
    })
    setSettingsError(null)
  }

  function resetSettingsDraft(): void {
    setSettingsDraft(settings)
    setSettingsError(null)
  }

  async function saveSettings(): Promise<boolean> {
    if (!settingsDraft) return false
    setSettingsSaving(true)
    setSettingsError(null)
    try {
      const saved = await window.qaScribe.updateSettings(settingsDraft)
      setSettings(saved)
      setSettingsDraft(saved)
      setProviderStatus(await window.qaScribe.getProviderStatus())
      flash('Settings saved')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Settings could not be saved'
      setSettingsError(message)
      flash(message)
      return false
    } finally {
      setSettingsSaving(false)
    }
  }

  async function openSettings(): Promise<void> {
    if (workspaceMode === 'settings') {
      await closeSettings()
      return
    }
    if (!(await flushPendingAutosaves())) return
    if (!settingsDraft) {
      const loaded = await window.qaScribe.getSettings()
      setSettings(loaded)
      setSettingsDraft(loaded)
    }
    setSelectedEntryId(null)
    setWorkspaceMode('settings')
  }

  async function closeSettings(): Promise<void> {
    if (!(await flushPendingAutosaves())) return
    setWorkspaceMode('capture')
  }

  async function openSession(id: string, options: OpenSessionOptions = {}): Promise<void> {
    if (!(await flushPendingAutosaves())) return
    sessionSaveVersionRef.current += 1
    draftSaveVersionRef.current += 1
    const next = await window.qaScribe.getSession(id)
    if (!next) return
    const nextDraft = {
      title: next.session.title,
      testTarget: next.session.testTarget ?? '',
      charter: next.session.charter ?? '',
      environment: next.session.environment ?? '',
      buildVersion: next.session.buildVersion ?? '',
      relatedReference: next.session.relatedReference ?? ''
    }
    setSnapshot(next)
    setSessionDraft(nextDraft)
    setSessionDraftDirty(false)
    setSessionAutosaveStatus('idle')
    setSessionRequirementErrors([])
    setMoreDetailsOpen(hasSessionOptionalDetails(nextDraft))
    setSessionSetupOpen(options.openSetup ?? !validateSessionRequirements(nextDraft).valid)
    setSelectedEntryId(null)
    if (!options.preserveGenerationContext) {
      setGenerationContext(null)
      setGenerationContextId(null)
    }
    setDraftPlaceholderSuppressed(false)
    setDraftEvidenceAttachments([])
    resetCaptureDrafts()
    await loadReviewState(next)
    setDraftDirty(false)
    setDraftAutosaveStatus('idle')
    setWorkspaceMode(options.mode ?? 'capture')
    window.localStorage.setItem('qa-scribe:last-session', id)
    await refreshSessions()
  }

  async function flushPendingAutosaves(): Promise<boolean> {
    if (settings && settingsDraft && JSON.stringify(settings) !== JSON.stringify(settingsDraft)) return saveSettings()
    if (!snapshot) return true

    if (sessionDraftDirty) {
      const result = validateSessionRequirements(sessionDraft)
      if (!result.valid) {
        setSessionRequirementErrors(result.missing)
        setSessionSetupOpen(true)
        setSessionAutosaveStatus('error')
        flash('Add a Session title before continuing')
        return false
      }
      if (!(await persistSessionDraft(false, ++sessionSaveVersionRef.current))) return false
    }

    if (draftDirty && draft) {
      try {
        if (!(await persistDraft(draft, false, ++draftSaveVersionRef.current))) return false
      } catch (error) {
        setDraftAutosaveStatus('error')
        flashError(error, 'Draft could not be autosaved')
        return false
      }
    }

    return true
  }

  async function loadReviewState(next: SessionSnapshot): Promise<ReviewDraft | null> {
    setFindings(next.findings.map((finding) => normalizeFinding(finding, next.evidenceLinks)))
    const nextDraft = normalizeDraft(next.drafts[0])
    setDraft(nextDraft)
    return nextDraft
  }

  async function createSession(): Promise<void> {
    if (creatingSessionRef.current) return
    creatingSessionRef.current = true
    setBusy(true)
    try {
      const created = await window.qaScribe.createSession({ title: 'New Session' })
      await refreshSessions()
      await openSession(created.id, { mode: 'capture', openSetup: true })
    } finally {
      creatingSessionRef.current = false
      setBusy(false)
    }
  }

  async function saveSession(): Promise<void> {
    if (!validateSessionDraftForAction()) return
    await persistSessionDraft(true, ++sessionSaveVersionRef.current)
  }

  async function persistSessionDraft(showToast: boolean, version: number): Promise<boolean> {
    if (!snapshot) return false
    const result = validateSessionRequirements(sessionDraft)
    if (!result.valid) {
      setSessionRequirementErrors(result.missing)
      setSessionSetupOpen(true)
      setSessionAutosaveStatus('error')
      if (showToast) flash('Add a Session title before continuing')
      return false
    }
    try {
      setSessionAutosaveStatus('saving')
      const sessionId = snapshot.session.id
      const updated = await window.qaScribe.updateSession(sessionId, sessionDraft)
      if (version === sessionSaveVersionRef.current) {
        setSnapshot((current) => (current?.session.id === sessionId ? { ...current, session: updated } : current))
        await refreshSessions()
        setSessionAutosaveStatus('saved')
        setSessionDraftDirty(false)
        if (showToast) flash('Session saved')
        return true
      }
      return false
    } catch (error) {
      if (version === sessionSaveVersionRef.current) {
        setSessionAutosaveStatus('error')
        flashError(error, 'Session could not be saved')
      }
      return false
    }
  }

  async function deleteCurrentSession(): Promise<void> {
    if (!snapshot) return
    await deleteSession(snapshot.session)
  }

  async function deleteSession(session: Session): Promise<void> {
    if (!window.confirm(`Delete Session "${session.title}" and all captured Entries, evidence, Findings, and Drafts?`)) return
    await window.qaScribe.deleteSession(session.id)
    if (window.localStorage.getItem('qa-scribe:last-session') === session.id) {
      window.localStorage.removeItem('qa-scribe:last-session')
    }
    if (snapshot?.session.id !== session.id) {
      await refreshSessions()
      return
    }
    setSnapshot(null)
    setSessionDraft(emptyDraft)
    setFindings([])
    setDraft(null)
    resetCaptureDrafts()
    await bootstrap()
  }

  function resetCaptureDrafts(): void {
    setEntryTitle('')
    setEntryBody('')
    setEntryMetadataJson(null)
    setFindingDraft(createEmptyStructuredFindingDraft())
    setFindingDraftAttachments([])
    setRichTextResetKey((current) => current + 1)
  }

  async function addEntry(): Promise<void> {
    if (!snapshot) return
    const body = entryBody.trim() || entryTitle.trim() || 'Note captured.'
    try {
      const created = await window.qaScribe.createEntry({
        sessionId: snapshot.session.id,
        type: 'note',
        title: entryTitle,
        body,
        metadataJson: entryMetadataJson
      })
      resetCaptureDrafts()
      setQuery('')
      setFilter('all')
      await openSession(snapshot.session.id, { mode: 'capture' })
      setSelectedEntryId(created.id)
      flash('Entry saved')
    } catch (error) {
      flashError(error, 'Entry could not be saved')
    }
  }

  function updateFindingDraft(patch: Partial<StructuredFindingDraft>): void {
    setFindingDraft((current) => ({ ...current, ...patch }))
  }

  async function addFinding(): Promise<void> {
    if (!snapshot) return
    const details = createStructuredFindingDetails(findingDraft, snapshot.session)
    const selectedEvidenceEntry = findingDraft.linkSelectedEntry ? selectedEntry : null
    const linkedAttachments = selectedEvidenceEntry
      ? snapshot.attachments.filter((attachment) => attachment.entryId === selectedEvidenceEntry.id)
      : []
    const title = findingDraft.title.trim() || details.actual || details.expected || details.notes || 'Untitled Finding'

    try {
      const storedFinding = await window.qaScribe.createFinding({
        sessionId: snapshot.session.id,
        title,
        body: renderStructuredFindingBody(details),
        kind: 'bug',
        metadataJson: serializeStructuredFindingDetails(details),
        entryId: selectedEvidenceEntry?.id
      })

      for (const attachment of linkedAttachments) {
        await window.qaScribe.createEvidenceLink({ findingId: storedFinding.id, attachmentId: attachment.id })
      }

      for (const attachment of findingDraftAttachments) {
        await window.qaScribe.createEvidenceLink({ findingId: storedFinding.id, attachmentId: attachment.id })
      }

      setFindingDraft(createEmptyStructuredFindingDraft())
      setFindingDraftAttachments([])
      await openSession(snapshot.session.id)
      if (selectedEvidenceEntry) setSelectedEntryId(selectedEvidenceEntry.id)
      flash('Finding created')
    } catch (error) {
      flashError(error, 'Finding could not be saved')
    }
  }

  async function toggleGenerationExclusion(entry: Entry): Promise<void> {
    if (!snapshot) return
    await window.qaScribe.updateEntry(entry.id, { excludedFromGeneration: !entry.excludedFromGeneration })
    await openSession(snapshot.session.id)
    setSelectedEntryId(entry.id)
    flash(entry.excludedFromGeneration ? 'Entry included for generation' : 'Entry excluded from generation')
  }

  async function saveSelectedEntry(entry: Entry, patch: EntryInspectorSavePatch): Promise<void> {
    if (!snapshot) return
    setEntrySaveBusy(true)
    try {
      await window.qaScribe.updateEntry(entry.id, patch)
      const next = await window.qaScribe.getSession(snapshot.session.id)
      if (next) {
        setSnapshot(next)
        await loadReviewState(next)
        await refreshSessions()
      }
      setSelectedEntryId(entry.id)
      flash('Entry saved')
    } catch (error) {
      flashError(error, 'Entry could not be saved')
    } finally {
      setEntrySaveBusy(false)
    }
  }

  async function toggleReviewedEntry(row: ContextRow): Promise<void> {
    if (!snapshot) return
    if (generationContextId) {
      const nextContext = await window.qaScribe.updateGenerationContextEntry(generationContextId, row.entry.id, !row.included)
      setGenerationContext(nextContext)
      setGenerationContextId(nextContext.context.id)
      flash(row.included ? 'Entry excluded from context' : 'Entry included in context')
      return
    }
    flash('Generation Context is still loading')
  }

  async function deleteEntry(entry: Entry): Promise<void> {
    if (!snapshot) return
    const label = entry.title || formatEntryType(entry.type)
    if (!window.confirm(`Delete Entry "${label}"?`)) return
    await window.qaScribe.deleteEntry(entry.id)
    await openSession(snapshot.session.id)
  }

  async function runAttachmentImport(source: AttachmentImportSource, entryId?: string): Promise<Attachment | null> {
    if (!snapshot) return null
    const sessionId = snapshot.session.id
    if (source === 'browse') return window.qaScribe.importAttachment(sessionId, entryId)
    return window.qaScribe.importClipboardScreenshot(sessionId, entryId)
  }

  function openAttachmentImportModal(entryId?: string): void {
    setAttachmentImportTarget({ kind: 'entry', entryId })
  }

  function openDraftAttachmentImportModal(): void {
    setAttachmentImportTarget({ kind: 'draft-note' })
  }

  function openFindingDraftAttachmentImportModal(field: 'actual' | 'expected'): void {
    setAttachmentImportTarget({ kind: 'draft-finding', field })
  }

  async function handleAttachmentImport(source: AttachmentImportSource): Promise<void> {
    if (!snapshot || !attachmentImportTarget || attachmentImportBusy) return
    setAttachmentImportBusy(true)
    try {
      if (attachmentImportTarget.kind === 'draft-note') {
        await attachToDraftNote(source)
        return
      }

      if (attachmentImportTarget.kind === 'draft-finding') {
        await attachToFindingDraft(source)
        return
      }

      const attachment = await importAttachment(source, attachmentImportTarget.entryId)
      if (attachment === null && source === 'paste') flash('No screenshot or image available')
    } finally {
      setAttachmentImportBusy(false)
      setAttachmentImportTarget(null)
    }
  }

  async function importAttachment(source: AttachmentImportSource, entryId?: string): Promise<AttachmentImportResult> {
    if (!snapshot) return undefined
    try {
      const attachment = await runAttachmentImport(source, entryId)
      if (attachment) {
        await openSession(snapshot.session.id)
        if (entryId) setSelectedEntryId(entryId)
        flash('Evidence imported')
      }
      return attachment ?? null
    } catch (error) {
      flashError(error, 'Evidence could not be imported')
      return undefined
    }
  }

  async function attachToDraftNote(source: AttachmentImportSource): Promise<AttachmentImportResult> {
    if (!snapshot) return undefined
    const body = entryBody.trim() || entryTitle.trim() || 'Evidence attached.'
    let entry: Entry | null = null
    try {
      entry = await window.qaScribe.createEntry({
        sessionId: snapshot.session.id,
        type: 'note',
        title: entryTitle,
        body,
        metadataJson: entryMetadataJson
      })
      const attachment = await runAttachmentImport(source, entry.id)
      if (!attachment) {
        await window.qaScribe.deleteEntry(entry.id)
        if (source === 'paste') flash('No screenshot or image available')
        return null
      }
      resetCaptureDrafts()
      await openSession(snapshot.session.id)
      setSelectedEntryId(entry.id)
      flash('Evidence attached')
      return attachment
    } catch (error) {
      if (entry) await Promise.resolve(window.qaScribe.deleteEntry(entry.id)).catch(() => undefined)
      flashError(error, 'Evidence could not be attached')
      return undefined
    }
  }

  async function attachToFindingDraft(source: AttachmentImportSource): Promise<AttachmentImportResult> {
    if (!snapshot) return undefined
    try {
      const attachment = await runAttachmentImport(source)
      if (!attachment) {
        if (source === 'paste') flash('No screenshot or image available')
        return null
      }
      setFindingDraftAttachments((current) => [...current, attachment])
      flash('Evidence attached to Finding draft')
      return attachment
    } catch (error) {
      flashError(error, 'Evidence could not be attached')
      return undefined
    }
  }

  async function exportSession(format: 'markdown' | 'json'): Promise<void> {
    if (!snapshot) return
    try {
      const exported = await window.qaScribe.exportSession(snapshot.session.id, format)
      await navigator.clipboard.writeText(exported.content)
      flash(`${format === 'markdown' ? 'Markdown' : 'JSON'} copied`)
    } catch (error) {
      flashError(error, 'Export could not be copied')
    }
  }

  async function openGenerationReview(): Promise<void> {
    if (!snapshot) return
    if (!validateSessionDraftForAction()) return
    if (sessionDraftDirty && !(await persistSessionDraft(false, ++sessionSaveVersionRef.current))) return
    setWorkspaceMode('generation')
    if (generationContextId) return
    setBusy(true)
    try {
      const nextContext = await window.qaScribe.createGenerationContext(snapshot.session.id)
      setGenerationContext(nextContext)
      setGenerationContextId(nextContext.context.id)
    } finally {
      setBusy(false)
    }
  }

  async function createFindingFromEntry(entry: Entry): Promise<void> {
    if (!snapshot) return
    setFindingDraft({
      ...createEmptyStructuredFindingDraft(),
      title: entry.title || formatEntryType(entry.type),
      actual: entry.body,
      actualMetadataJson: entry.metadataJson,
      environment: [snapshot.session.environment, snapshot.session.buildVersion].filter(Boolean).join(' / '),
      linkSelectedEntry: true
    })
    setSelectedEntryId(entry.id)
    setCaptureMode('finding')
    setWorkspaceMode('capture')
    flash('Finding draft started')
  }

  async function toggleReviewedAttachment(item: ContextAttachment): Promise<void> {
    if (!generationContextId) return
    const nextContext = await window.qaScribe.updateGenerationContextAttachment(
      generationContextId,
      item.attachment.id,
      !item.included
    )
    setGenerationContext(nextContext)
    setGenerationContextId(nextContext.context.id)
    flash(item.included ? 'Attachment excluded from context' : 'Attachment included in context')
  }

  async function generateTestware(): Promise<void> {
    if (!snapshot) return
    if (!validateSessionDraftForAction()) return
    if (sessionDraftDirty && !(await persistSessionDraft(false, ++sessionSaveVersionRef.current))) return
    const generationOptions = buildGenerationOptions(selectedProviderStatus, selectedModel, selectedReasoningEffort)
    if (!generationOptions) {
      flash('Select an available provider')
      return
    }
    setGenerating(true)
    try {
      let activeContextId = generationContextId
      if (!activeContextId) {
        const nextContext = await window.qaScribe.createGenerationContext(snapshot.session.id)
        setGenerationContext(nextContext)
        activeContextId = nextContext.context.id
        setGenerationContextId(activeContextId)
      }
      const result = await window.qaScribe.generateTestware(activeContextId, generationOptions)
      const generatedDraft = draftFromGenerationResult(result, snapshot, findings)
      await openSession(snapshot.session.id)
      setDraft(generatedDraft)
      setDraftPlaceholderSuppressed(false)
      setWorkspaceMode('drafts')
      flash('Generated draft ready')
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function persistDraft(nextDraft: ReviewDraft, showToast = false, version = draftSaveVersionRef.current): Promise<boolean> {
    if (!snapshot) return false
    if (version !== draftSaveVersionRef.current) return false
    let saved = nextDraft
    setDraftAutosaveStatus('saving')
    if (draft?.id && !draft.id.startsWith('local-draft-')) {
      saved = normalizeDraft(
        await window.qaScribe.updateDraft(draft.id, {
          title: nextDraft.title,
          body: nextDraft.content
        })
      ) ?? nextDraft
    } else {
      saved =
        normalizeDraft(
          await window.qaScribe.createDraft({
            sessionId: snapshot.session.id,
            kind: 'session_report',
            title: nextDraft.title,
            body: nextDraft.content
          })
        ) ?? nextDraft
    }
    if (version === draftSaveVersionRef.current) {
      setDraft(saved)
      setDraftPlaceholderSuppressed(false)
      setDraftAutosaveStatus('saved')
      setDraftDirty(false)
      if (showToast) flash('Draft saved')
      return true
    }
    return false
  }

  async function updateDraftContent(content: string): Promise<void> {
    if (!snapshot) return
    const nextDraft =
      draft ??
      createLocalReviewDraft(
        snapshot,
        findings,
        contextRows.filter((row) => row.included)
      )
    setDraft({ ...nextDraft, content, updatedAt: new Date().toISOString() })
    setDraftPlaceholderSuppressed(false)
    setDraftDirty(true)
    draftSaveVersionRef.current += 1
    setDraftAutosaveStatus('idle')
  }

  async function saveDraft(): Promise<void> {
    if (!snapshot) return
    const nextDraft =
      draft ??
      createLocalReviewDraft(
        snapshot,
        findings,
        contextRows.filter((row) => row.included)
    )
    try {
      await persistDraft({ ...nextDraft, updatedAt: new Date().toISOString() }, true, ++draftSaveVersionRef.current)
    } catch (error) {
      setDraftAutosaveStatus('error')
      flashError(error, 'Draft could not be saved')
    }
  }

  function createDraftFromTemplate(): void {
    if (!snapshot) return
    setDraft(
      createLocalReviewDraft(
        snapshot,
        findings,
        contextRows.filter((row) => row.included)
      )
    )
    setDraftDirty(false)
    setDraftAutosaveStatus('idle')
    setDraftPlaceholderSuppressed(false)
  }

  async function deleteCurrentDraft(): Promise<void> {
    if (!snapshot) return
    const draftToDelete =
      draft ??
      (!draftPlaceholderSuppressed
        ? createLocalReviewDraft(
            snapshot,
            findings,
            contextRows.filter((row) => row.included)
          )
        : null)
    if (!draftToDelete) return
    if (!window.confirm(`Delete "${draftToDelete.title}"? This cannot be undone.`)) return

    draftSaveVersionRef.current += 1
    setDraftDirty(false)
    setDraftAutosaveStatus('idle')

    if (draftToDelete.id.startsWith('local-draft-')) {
      setDraft(null)
      setDraftEvidenceAttachments([])
      setDraftPlaceholderSuppressed(true)
      flash('Draft deleted')
      return
    }

    setDeletingDraft(true)
    try {
      await window.qaScribe.deleteDraft(draftToDelete.id)
      const next = await window.qaScribe.getSession(snapshot.session.id)
      const nextDraft = next ? await loadReviewState(next) : null
      if (next) setSnapshot(next)
      setDraftPlaceholderSuppressed(nextDraft === null)
      await refreshSessions()
      flash('Draft deleted')
    } catch (error) {
      setDraftAutosaveStatus('error')
      flashError(error, 'Draft could not be deleted')
    } finally {
      setDeletingDraft(false)
    }
  }

  async function copyText(text: string, message = 'Copied'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      flash(message)
    } catch (error) {
      flashError(error, 'Copy failed')
    }
  }

  async function copyScreenshot(attachment: Attachment): Promise<void> {
    try {
      const copied = await window.qaScribe.copyAttachmentImageToClipboard(attachment.id)
      if (copied) {
        flash('Screenshot copied')
      } else {
        flash('Screenshot could not be copied')
      }
    } catch (error) {
      flashError(error, 'Screenshot copy failed')
    }
  }

  function flash(message: string): void {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    setNotice(message)
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null)
      noticeTimerRef.current = null
    }, 1800)
  }

  function flashError(error: unknown, fallback: string): void {
    flash(error instanceof Error ? error.message : fallback)
  }

  function updateSessionDraft(patch: Partial<SessionDraft>): void {
    const nextDraft = { ...sessionDraft, ...patch }
    setSessionDraft(nextDraft)
    setSessionDraftDirty(true)
    sessionSaveVersionRef.current += 1
    setSessionAutosaveStatus('idle')
    setSessionRequirementErrors(validateSessionRequirements(nextDraft).missing)
  }

  function validateSessionDraftForAction(): boolean {
    const result = validateSessionRequirements(sessionDraft)
    setSessionRequirementErrors(result.missing)
    if (!result.valid) flash('Add a Session title before continuing')
    return result.valid
  }

  function sessionFieldError(key: SessionRequirementKey): string | null {
    if (!sessionRequirementErrors.includes(key)) return null
    return 'Title is required.'
  }

  function autosaveLabel(status: AutosaveStatus): string {
    if (sessionSetupNeedsAttention) return 'Title required'
    if (status === 'saving') return 'Saving...'
    if (status === 'saved') return 'Saved'
    if (status === 'error') return 'Save failed'
    return 'Autosave on'
  }

  function attachmentTargetLabel(target: AttachmentImportTarget): string {
    if (target.kind === 'draft-note') return 'Attach to new note from the current composer'
    if (target.kind === 'draft-finding') return `Attach to Finding draft ${target.field} result`
    if (!target.entryId) return 'Attach to this Session'
    const entry = snapshot?.entries.find((item) => item.id === target.entryId)
    return `Attach to Entry: ${entry?.title || entry?.body.split('\n')[0] || 'Untitled Entry'}`
  }

  const displayedDraft =
    snapshot && !draftPlaceholderSuppressed
      ? draft ??
        createLocalReviewDraft(
          snapshot,
          findings,
          contextRows.filter((row) => row.included)
        )
      : draft

  return (
    <main className="app-shell">
      <SessionSidebar
        busy={busy}
        settingsSelected={workspaceMode === 'settings'}
        sessions={sessions}
        selectedSessionId={workspaceMode === 'settings' ? null : snapshot?.session.id ?? null}
        onCreateSession={createSession}
        onDeleteSession={deleteSession}
        onOpenSettings={openSettings}
        onOpenSession={openSession}
      />

      <section className="workspace">
        {workspaceMode === 'settings' ? (
          <SettingsPane
            draft={settingsDraft}
            error={settingsError}
            saving={settingsSaving}
            settings={settings}
            onChange={updateSettingsDraft}
            onClose={closeSettings}
            onReset={resetSettingsDraft}
            onSave={saveSettings}
          />
        ) : snapshot ? (
          <>
            <header className="topbar">
              <div>
                <div className="topbar-title">
                  <h1>{snapshot.session.title}</h1>
                  <button
                    aria-label="Edit Session details"
                    className="icon-command"
                    title="Edit Session details"
                    type="button"
                    onClick={() => setSessionSetupOpen((open) => !open)}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                <p>{snapshot.session.testTarget || snapshot.session.charter || 'Capture notes, evidence, and findings'}</p>
              </div>
              <div className="topbar-actions">
                <StatusPill providerStatus={providerStatus} />
                <button className="primary-command" type="button" onClick={openGenerationReview}>
                  <Sparkles size={16} />
                  {workspaceMode === 'drafts' ? 'Regenerate' : 'Generate Testware'}
                </button>
                <details className="topbar-menu">
                  <summary aria-label="Session actions" className="secondary-command compact">
                    <MoreHorizontal size={16} />
                  </summary>
                  <div className="topbar-menu-panel">
                    <dl className="session-menu-stats">
                      <dt>Entries</dt>
                      <dd>{snapshot.entries.length}</dd>
                      <dt>Findings</dt>
                      <dd>{findings.length}</dd>
                      <dt>Evidence</dt>
                      <dd>{snapshot.attachments.length}</dd>
                    </dl>
                    <button className="secondary-command fit" type="button" onClick={() => exportSession('markdown')}>
                      <FileText size={16} />
                      Export Markdown
                    </button>
                    <button className="secondary-command fit" type="button" onClick={() => exportSession('json')}>
                      <FileJson size={16} />
                      Export JSON
                    </button>
                    <button className="danger-command fit" type="button" onClick={deleteCurrentSession}>
                      <Trash2 size={16} />
                      Delete Session
                    </button>
                  </div>
                </details>
              </div>
            </header>

            {sessionSetupOpen || sessionSetupNeedsAttention ? (
              <SessionSetupPanel
                autosaveLabel={autosaveLabel(sessionAutosaveStatus)}
                autosaveStatus={sessionAutosaveStatus}
                draft={sessionDraft}
                fieldError={sessionFieldError}
                needsAttention={sessionSetupNeedsAttention}
                open={sessionSetupOpen}
                moreDetailsOpen={moreDetailsOpen}
                onOpenToggle={setSessionSetupOpen}
                onMoreDetailsToggle={setMoreDetailsOpen}
                onSave={saveSession}
                onUpdateDraft={updateSessionDraft}
              />
            ) : null}

            <section className={selectedEntry ? 'detail-grid has-inspector' : 'detail-grid'}>
              <div className="timeline-pane">
                <ModeTabs mode={workspaceMode} setMode={setWorkspaceMode} onOpenGeneration={openGenerationReview} />

                {workspaceMode === 'capture' ? (
                  <CapturePane
                    captureMode={captureMode}
                    entryBody={entryBody}
                    entryMetadataJson={entryMetadataJson}
                    entryTitle={entryTitle}
                    findingDraftAttachmentCount={findingDraftAttachments.length}
                    findingDraft={findingDraft}
                    filter={filter}
                    filteredEntries={filteredEntries}
                    query={query}
                    richTextResetKey={richTextResetKey}
                    selectedEntry={selectedEntry}
                    selectedEntryId={selectedEntryId}
                    snapshot={snapshot}
                    templates={settings?.templates}
                    setCaptureMode={setCaptureMode}
                    setEntryBody={setEntryBody}
                    setEntryMetadataJson={setEntryMetadataJson}
                    setEntryTitle={setEntryTitle}
                    setFilter={setFilter}
                    setQuery={setQuery}
                    onAddEntry={addEntry}
                    onAddFinding={addFinding}
                    onAttach={async (entryId) => openAttachmentImportModal(entryId)}
                    onAttachToDraft={async () => openDraftAttachmentImportModal()}
                    onAttachToFindingDraft={async (field) => openFindingDraftAttachmentImportModal(field)}
                    onCreateFinding={createFindingFromEntry}
                    onDelete={deleteEntry}
                    onSelect={setSelectedEntryId}
                    onToggleExclude={toggleGenerationExclusion}
                    onUpdateFindingDraft={updateFindingDraft}
                  />
                ) : null}

                {workspaceMode === 'generation' ? (
                  <GenerationReviewPane
                    busy={busy}
                    findings={findings}
                    generating={generating}
                    contextReady={Boolean(generationContextId)}
                    providerStatus={providerStatus}
                    rows={contextRows}
                    selectedModel={selectedModel}
                    selectedProvider={selectedProvider}
                    selectedReasoningEffort={selectedReasoningEffort}
                    sessionAttachments={sessionLevelAttachments}
                    session={snapshot.session}
                    onAddAttachment={() => openAttachmentImportModal()}
                    onGenerate={generateTestware}
                    onModelChange={setSelectedModel}
                    onProviderChange={setSelectedProvider}
                    onReasoningEffortChange={setSelectedReasoningEffort}
                    onToggleAttachment={toggleReviewedAttachment}
                    onToggleEntry={toggleReviewedEntry}
                  />
                ) : null}

                {workspaceMode === 'drafts' ? (
                  <DraftsPane
                    draft={displayedDraft}
                    deleting={deletingDraft}
                    evidenceAttachments={draftEvidenceAttachments}
                    findings={findings}
                    autosaveStatus={draftAutosaveStatus}
                    onCreateDraft={createDraftFromTemplate}
                    onCopy={copyText}
                    onCopyScreenshot={copyScreenshot}
                    onDelete={deleteCurrentDraft}
                    onExport={exportSession}
                    onSave={saveDraft}
                    onUpdateContent={(content) => void updateDraftContent(content)}
                  />
                ) : null}
              </div>

              {selectedEntry ? (
                <aside className="inspector" aria-label="Inspector">
                  <div className="inspector-title">
                    <PanelRightOpen size={17} />
                    <span>Entry Inspector</span>
                  </div>
                  <EntryInspector
                    attachments={snapshot.attachments.filter((attachment) => attachment.entryId === selectedEntry.id)}
                    entry={selectedEntry}
                    findings={findings.filter((finding) => finding.evidenceEntryIds.includes(selectedEntry.id))}
                    saving={entrySaveBusy}
                    onAttach={() => openAttachmentImportModal(selectedEntry.id)}
                    onClose={() => setSelectedEntryId(null)}
                    onCreateFinding={() => createFindingFromEntry(selectedEntry)}
                    onSaveEntry={(patch) => saveSelectedEntry(selectedEntry, patch)}
                  />
                </aside>
              ) : null}
            </section>
          </>
        ) : (
          <section className="launch-state">
            <div>
              <h1>qa-scribe</h1>
              <p>Start a local testing Session and capture the raw material while it is still fresh.</p>
              <button className="primary-command fit" disabled={busy} onClick={createSession} type="button">
                {busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
                New Session
              </button>
            </div>
          </section>
        )}
      </section>

      {attachmentImportTarget ? (
        <AttachmentImportDialog
          busy={attachmentImportBusy}
          targetLabel={attachmentTargetLabel(attachmentImportTarget)}
          onClose={() => setAttachmentImportTarget(null)}
          onImport={(source) => void handleAttachmentImport(source)}
        />
      ) : null}

      {notice ? (
        <div aria-live="polite" className="toast" role="status">
          {notice}
        </div>
      ) : null}
    </main>
  )
}
