import {
  cancelAiActionJob,
  getAiActionJobStatus,
  listActiveAiActionJobs,
  openSessionNoteState,
  startAiActionJob,
  type Draft,
  type Entry,
  type Finding,
  type GenerateAiActionKind,
  type GenerationJobEvent,
  type GenerationJobStatus,
  type TestwareGenerationPreferences,
} from '../tauri'
import {
  preserveManagedImageNodes,
  richEditorDocumentFromStoredBody,
  richEditorDocumentToStoredBody,
  serializeRichEditorDocument,
} from '../editor/editorDocument'
import { formatError } from '../ui/format'
import type { GenerationActionsContext } from './generationActions.types'
import { useStableCapability } from './useStableCapability'

export type { GenerationActionsContext } from './generationActions.types'

export function generationIsActive(job: GenerationJobStatus): boolean {
  return job.state === 'starting' || job.state === 'running' || job.state === 'cancelling'
}

// How often boot-time reconciliation re-polls a recovered job's status. The
// original invoke `Channel` is gone after a webview reload, so we cannot
// re-subscribe to the streaming events; polling `get_ai_action_job_status` is
// the simplest way to drive the recovered job to a terminal UI state.
const RECONCILE_POLL_INTERVAL_MS = 1000
const RECOVERY_COMMAND_MAX_ATTEMPTS = 3

