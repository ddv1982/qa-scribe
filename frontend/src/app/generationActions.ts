import {
  cancelAiActionJob,
  getAiActionJobStatus,
  listActiveAiActionJobs,
  startAiActionJob,
  updateDraft,
  updateEntry,
  updateFinding,
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
import type { AppWorkflowContext } from './types'

export function generationIsActive(job: GenerationJobStatus): boolean {
  return job.state === 'starting' || job.state === 'running' || job.state === 'cancelling'
}

// How often boot-time reconciliation re-polls a recovered job's status. The
// original invoke `Channel` is gone after a webview reload, so we cannot
// re-subscribe to the streaming events; polling `get_ai_action_job_status` is
// the simplest way to drive the recovered job to a terminal UI state.
const RECONCILE_POLL_INTERVAL_MS = 1000

export function createGenerationActions(ctx: AppWorkflowContext, saveNoteNow: (options?: { manageBusy?: boolean }) => Promise<boolean>) {
  function storeGenerationStatus(status: GenerationJobStatus) {
    ctx.setGenerationJobs((previous) => ({ ...previous, [status.jobId]: status }))
  }

  // Backend jobs keep running when the webview reloads, but the frontend loses
  // its job map and the streaming `Channel`. On boot we ask the backend which
  // jobs are still active, restore their busy/pending UI state, and poll each to
  // completion so the spinner/cancel affordance and the terminal notice recover.
  // The generated artifact itself was already persisted by the backend worker;
  // reopening the session surfaces it, so reconciliation only owns the UI state.
  async function reconcileActiveJobs() {
    let active: GenerationJobStatus[]
    try {
      active = await listActiveAiActionJobs()
    } catch (cause) {
      // A reconciliation failure must never block boot; surface it quietly.
      ctx.setError(formatError(cause))
      return
    }
    for (const status of active) {
      storeGenerationStatus(status)
      void pollJobToTerminal(status.jobId)
    }
  }

  async function pollJobToTerminal(jobId: string) {
    // Loop until the job reports a terminal state (or vanishes from the store,
    // which also counts as terminal). Errors surface once and stop the poll.
    for (;;) {
      await delay(RECONCILE_POLL_INTERVAL_MS)
      let status: GenerationJobStatus
      try {
        status = await getAiActionJobStatus(jobId)
      } catch {
        // The job left the store (pruned/unknown); nothing more to reconcile.
        return
      }
      storeGenerationStatus(status)
      if (!generationIsActive(status)) {
        if (status.state === 'failed' && status.errorMessage) ctx.setError(status.errorMessage)
        else if (status.state === 'cancelled') ctx.setNotice('Generation cancelled')
        else if (status.state === 'completed') ctx.setNotice('Generation finished')
        return
      }
    }
  }

  function mergeDraft(draft: Draft) {
    ctx.setDrafts((previous) => {
      const exists = previous.some((item) => item.id === draft.id)
      if (!exists && draft.kind === 'testware') ctx.setTestwareDraftCount((count) => count + 1)
      const nextDrafts = exists
        ? previous.map((item) => (item.id === draft.id && !ctx.dirtyDraftIdsRef.current.has(item.id) ? draft : item))
        : [draft, ...previous]
      ctx.draftsRef.current = nextDrafts
      return nextDrafts
    })
  }

  function mergeFinding(finding: Finding) {
    ctx.setFindings((previous) => {
      const exists = previous.some((item) => item.id === finding.id)
      if (!exists) ctx.setFindingCount((count) => count + 1)
      const nextFindings = exists
        ? previous.map((item) => (item.id === finding.id && !ctx.dirtyFindingIdsRef.current.has(item.id) ? finding : item))
        : [finding, ...previous]
      ctx.findingsRef.current = nextFindings
      return nextFindings
    })
  }

  function applyGeneratedNoteEntry(generatedEntry: Entry) {
    const previousBody = ctx.noteBodyRef.current
    const generatedBody = richEditorDocumentFromStoredBody(generatedEntry)
    const nextBody = preserveManagedImageNodes(previousBody, generatedBody)
    const storedBody = richEditorDocumentToStoredBody(nextBody)
    const richNoteEntry = { ...generatedEntry, ...storedBody }
    const writeVersion = ++ctx.noteBodyWriteVersionRef.current

    ctx.setLatestNoteGenerationUndo({ entryId: richNoteEntry.id, before: previousBody })
    ctx.setNoteEntry(richNoteEntry)
    ctx.setNoteBody(nextBody)
    ctx.savedBodyRef.current = serializeRichEditorDocument(nextBody)
    void updateEntry(richNoteEntry.id, storedBody)
      .then((saved) => {
        if (writeVersion !== ctx.noteBodyWriteVersionRef.current) return
        ctx.setNoteEntry(saved)
        ctx.savedBodyRef.current = serializeRichEditorDocument(richEditorDocumentFromStoredBody(saved))
      })
      .catch((cause) => {
        if (writeVersion === ctx.noteBodyWriteVersionRef.current) ctx.setError(formatError(cause))
      })
    ctx.setNotice('Note summarized')
  }

  async function handleUndoLatestNoteGeneration() {
    if (!ctx.latestNoteGenerationUndo || ctx.noteEntry?.id !== ctx.latestNoteGenerationUndo.entryId) return
    const undo = ctx.latestNoteGenerationUndo
    const storedBody = richEditorDocumentToStoredBody(undo.before)
    const writeVersion = ++ctx.noteBodyWriteVersionRef.current

    try {
      ctx.setBusyAction('undo-generation')
      ctx.setError(null)
      ctx.setLatestNoteGenerationUndo(null)
      ctx.setNoteBody(undo.before)
      const saved = await updateEntry(undo.entryId, storedBody)
      if (writeVersion !== ctx.noteBodyWriteVersionRef.current) return
      ctx.setNoteEntry(saved)
      ctx.savedBodyRef.current = serializeRichEditorDocument(richEditorDocumentFromStoredBody(saved))
      ctx.setNotice('Generation undone')
    } catch (cause) {
      if (writeVersion !== ctx.noteBodyWriteVersionRef.current) return
      ctx.setError(formatError(cause))
      ctx.setLatestNoteGenerationUndo(undo)
    } finally {
      if (writeVersion === ctx.noteBodyWriteVersionRef.current) ctx.setBusyAction(null)
    }
  }

  function applyGenerationEvent(event: GenerationJobEvent) {
    storeGenerationStatus(event.status)

    if (event.type === 'progress') {
      ctx.setNotice(event.message)
      return
    }

    if (event.type === 'partial') {
      ctx.setNotice(event.status.progressMessage || 'Generating')
      return
    }

    if (event.type === 'started') {
      ctx.setNotice(event.status.progressMessage || 'Generation started')
      return
    }

    if (event.type === 'cancelled') {
      ctx.setNotice('Generation cancelled')
      return
    }

    if (event.type === 'failed') {
      ctx.setError(event.error_message)
      return
    }

    const { result } = event
    if (result.draft && ctx.activeSessionIdRef.current === result.draft.sessionId) {
      const draftDocument = richEditorDocumentFromStoredBody(result.draft)
      const storedBody = richEditorDocumentToStoredBody(draftDocument)
      const richDraft = { ...result.draft, ...storedBody }
      mergeDraft(richDraft)
      void updateDraft(richDraft.id, storedBody)
        .then((saved) => {
          if (ctx.activeSessionIdRef.current === saved.sessionId) mergeDraft(saved)
        })
        .catch((cause) => {
          if (ctx.activeSessionIdRef.current === richDraft.sessionId) ctx.setError(formatError(cause))
        })
      ctx.setActiveView('testware')
      ctx.setNotice('Testware generated')
    } else if (result.finding && ctx.activeSessionIdRef.current === result.finding.sessionId) {
      const findingDocument = richEditorDocumentFromStoredBody(result.finding)
      const storedBody = richEditorDocumentToStoredBody(findingDocument)
      const richFinding = { ...result.finding, ...storedBody }
      mergeFinding(richFinding)
      void updateFinding(richFinding.id, storedBody)
        .then((saved) => {
          if (ctx.activeSessionIdRef.current === saved.sessionId) mergeFinding(saved)
        })
        .catch((cause) => {
          if (ctx.activeSessionIdRef.current === richFinding.sessionId) ctx.setError(formatError(cause))
        })
      ctx.setActiveView('findings')
      ctx.setNotice('Finding created')
    } else if (result.noteEntry && ctx.noteEntryIdRef.current === result.noteEntry.id) {
      applyGeneratedNoteEntry(result.noteEntry)
    } else {
      ctx.setNotice(result.aiRun.errorMessage ?? 'AI action finished')
    }
  }

  async function handleAiAction(action: GenerateAiActionKind, testwarePreferences?: TestwareGenerationPreferences) {
    if (!ctx.activeSession || !ctx.noteEntry) return
    const busy = action === 'testware' ? 'ai-testware' : action === 'finding' ? 'ai-finding' : 'ai-summary'
    try {
      ctx.setBusyAction(busy)
      ctx.setError(null)
      ctx.setLatestNoteGenerationUndo(null)
      const saved = await saveNoteNow({ manageBusy: false })
      if (!saved) return
      const started = await startAiActionJob(
        {
          sessionId: ctx.activeSession.id,
          provider: ctx.selectedProvider,
          model: ctx.selectedModel.trim() || 'default',
          reasoningEffort: ctx.selectedReasoningEffort,
          action,
          noteEntryId: ctx.noteEntry.id,
          testwarePreferences: action === 'testware' ? testwarePreferences ?? null : null,
        },
        applyGenerationEvent,
      )
      storeGenerationStatus(started.status)
      if (action === 'testware') {
        ctx.setActiveView('testware')
        ctx.setNotice('Generating testware')
      } else if (action === 'finding') {
        ctx.setNotice('Generating finding')
      } else {
        ctx.setNotice('Summarizing note')
      }
    } catch (cause) {
      ctx.setError(formatError(cause))
    } finally {
      ctx.setBusyAction(null)
    }
  }

  async function handleCancelGenerationJob(jobId: string) {
    try {
      ctx.setError(null)
      const status = await cancelAiActionJob(jobId)
      storeGenerationStatus(status)
      ctx.setNotice('Cancelling generation')
    } catch (cause) {
      ctx.setError(formatError(cause))
    }
  }

  return { handleAiAction, handleCancelGenerationJob, handleUndoLatestNoteGeneration, reconcileActiveJobs, storeGenerationStatus }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
