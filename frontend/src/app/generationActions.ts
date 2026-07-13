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
import type { AiSelection, GenerationWorkspace, RecordWorkspace, SessionWorkspace, WorkflowFeedback, WorkflowNavigation } from './types'
import { useStableCapability } from './useStableCapability'

export function generationIsActive(job: GenerationJobStatus): boolean {
  return job.state === 'starting' || job.state === 'running' || job.state === 'cancelling'
}

// How often boot-time reconciliation re-polls a recovered job's status. The
// original invoke `Channel` is gone after a webview reload, so we cannot
// re-subscribe to the streaming events; polling `get_ai_action_job_status` is
// the simplest way to drive the recovered job to a terminal UI state.
const RECONCILE_POLL_INTERVAL_MS = 1000

export type GenerationActionsContext = {
  session: Pick<
    SessionWorkspace,
    | 'activeSession'
    | 'activeSessionIdRef'
    | 'noteBodyRef'
    | 'noteBodyWriteVersionRef'
    | 'noteEntry'
    | 'noteEntryIdRef'
    | 'savedBodyRef'
    | 'setNoteBody'
    | 'setNoteEntry'
  >
  records: Pick<
    RecordWorkspace,
    | 'dirtyDraftIdsRef'
    | 'dirtyFindingIdsRef'
    | 'draftsRef'
    | 'findingsRef'
    | 'setDrafts'
    | 'setFindings'
    | 'setFindingCount'
    | 'setTestwareDraftCount'
  >
  generation: GenerationWorkspace
  selection: AiSelection
  feedback: WorkflowFeedback
  navigation: WorkflowNavigation
  saveNoteNow: (options?: { manageBusy?: boolean }) => Promise<boolean>
}

export function createGenerationActions(ctx: GenerationActionsContext) {
  function storeGenerationStatus(status: GenerationJobStatus) {
    ctx.generation.setGenerationJobs((previous) => ({ ...previous, [status.jobId]: status }))
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
      ctx.feedback.setError(formatError(cause))
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
        if (status.state === 'failed' && status.errorMessage) ctx.feedback.setError(status.errorMessage)
        else if (status.state === 'cancelled') ctx.feedback.setNotice('Generation cancelled')
        else if (status.state === 'completed') ctx.feedback.setNotice('Generation finished')
        return
      }
    }
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
    const storedBody = richEditorDocumentToStoredBody(nextBody)
    const richNoteEntry = { ...generatedEntry, ...storedBody }
    const writeVersion = ++ctx.session.noteBodyWriteVersionRef.current

    ctx.generation.setLatestNoteGenerationUndo({ entryId: richNoteEntry.id, before: previousBody })
    ctx.session.setNoteEntry(richNoteEntry)
    ctx.session.setNoteBody(nextBody)
    ctx.session.savedBodyRef.current = serializeRichEditorDocument(nextBody)
    void updateEntry(richNoteEntry.id, storedBody)
      .then((saved) => {
        if (writeVersion !== ctx.session.noteBodyWriteVersionRef.current) return
        ctx.session.setNoteEntry(saved)
        ctx.session.savedBodyRef.current = serializeRichEditorDocument(richEditorDocumentFromStoredBody(saved))
      })
      .catch((cause) => {
        if (writeVersion === ctx.session.noteBodyWriteVersionRef.current) ctx.feedback.setError(formatError(cause))
      })
    ctx.feedback.setNotice('Note summarized')
  }

  async function handleUndoLatestNoteGeneration() {
    if (!ctx.generation.latestNoteGenerationUndo || ctx.session.noteEntry?.id !== ctx.generation.latestNoteGenerationUndo.entryId) return
    const undo = ctx.generation.latestNoteGenerationUndo
    const storedBody = richEditorDocumentToStoredBody(undo.before)
    const writeVersion = ++ctx.session.noteBodyWriteVersionRef.current

    try {
      ctx.feedback.setBusyAction('undo-generation')
      ctx.feedback.setError(null)
      ctx.generation.setLatestNoteGenerationUndo(null)
      ctx.session.setNoteBody(undo.before)
      const saved = await updateEntry(undo.entryId, storedBody)
      if (writeVersion !== ctx.session.noteBodyWriteVersionRef.current) return
      ctx.session.setNoteEntry(saved)
      ctx.session.savedBodyRef.current = serializeRichEditorDocument(richEditorDocumentFromStoredBody(saved))
      ctx.feedback.setNotice('Generation undone')
    } catch (cause) {
      if (writeVersion !== ctx.session.noteBodyWriteVersionRef.current) return
      ctx.feedback.setError(formatError(cause))
      ctx.generation.setLatestNoteGenerationUndo(undo)
    } finally {
      if (writeVersion === ctx.session.noteBodyWriteVersionRef.current) ctx.feedback.setBusyAction(null)
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
      void updateDraft(richDraft.id, storedBody)
        .then((saved) => {
          if (ctx.session.activeSessionIdRef.current === saved.sessionId) mergeDraft(saved)
        })
        .catch((cause) => {
          if (ctx.session.activeSessionIdRef.current === richDraft.sessionId) ctx.feedback.setError(formatError(cause))
        })
      ctx.navigation.setActiveView('testware')
      ctx.feedback.setNotice('Testware generated')
    } else if (result.finding && ctx.session.activeSessionIdRef.current === result.finding.sessionId) {
      const findingDocument = richEditorDocumentFromStoredBody(result.finding)
      const storedBody = richEditorDocumentToStoredBody(findingDocument)
      const richFinding = { ...result.finding, ...storedBody }
      mergeFinding(richFinding)
      void updateFinding(richFinding.id, storedBody)
        .then((saved) => {
          if (ctx.session.activeSessionIdRef.current === saved.sessionId) mergeFinding(saved)
        })
        .catch((cause) => {
          if (ctx.session.activeSessionIdRef.current === richFinding.sessionId) ctx.feedback.setError(formatError(cause))
        })
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

  return { handleAiAction, handleCancelGenerationJob, handleUndoLatestNoteGeneration, reconcileActiveJobs, storeGenerationStatus }
}

export function useGenerationActions(ctx: GenerationActionsContext) {
  return useStableCapability(ctx, createGenerationActions)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