export function createGenerationActions(ctx: GenerationActionsContext) {
  let reconciliationStarted = false
  const recoveredSummaryReloadVersions = new Map<string, number>()

  function storeGenerationStatus(status: GenerationJobStatus) {
    ctx.generation.setGenerationJobs((previous) => ({ ...previous, [status.jobId]: status }))
  }

  // This capture is a distinct startup phase so recovered Summary jobs can
  // block Note saves before the startup Session is hydrated. Polling starts
  // only after hydration, when a completed Summary can be applied safely.
  async function captureActiveJobs() {
    let activeJobsCommand: typeof listActiveAiActionJobs
    try {
      activeJobsCommand = listActiveAiActionJobs
    } catch {
      // Generated Tauri bindings always provide this function. Lightweight
      // non-Tauri hosts may intentionally omit recovery commands.
      ctx.summaryRecovery.discoveryPendingRef.current = false
      return
    }
    if (typeof activeJobsCommand !== 'function') {
      ctx.summaryRecovery.discoveryPendingRef.current = false
      return
    }
    ctx.summaryRecovery.discoveryPendingRef.current = true
    let active: GenerationJobStatus[]
    try {
      active = await runRecoveryCommand(activeJobsCommand)
    } catch (cause) {
      // Do not hydrate a Note from an uncertain startup. A restart can retry
      // after the bounded transient-error budget is exhausted.
      ctx.feedback.setError(formatError(cause))
      throw cause
    }

    ctx.summaryRecovery.recoveredJobsRef.current.clear()
    ctx.summaryRecovery.unresolvedSummaryJobsRef.current.clear()
    for (const status of active) {
      ctx.summaryRecovery.recoveredJobsRef.current.set(status.jobId, status)
      if (status.action === 'summary') {
        ctx.summaryRecovery.unresolvedSummaryJobsRef.current.set(status.jobId, status.sessionId)
      }
      storeGenerationStatus(status)
    }
    ctx.summaryRecovery.discoveryPendingRef.current = false
    if (reconciliationStarted) startCapturedJobPolls()
  }

  function reconcileActiveJobs(): Promise<void> {
    reconciliationStarted = true
    startCapturedJobPolls()
    return Promise.resolve()
  }

  function startCapturedJobPolls() {
    const active = Array.from(ctx.summaryRecovery.recoveredJobsRef.current.values())
    ctx.summaryRecovery.recoveredJobsRef.current.clear()
    for (const status of active) {
      void pollJobToTerminal(status.jobId)
    }
  }

  function summaryRecoveryBlocksSession(sessionId: string): boolean {
    return ctx.summaryRecovery.discoveryPendingRef.current
      || Array.from(ctx.summaryRecovery.unresolvedSummaryJobsRef.current.values()).includes(sessionId)
  }

  function flushBlockedNoteSave(sessionId: string | null) {
    if (
      !sessionId
      || ctx.session.activeSessionIdRef.current !== sessionId
      || summaryRecoveryBlocksSession(sessionId)
      || !ctx.summaryRecovery.blockedSaveSessionIdsRef.current.delete(sessionId)
    ) return
    void ctx.saveNoteNow({ manageBusy: false })
  }

  function finishSummaryReconciliation(jobId: string, sessionId: string, flushDirtyNote: boolean) {
    ctx.summaryRecovery.unresolvedSummaryJobsRef.current.delete(jobId)
    if (summaryRecoveryBlocksSession(sessionId)) return
    if (flushDirtyNote) flushBlockedNoteSave(sessionId)
    else ctx.summaryRecovery.blockedSaveSessionIdsRef.current.delete(sessionId)
  }

  async function reloadRecoveredSummary(sessionId: string): Promise<Entry | null> {
    try {
      const canonical = await runRecoveryCommand(() => openSessionNoteState(sessionId))
      if (
        canonical.session.id !== sessionId
        || canonical.noteEntry.sessionId !== sessionId
      ) {
        ctx.feedback.setError('Recovered Summary returned an unexpected Session or Note Entry.')
        return null
      }
      return canonical.noteEntry
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
      return null
    }
  }

  async function pollJobToTerminal(jobId: string) {
    let consecutiveStatusErrors = 0
    for (;;) {
      await delay(RECONCILE_POLL_INTERVAL_MS)
      let status: GenerationJobStatus
      try {
        status = await getAiActionJobStatus(jobId)
      } catch (cause) {
        consecutiveStatusErrors += 1
        if (consecutiveStatusErrors < RECOVERY_COMMAND_MAX_ATTEMPTS) continue
        // Keep Summary protection in place, but stop the bounded retry loop.
        // Restarting the app starts a fresh discovery/reconciliation attempt.
        ctx.feedback.setError(formatError(cause))
        return
      }
      consecutiveStatusErrors = 0
      storeGenerationStatus(status)
      if (!generationIsActive(status)) {
        const summarySessionId = ctx.summaryRecovery.unresolvedSummaryJobsRef.current.get(jobId)
        if (summarySessionId && status.state === 'completed') {
          const reloadVersion = (recoveredSummaryReloadVersions.get(summarySessionId) ?? 0) + 1
          recoveredSummaryReloadVersions.set(summarySessionId, reloadVersion)
          const canonicalEntry = await reloadRecoveredSummary(summarySessionId)
          if (!canonicalEntry) return

          if (recoveredSummaryReloadVersions.get(summarySessionId) !== reloadVersion) {
            // A later reload started for this Session, so this response cannot
            // be the freshest canonical Summary even if it resolved last.
          } else if (
            ctx.session.activeSessionIdRef.current === summarySessionId
            && ctx.session.noteEntryIdRef.current === canonicalEntry.id
          ) {
            applyRecoveredGeneratedNoteEntry(canonicalEntry)
            ctx.summaryRecovery.completedSummaryEntriesRef.current.delete(summarySessionId)
          } else if (ctx.summaryRecovery.openingSessionIdRef.current === summarySessionId) {
            // An in-flight open may have captured the pre-completion Note. Let
            // Session hydration consume this canonical result instead.
            ctx.summaryRecovery.completedSummaryEntriesRef.current.set(summarySessionId, canonicalEntry)
          }
        }
        if (summarySessionId) {
          finishSummaryReconciliation(jobId, summarySessionId, status.state !== 'completed')
        }
        if (status.state === 'failed' && status.errorMessage) ctx.feedback.setError(status.errorMessage)
        else if (status.state === 'cancelled') ctx.feedback.setNotice('Generation cancelled')
        else if (status.state === 'completed') ctx.feedback.setNotice('Generation finished')
        return
      }
    }
  }

  async function runRecoveryCommand<T>(command: () => Promise<T>): Promise<T> {
    let lastCause: unknown
    for (let attempt = 1; attempt <= RECOVERY_COMMAND_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await command()
      } catch (cause) {
        lastCause = cause
        if (attempt < RECOVERY_COMMAND_MAX_ATTEMPTS) {
          await delay(RECONCILE_POLL_INTERVAL_MS)
        }
      }
    }
    throw lastCause
  }

  function mergeDraft(draft: Draft) {
    ctx.records.setDrafts((previous) => {
      const exists = previous.some((item) => item.id === draft.id)
      if (!exists && draft.kind === 'testware') ctx.records.setTestwareDraftCount((count) => count + 1)
      const nextDrafts = exists
        ? previous.map((item) => (item.id === draft.id && !ctx.records.dirtyDraftIdsRef.current.has(item.id) ? draft : item))
        : [draft, ...previous]
      ctx.records.draftsRef.current = nextDrafts
      return nextDrafts
    })
  }

  function mergeFinding(finding: Finding) {
    ctx.records.setFindings((previous) => {
      const exists = previous.some((item) => item.id === finding.id)
      if (!exists) ctx.records.setFindingCount((count) => count + 1)
      const nextFindings = exists
        ? previous.map((item) => (item.id === finding.id && !ctx.records.dirtyFindingIdsRef.current.has(item.id) ? finding : item))
        : [finding, ...previous]
      ctx.records.findingsRef.current = nextFindings
      return nextFindings
    })
  }

  function applyGeneratedNoteEntry(generatedEntry: Entry) {
    const previousBody = ctx.session.noteBodyRef.current
    const generatedBody = richEditorDocumentFromStoredBody(generatedEntry)
    const nextBody = preserveManagedImageNodes(previousBody, generatedBody)
    const generatedSerialized = serializeRichEditorDocument(generatedBody)
    const nextSerialized = serializeRichEditorDocument(nextBody)
    const storedBody = richEditorDocumentToStoredBody(nextBody)
    const richNoteEntry = { ...generatedEntry, ...storedBody }
    ctx.adoptCanonicalNoteBody(generatedBody, richNoteEntry.id, richNoteEntry.sessionId)
    ctx.generation.setLatestNoteGenerationUndo({ entryId: richNoteEntry.id, before: previousBody })
    ctx.session.setNoteEntry(richNoteEntry)
    ctx.session.setNoteBody(nextBody)
    // The provider result is already canonical in the backend. Any preserved
    // images remain visibly dirty until their compensating write succeeds.
    ctx.session.savedBodyRef.current = generatedSerialized
    if (generatedSerialized === nextSerialized) {
      ctx.feedback.setNotice('Note summarized')
      return
    }
    void ctx.saveNoteBody(nextBody, {
      manageBusy: false,
      entryId: richNoteEntry.id,
      sessionId: richNoteEntry.sessionId,
      expectedCurrentBody: nextSerialized,
      allowRecoveryWrite: true,
    })
    ctx.feedback.setNotice('Note summarized')
  }

  function applyRecoveredGeneratedNoteEntry(generatedEntry: Entry) {
    const previousBody = ctx.session.noteBodyRef.current
    const priorRecoveryDecision = ctx.latestNoteGenerationUndoRef.current?.pendingRecoveryDecision
      && ctx.latestNoteGenerationUndoRef.current.entryId === generatedEntry.id
      ? ctx.latestNoteGenerationUndoRef.current
      : null
    const authoredBody = priorRecoveryDecision?.pendingRecoveryChoice === 'generated'
      ? previousBody
      : priorRecoveryDecision?.before ?? previousBody
    const generatedBody = richEditorDocumentFromStoredBody(generatedEntry)
    const nextBody = preserveManagedImageNodes(previousBody, generatedBody)
    const previousSerialized = serializeRichEditorDocument(previousBody)
    const authoredSerialized = serializeRichEditorDocument(authoredBody)
    const generatedSerialized = serializeRichEditorDocument(generatedBody)
    const nextSerialized = serializeRichEditorDocument(nextBody)
    const storedBody = richEditorDocumentToStoredBody(nextBody)
    const richNoteEntry = { ...generatedEntry, ...storedBody }
    ctx.adoptCanonicalNoteBody(generatedBody, richNoteEntry.id, richNoteEntry.sessionId)

    const hasDirtyAuthoredBody = (
      Boolean(priorRecoveryDecision)
      || previousSerialized !== ctx.session.savedBodyRef.current
    ) && authoredSerialized !== nextSerialized

    // Dirty authored text and a recovered backend completion are two valid,
    // conflicting outcomes. Keep that choice explicit instead of silently
    // treating the generated body as saved or reducing it to ordinary undo.
    if (hasDirtyAuthoredBody) {
      ctx.generation.setLatestNoteGenerationUndo({
        entryId: richNoteEntry.id,
        before: authoredBody,
        pendingRecoveryDecision: true,
        generated: nextBody,
        generatedCanonical: generatedBody,
      })
    } else if (previousSerialized !== nextSerialized) {
      ctx.generation.setLatestNoteGenerationUndo({ entryId: richNoteEntry.id, before: previousBody })
    }

    ctx.session.setNoteEntry(richNoteEntry)
    ctx.session.setNoteBody(nextBody)
    // While the recovery choice is unresolved, comparing the generated editor
    // body with the authored value keeps save-state and close protection
    // truthful. Discard installs the generated value as the saved baseline;
    // save persists the authored value.
    ctx.session.savedBodyRef.current = hasDirtyAuthoredBody ? authoredSerialized : generatedSerialized

    // The backend already persisted the generated Note. Only write again when
    // frontend image preservation actually changed that canonical document.
    if (hasDirtyAuthoredBody || generatedSerialized === nextSerialized) return
    void ctx.saveNoteBody(nextBody, {
      manageBusy: false,
      entryId: richNoteEntry.id,
      sessionId: richNoteEntry.sessionId,
      expectedCurrentBody: nextSerialized,
      allowRecoveryWrite: true,
    })
  }

  async function handleUndoLatestNoteGeneration() {
    if (!ctx.latestNoteGenerationUndoRef.current || ctx.session.noteEntry?.id !== ctx.latestNoteGenerationUndoRef.current.entryId) return
    const undo = ctx.latestNoteGenerationUndoRef.current
    if (undo.pendingRecoveryDecision) {
      const authoredUndo = { ...undo, pendingRecoveryChoice: 'authored' as const }
      ctx.latestNoteGenerationUndoRef.current = authoredUndo
      ctx.generation.setLatestNoteGenerationUndo(authoredUndo)
      const saved = await ctx.saveNoteNow()
      if (saved && ctx.latestNoteGenerationUndoRef.current !== authoredUndo) {
        ctx.feedback.setNotice('Generation undone')
      }
      return
    }
    try {
      ctx.feedback.setBusyAction('undo-generation')
      ctx.feedback.setError(null)
      ctx.generation.setLatestNoteGenerationUndo(null)
      ctx.session.setNoteBody(undo.before)
      const saved = await ctx.saveNoteBody(undo.before, {
        manageBusy: false,
        entryId: undo.entryId,
        sessionId: ctx.session.noteEntry.sessionId,
        expectedCurrentBody: serializeRichEditorDocument(undo.before),
      })
      if (!saved) {
        ctx.generation.setLatestNoteGenerationUndo(undo)
        return
      }
      if (serializeRichEditorDocument(ctx.session.noteBodyRef.current) !== serializeRichEditorDocument(undo.before)) return
      ctx.feedback.setNotice('Generation undone')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
      ctx.generation.setLatestNoteGenerationUndo(undo)
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  function applyGenerationEvent(event: GenerationJobEvent) {
    storeGenerationStatus(event.status)

    if (event.type === 'progress') {
      ctx.feedback.setNotice(event.message)
      return
    }

    if (event.type === 'partial') {
      ctx.feedback.setNotice(event.status.progressMessage || 'Generating')
      return
    }

    if (event.type === 'started') {
      ctx.feedback.setNotice(event.status.progressMessage || 'Generation started')
      return
    }

    if (event.type === 'cancelled') {
      ctx.feedback.setNotice('Generation cancelled')
      return
    }

    if (event.type === 'failed') {
      ctx.feedback.setError(event.error_message)
      return
    }

    const { result } = event
    if (result.draft && ctx.session.activeSessionIdRef.current === result.draft.sessionId) {
      const draftDocument = richEditorDocumentFromStoredBody(result.draft)
      const storedBody = richEditorDocumentToStoredBody(draftDocument)
      const richDraft = { ...result.draft, ...storedBody }
      mergeDraft(richDraft)
      void ctx.canonicalizeGeneratedDraft(richDraft)
      ctx.navigation.setActiveView('testware')
      ctx.feedback.setNotice('Testware generated')
    } else if (result.finding && ctx.session.activeSessionIdRef.current === result.finding.sessionId) {
      const findingDocument = richEditorDocumentFromStoredBody(result.finding)
      const storedBody = richEditorDocumentToStoredBody(findingDocument)
      const richFinding = { ...result.finding, ...storedBody }
      mergeFinding(richFinding)
      void ctx.canonicalizeGeneratedFinding(richFinding)
      ctx.navigation.setActiveView('findings')
      ctx.feedback.setNotice('Finding created')
    } else if (result.noteEntry && ctx.session.noteEntryIdRef.current === result.noteEntry.id) {
      applyGeneratedNoteEntry(result.noteEntry)
    } else {
      ctx.feedback.setNotice(result.aiRun.errorMessage ?? 'AI action finished')
    }
  }

  async function handleAiAction(action: GenerateAiActionKind, testwarePreferences?: TestwareGenerationPreferences) {
    if (!ctx.session.activeSession || !ctx.session.noteEntry) return
    const busy = action === 'testware' ? 'ai-testware' : action === 'finding' ? 'ai-finding' : 'ai-summary'
    try {
      ctx.feedback.setBusyAction(busy)
      ctx.feedback.setError(null)
      ctx.generation.setLatestNoteGenerationUndo(null)
      const saved = await ctx.saveNoteNow({ manageBusy: false })
      if (!saved) return
      const started = await startAiActionJob(
        {
          sessionId: ctx.session.activeSession.id,
          provider: ctx.selection.selectedProvider,
          model: ctx.selection.selectedModel.trim() || 'default',
          reasoningEffort: ctx.selection.selectedReasoningEffort,
          action,
          noteEntryId: ctx.session.noteEntry.id,
          testwarePreferences: action === 'testware' ? testwarePreferences ?? null : null,
        },
        applyGenerationEvent,
      )
      storeGenerationStatus(started.status)
      if (action === 'testware') {
        ctx.navigation.setActiveView('testware')
        ctx.feedback.setNotice('Generating testware')
      } else if (action === 'finding') {
        ctx.feedback.setNotice('Generating finding')
      } else {
        ctx.feedback.setNotice('Summarizing note')
      }
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    } finally {
      ctx.feedback.setBusyAction(null)
    }
  }

  async function handleCancelGenerationJob(jobId: string) {
    try {
      ctx.feedback.setError(null)
      const status = await cancelAiActionJob(jobId)
      storeGenerationStatus(status)
      ctx.feedback.setNotice('Cancelling generation')
    } catch (cause) {
      ctx.feedback.setError(formatError(cause))
    }
  }

  return { captureActiveJobs, handleAiAction, handleCancelGenerationJob, handleUndoLatestNoteGeneration, reconcileActiveJobs, storeGenerationStatus }
}

export function useGenerationActions(ctx: GenerationActionsContext) {
  return useStableCapability(ctx, createGenerationActions)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
