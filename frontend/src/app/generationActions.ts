import {
  cancelAiActionJob,
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

export function createGenerationActions(ctx: AppWorkflowContext, saveNoteNow: () => Promise<boolean>) {
  function storeGenerationStatus(status: GenerationJobStatus) {
    ctx.setGenerationJobs((previous) => ({ ...previous, [status.jobId]: status }))
  }

  function mergeDraft(draft: Draft) {
    ctx.setDrafts((previous) => {
      const exists = previous.some((item) => item.id === draft.id)
      if (exists) return previous.map((item) => (item.id === draft.id ? draft : item))
      return [draft, ...previous]
    })
  }

  function mergeFinding(finding: Finding) {
    ctx.setFindings((previous) => {
      const exists = previous.some((item) => item.id === finding.id)
      if (exists) return previous.map((item) => (item.id === finding.id ? finding : item))
      return [finding, ...previous]
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
      ctx.savedBodyRef.current = serializeRichEditorDocument(undo.before)
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
      ctx.setError(event.errorMessage)
      return
    }

    const { result } = event
    if (result.draft && ctx.activeSessionIdRef.current === result.draft.sessionId) {
      const draftDocument = richEditorDocumentFromStoredBody(result.draft)
      const storedBody = richEditorDocumentToStoredBody(draftDocument)
      const richDraft = { ...result.draft, ...storedBody }
      mergeDraft(richDraft)
      void updateDraft(richDraft.id, storedBody)
        .then(mergeDraft)
        .catch((cause) => ctx.setError(formatError(cause)))
      ctx.setActiveView('testware')
      ctx.setNotice('Testware generated')
    } else if (result.finding && ctx.activeSessionIdRef.current === result.finding.sessionId) {
      const findingDocument = richEditorDocumentFromStoredBody(result.finding)
      const storedBody = richEditorDocumentToStoredBody(findingDocument)
      const richFinding = { ...result.finding, ...storedBody }
      mergeFinding(richFinding)
      void updateFinding(richFinding.id, storedBody)
        .then(mergeFinding)
        .catch((cause) => ctx.setError(formatError(cause)))
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
      const saved = await saveNoteNow()
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

  return { handleAiAction, handleCancelGenerationJob, handleUndoLatestNoteGeneration, storeGenerationStatus }
}
