import { useEffect } from 'react'
import {
  cancelAiActionJob,
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
import type { AiSelection } from './types'
import type { GenerationActionsContext } from './generationActions.types'
import { useStableCapability } from './useStableCapability'
import { createGenerationRecovery } from './generationActions.recovery'
export { generationIsActive } from './generationActions.recovery'

export type { GenerationActionsContext } from './generationActions.types'

export function createGenerationActions(ctx: GenerationActionsContext) {
  const recovery = createGenerationRecovery(ctx, storeGenerationStatus, applyRecoveredGeneratedNoteEntry)

  function storeGenerationStatus(status: GenerationJobStatus) {
    ctx.generation.setGenerationJobs((previous) => ({ ...previous, [status.jobId]: status }))
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
    if (!ctx.noteEligibility.canAdoptSummary(generatedEntry.sessionId)) return
    const previousBody = ctx.session.noteBodyRef.current
    const generatedBody = richEditorDocumentFromStoredBody(generatedEntry)
    const nextBody = preserveManagedImageNodes(previousBody, generatedBody)
    const generatedSerialized = serializeRichEditorDocument(generatedBody)
    const nextSerialized = serializeRichEditorDocument(nextBody)
    const storedBody = richEditorDocumentToStoredBody(nextBody)
    const richNoteEntry = { ...generatedEntry, ...storedBody }
    ctx.adoptCanonicalNoteBody(generatedBody, richNoteEntry.id, richNoteEntry.sessionId)
    ctx.generation.setLatestNoteGenerationUndo({ kind: 'undo', entryId: richNoteEntry.id, before: previousBody })
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
    if (!ctx.noteEligibility.canAdoptSummary(generatedEntry.sessionId)) return
    const previousBody = ctx.session.noteBodyRef.current
    const priorRecoveryDecision = ctx.latestNoteGenerationUndoRef.current?.kind === 'recovery-choice'
      && ctx.latestNoteGenerationUndoRef.current.entryId === generatedEntry.id
      ? ctx.latestNoteGenerationUndoRef.current
      : null
    const authoredBody = priorRecoveryDecision?.choice === 'generated'
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
        kind: 'recovery-choice',
        choice: 'unselected',
        generated: nextBody,
        generatedCanonical: generatedBody,
      })
    } else if (previousSerialized !== nextSerialized) {
      ctx.generation.setLatestNoteGenerationUndo({ kind: 'undo', entryId: richNoteEntry.id, before: previousBody })
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
    if (ctx.session.noteEntry && !ctx.noteEligibility.canWrite(ctx.session.noteEntry.sessionId, 'recovery')) return
    if (!ctx.latestNoteGenerationUndoRef.current || ctx.session.noteEntry?.id !== ctx.latestNoteGenerationUndoRef.current.entryId) return
    const undo = ctx.latestNoteGenerationUndoRef.current
    if (undo.kind === 'recovery-choice') {
      const authoredUndo = { ...undo, choice: 'authored' as const }
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

  async function handleAiAction(action: GenerateAiActionKind, testwarePreferences?: TestwareGenerationPreferences, displayedSelection?: AiSelection) {
    const selection = { ...(displayedSelection ?? ctx.selection) }
    if (ctx.selection.modelWritePending?.()) {
      ctx.feedback.setError('Wait for the model preference to finish saving, then try again.')
      return
    }
    if (!ctx.session.activeSession || !ctx.session.noteEntry) return
    const busy = action === 'testware' ? 'ai-testware' : action === 'finding' ? 'ai-finding' : 'ai-summary'
    try {
      ctx.feedback.setBusyAction(busy)
      ctx.feedback.setError(null)
      ctx.generation.setLatestNoteGenerationUndo(null)
      const saved = await ctx.saveNoteNow({ manageBusy: false })
      if (!saved) return
      if (ctx.selection.modelWritePending?.()) {
        ctx.feedback.setError('Wait for the model preference to finish saving, then try again.')
        return
      }
      const started = await startAiActionJob(
        {
          sessionId: ctx.session.activeSession.id,
          provider: selection.selectedProvider,
          model: selection.selectedModel.trim() || 'default',
          reasoningEffort: selection.selectedReasoningEffort,
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

  return { ...recovery, handleAiAction, handleCancelGenerationJob, handleUndoLatestNoteGeneration, storeGenerationStatus }
}

export function useGenerationActions(ctx: GenerationActionsContext) {
  const actions = useStableCapability(ctx, createGenerationActions)
  useEffect(() => {
    actions.activate()
    return actions.dispose
  }, [actions])
  return actions
}
