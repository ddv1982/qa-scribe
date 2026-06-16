import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  ClipboardPaste,
  FileJson,
  FileText,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  PanelRightOpen,
  Plus,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { defaultReasoningEffortFor, reasoningEffortsFor, validateSessionRequirements } from '../../shared/contracts'
import type {
  Attachment,
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
  StatusPill
} from './components/AppSections'
import { SessionSetupPanel, type SessionAutosaveStatus } from './components/SessionSetupPanel'
import { SessionSidebar } from './components/SessionSidebar'
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
type AttachmentImportSource = 'browse' | 'paste'
type AttachmentImportTarget = { kind: 'entry'; entryId?: string } | { kind: 'draft-note' }
type AttachmentImportResult = Attachment | null | undefined

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
  const [selectedProvider, setSelectedProvider] = useState<AiProviderId | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
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
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [attachmentImportTarget, setAttachmentImportTarget] = useState<AttachmentImportTarget | null>(null)
  const [attachmentImportBusy, setAttachmentImportBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
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
    if (sessionSetupNeedsAttention) setSessionSetupOpen(true)
  }, [sessionSetupNeedsAttention])

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
      void persistDraft(draft, false, version).catch((error) => {
        if (version !== draftSaveVersionRef.current) return
        setDraftAutosaveStatus('error')
        flashError(error, 'Draft could not be autosaved')
      })
    }, 600)

    return () => window.clearTimeout(timer)
  }, [draft, draftDirty])

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
      const matchesType = filter === 'all' || entry.type === filter
      const matchesQuery =
        normalizedQuery.length === 0 ||
        entry.title?.toLowerCase().includes(normalizedQuery) ||
        entry.body.toLowerCase().includes(normalizedQuery)
      return matchesType && matchesQuery
    })
  }, [filter, query, snapshot])

  async function bootstrap(): Promise<void> {
    setBusy(true)
    try {
      const [sessionList, aiStatus] = await Promise.all([window.qaScribe.listSessions(), window.qaScribe.getProviderStatus()])
      setSessions(sessionList)
      setProviderStatus(aiStatus)

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

  async function openSession(id: string): Promise<void> {
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
    setSelectedEntryId(null)
    setGenerationContext(null)
    setGenerationContextId(null)
    resetCaptureDrafts()
    await loadReviewState(next)
    setDraftDirty(false)
    setDraftAutosaveStatus('idle')
    window.localStorage.setItem('qa-scribe:last-session', id)
    await refreshSessions()
  }

  async function flushPendingAutosaves(): Promise<boolean> {
    if (!snapshot) return true

    if (sessionDraftDirty && !(await persistSessionDraft(false, ++sessionSaveVersionRef.current))) return false

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

  async function loadReviewState(next: SessionSnapshot): Promise<void> {
    setFindings(next.findings.map((finding) => normalizeFinding(finding, next.evidenceLinks)))
    setDraft(normalizeDraft(next.drafts[0]))
  }

  async function createSession(): Promise<void> {
    setBusy(true)
    try {
      const created = await window.qaScribe.createSession({ title: 'New Session' })
      await refreshSessions()
      await openSession(created.id)
    } finally {
      setBusy(false)
    }
  }

  async function saveSession(): Promise<void> {
    if (!validateSessionDraftForAction()) return
    await persistSessionDraft(true, ++sessionSaveVersionRef.current)
  }

  async function persistSessionDraft(showToast: boolean, version: number): Promise<boolean> {
    if (!snapshot) return false
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
    if (!window.confirm(`Delete Session "${snapshot.session.title}" and all captured Entries, evidence, Findings, and Drafts?`)) return
    await window.qaScribe.deleteSession(snapshot.session.id)
    window.localStorage.removeItem('qa-scribe:last-session')
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
    setRichTextResetKey((current) => current + 1)
  }

  async function addEntry(): Promise<void> {
    if (!snapshot || entryBody.trim().length === 0) return
    try {
      await window.qaScribe.createEntry({
        sessionId: snapshot.session.id,
        type: 'note',
        title: entryTitle,
        body: entryBody,
        metadataJson: entryMetadataJson
      })
      resetCaptureDrafts()
      await openSession(snapshot.session.id)
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
    if (findingDraft.title.trim().length === 0) return

    try {
      const storedFinding = await window.qaScribe.createFinding({
        sessionId: snapshot.session.id,
        title: findingDraft.title.trim(),
        body: renderStructuredFindingBody(details),
        kind: 'bug',
        metadataJson: serializeStructuredFindingDetails(details),
        entryId: selectedEvidenceEntry?.id
      })

      for (const attachment of linkedAttachments) {
        await window.qaScribe.createEvidenceLink({ findingId: storedFinding.id, attachmentId: attachment.id })
      }

      setFindingDraft(createEmptyStructuredFindingDraft())
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

  async function handleAttachmentImport(source: AttachmentImportSource): Promise<void> {
    if (!snapshot || !attachmentImportTarget || attachmentImportBusy) return
    setAttachmentImportBusy(true)
    try {
      if (attachmentImportTarget.kind === 'draft-note') {
        await attachToDraftNote(source)
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
    try {
      const entry = await window.qaScribe.createEntry({
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
    const entryAttachments = snapshot.attachments.filter((attachment) => attachment.entryId === entry.id)
    try {
      const storedFinding = await window.qaScribe.createFinding({
        sessionId: snapshot.session.id,
        title: entry.title || formatEntryType(entry.type),
        body: entry.body,
        kind: 'bug',
        entryId: entry.id
      })
      for (const attachment of entryAttachments) {
        await window.qaScribe.createEvidenceLink({ findingId: storedFinding.id, attachmentId: attachment.id })
      }
      const created = normalizeFinding(
        storedFinding,
        [
          {
            id: `entry-${entry.id}`,
            findingId: storedFinding.id,
            entryId: entry.id,
            attachmentId: null,
            createdAt: storedFinding.createdAt
          },
          ...entryAttachments.map((attachment) => ({
            id: `attachment-${attachment.id}`,
            findingId: storedFinding.id,
            entryId: null,
            attachmentId: attachment.id,
            createdAt: storedFinding.createdAt
          }))
        ]
      )
      const nextFindings = [...findings, created]
      setFindings(nextFindings)
      await openSession(snapshot.session.id)
      setSelectedEntryId(entry.id)
      flash('Finding created')
    } catch (error) {
      flashError(error, 'Finding could not be created')
    }
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
      setWorkspaceMode('drafts')
      flash('Generated draft ready')
    } catch (error) {
      await openSession(snapshot.session.id)
      flash(error instanceof Error ? error.message : 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function persistDraft(nextDraft: ReviewDraft, showToast = false, version = draftSaveVersionRef.current): Promise<boolean> {
    if (!snapshot) return false
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

  async function copyText(text: string, message = 'Copied'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      flash(message)
    } catch (error) {
      flashError(error, 'Copy failed')
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
    if (sessionRequirementErrors.length > 0) {
      setSessionRequirementErrors(validateSessionRequirements(nextDraft).missing)
    }
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
    if (status === 'saving') return 'Saving...'
    if (status === 'saved') return 'Saved'
    if (status === 'error') return 'Save failed'
    return 'Autosave on'
  }

  return (
    <main className="app-shell">
      <SessionSidebar
        sessions={sessions}
        selectedSessionId={snapshot?.session.id ?? null}
        onCreateSession={createSession}
        onOpenSession={openSession}
      />

      <section className="workspace">
        {snapshot ? (
          <>
            <header className="topbar">
              <div>
                <h1>{snapshot.session.title}</h1>
                <p>{snapshot.session.testTarget || snapshot.session.charter || 'Capture notes, evidence, and findings'}</p>
              </div>
              <div className="topbar-actions">
                <StatusPill providerStatus={providerStatus} />
                <button className="primary-command" type="button" onClick={openGenerationReview}>
                  <Sparkles size={16} />
                  Generate Testware
                </button>
                <details className="topbar-menu">
                  <summary className="secondary-command compact">
                    <MoreHorizontal size={16} />
                    Session
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

            <section className={selectedEntry ? 'detail-grid has-inspector' : 'detail-grid'}>
              <div className="timeline-pane">
                <ModeTabs mode={workspaceMode} setMode={setWorkspaceMode} onOpenGeneration={openGenerationReview} />

                {workspaceMode === 'capture' ? (
                  <CapturePane
                    captureMode={captureMode}
                    entryBody={entryBody}
                    entryMetadataJson={entryMetadataJson}
                    entryTitle={entryTitle}
                    findingDraft={findingDraft}
                    filter={filter}
                    filteredEntries={filteredEntries}
                    query={query}
                    richTextResetKey={richTextResetKey}
                    selectedEntry={selectedEntry}
                    selectedEntryId={selectedEntryId}
                    snapshot={snapshot}
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
                    draft={
                      draft ??
                      createLocalReviewDraft(
                        snapshot,
                        findings,
                        contextRows.filter((row) => row.included)
                      )
                    }
                    findings={findings}
                    autosaveStatus={draftAutosaveStatus}
                    onCopy={copyText}
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
                    onAttach={() => openAttachmentImportModal(selectedEntry.id)}
                    onCreateFinding={() => createFindingFromEntry(selectedEntry)}
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
              <button className="primary-command fit" onClick={createSession} type="button">
                {busy ? <Loader2 className="spin" size={17} /> : <Plus size={17} />}
                New Session
              </button>
            </div>
          </section>
        )}
      </section>

      {attachmentImportTarget ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !attachmentImportBusy && setAttachmentImportTarget(null)}
        >
          <section
            aria-labelledby="attachment-import-title"
            aria-modal="true"
            className="attachment-import-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="eyebrow">Evidence</span>
                <h2 id="attachment-import-title">Attach Evidence</h2>
              </div>
              <button
                aria-label="Close evidence import"
                className="icon-command"
                disabled={attachmentImportBusy}
                type="button"
                onClick={() => setAttachmentImportTarget(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="attachment-import-actions">
              <button
                className="secondary-command attachment-import-action"
                disabled={attachmentImportBusy}
                type="button"
                onClick={() => void handleAttachmentImport('browse')}
              >
                <FolderOpen size={18} />
                <span>
                  <strong>Browse</strong>
                  <small>Select a file from disk</small>
                </span>
              </button>
              <button
                className="secondary-command attachment-import-action"
                disabled={attachmentImportBusy}
                type="button"
                onClick={() => void handleAttachmentImport('paste')}
              >
                <ClipboardPaste size={18} />
                <span>
                  <strong>Paste Screenshot/Image</strong>
                  <small>Import the current clipboard image</small>
                </span>
              </button>
            </div>
            <div className="modal-footer">
              <button
                className="secondary-command fit"
                disabled={attachmentImportBusy}
                type="button"
                onClick={() => setAttachmentImportTarget(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {notice ? <div className="toast">{notice}</div> : null}
    </main>
  )
}
