import { createCreationSourceActions } from './creationSourceActions'
import type { GenerationJobStatus, TestwareGenerationPreferences } from '../tauri'
import type { AiSelection } from './types'
import { useState } from 'react'
import { abortCreationSave, commitCreationSave, prepareCreationSave, readClipboardImageDataUrl, type CreatedRecord, type CreationKind, type CreationOutcome } from '../tauri'
import { cloneRichEditorDocument, serializeRichEditorDocument } from '../editor/editorDocument'
import { pastedImageFilename, readFileAsDataUrl } from '../editor/editorHtml'
import { richEditorImageInserterForId, type RichEditorImageUpload } from '../editor/richEditorRegistry'
import { formatError } from '../ui/format'
import { creationIsAuthored, creationStarter, type CreationAttempt, type CreationContent, type CreationImageOperation, type CreationIntent } from './creationIntent'
import { creationImageInputs, materializeCreationDocument } from './creationImages'
import { useStableCapability } from './useStableCapability'

export type CreationSelection = 'selected' | 'deleted' | 'stale'

export type CreationContext = {
  activeSessionId: () => string | null
  sourceAllowed?: () => boolean
  noteId?: () => string | null
  navigationIsCurrent?: (epoch: number) => boolean
  publishJob?: (status: GenerationJobStatus) => void
  beginNavigation: () => number
  openDestination: (kind: CreationKind) => void
  selectSaved: (intent: CreationIntent, record: CreatedRecord) => Promise<CreationSelection>
  changed: (intent: CreationIntent | null) => void
  decisionChanged: (open: boolean) => void
  notice?: (message: string) => void
  error: (message: string | null) => void
}

export function createCreationActions(ctx: CreationContext) {
  let intent: CreationIntent | null = null
  const staging = new Set<Promise<void>>()
  let selectionInFlight: Promise<boolean> | null = null
  let saveInFlight: Promise<boolean> | null = null
  let discardInFlight: Promise<boolean> | null = null
  let decision: { promise: Promise<boolean>; resolve: (result: boolean) => void } | null = null
  function publish(next: CreationIntent | null) { intent = next; ctx.changed(next) }
  function matches(captured: CreationIntent) {
    return intent?.id === captured.id && intent.epoch === captured.epoch && ctx.activeSessionId() === captured.sessionId
  }
  function ownsGeneration(jobId: string) {
    const phase = intent?.phase
    return (phase?.state === 'generating' || phase?.state === 'cancelling') && phase.jobId === jobId
  }
  function markSelectionReady(intentId: string, recordId: string) {
    if (!intent || intent.id !== intentId || intent.phase.state !== 'saved' || intent.phase.record.record.id !== recordId) return false
    publish({ ...intent, phase: { ...intent.phase, selection: 'ready' } })
    return true
  }
  function update(patch: Partial<CreationContent>) {
    if (intent?.phase.state !== 'editing') return
    publish({ ...intent, ...patch })
  }
  async function open(kind: CreationKind, isCurrent: () => boolean = () => true, expandAi = false) {
    if (!await settle() || !isCurrent()) return
    const sessionId = ctx.activeSessionId()
    if (!sessionId) return
    const epoch = ctx.beginNavigation()
    publish({ id: crypto.randomUUID(), sessionId, epoch, kind, title: '', document: creationStarter(kind), metadataJson: null, findingKind: 'bug', imageOperations: {}, source: null, sourceNoteId: ctx.noteId?.() ?? null, setup: expandAi ? 'ai' : null, phase: { state: 'editing' } })
    ctx.error(null)
    ctx.openDestination(kind)
    void source.reviewSource()
  }
  function updateImageOperation(captured: CreationIntent, id: string, operation: CreationImageOperation | null) {
    if (!matches(captured) || !intent) return
    const imageOperations = { ...intent.imageOperations }
    if (operation) imageOperations[id] = operation
    else delete imageOperations[id]
    publish({ ...intent, imageOperations })
  }
  function dismissImageFailures() {
    if (intent?.phase.state !== 'editing') return
    publish({ ...intent, imageOperations: Object.fromEntries(Object.entries(intent.imageOperations).filter(([, operation]) => operation.state === 'reading')) })
    ctx.error(null)
  }
  function imagesReady() {
    if (!intent || !Object.keys(intent.imageOperations).length) return true
    ctx.error('Finish adding images or continue without failed images before saving or generating.')
    return false
  }
  function stageLocalImage(input: Pick<RichEditorImageUpload, 'editorId' | 'insertImage'>, read: () => Promise<string | null>, filename: string): Promise<void> {
    const captured = intent
    if (!captured || captured.phase.state !== 'editing') return Promise.resolve()
    const operationId = crypto.randomUUID()
    updateImageOperation(captured, operationId, { state: 'reading' })
    const operation = (async () => {
      try {
        const dataUrl = await read()
        if (!matches(captured) || intent?.phase.state !== 'editing' || richEditorImageInserterForId(input.editorId) !== input.insertImage) return
        if (!dataUrl) throw new Error('Clipboard image could not be read.')
        if (!input.insertImage(null, filename, dataUrl)) throw new Error('The image could not be added to this editor.')
        updateImageOperation(captured, operationId, null)
      } catch (cause) {
        if (matches(captured)) {
          const message = formatError(cause)
          updateImageOperation(captured, operationId, { state: 'failed', message })
          ctx.error(message)
        }
      }
    })().finally(() => staging.delete(operation))
    staging.add(operation)
    return operation
  }
  function stageImage(input: RichEditorImageUpload): Promise<void> {
    if (input.file.size > 25 * 1024 * 1024) { ctx.error('Image exceeds the 25 MiB limit.'); return Promise.resolve() }
    return stageLocalImage(input, () => readFileAsDataUrl(input.file), pastedImageFilename(input.file))
  }
  function pasteImage(input: Pick<RichEditorImageUpload, 'editorId' | 'insertImage'>) {
    return stageLocalImage(input, readClipboardImageDataUrl, 'pasted-image.png')
  }
  async function withSettledImages(action: () => Promise<boolean>) {
    const captured = intent
    if (!captured) return false
    const document = serializeRichEditorDocument(captured.document)
    await Promise.all(staging)
    if (!matches(captured) || !intent || serializeRichEditorDocument(intent.document) !== document) {
      ctx.error('Images finished loading. Review the draft and confirm again.')
      return false
    }
    return imagesReady() ? action() : false
  }
  async function acceptOutcome(captured: CreationIntent, outcome: CreationOutcome): Promise<boolean> {
    if (!matches(captured)) return false
    if (outcome.state === 'committed') {
      if (selectionInFlight) return selectionInFlight
      publish({ ...intent!, phase: { state: 'saved', record: outcome.record, selection: 'loading' } })
      selectionInFlight = ctx.selectSaved(captured, outcome.record).then((selected) => {
        if (!matches(captured) || selected === 'stale') return false
        if (selected === 'deleted') {
          publish({ ...intent!, phase: { state: 'committed-deleted', recordId: outcome.record.record.id } })
          ctx.error('The saved result was deleted before it could be opened. It will not be recreated.')
          return false
        }
        publish(null)
        ctx.notice?.(captured.kind === 'finding' ? 'Finding saved' : 'Test cases saved')
        finishDecision(true)
        return true
      }).catch((cause: unknown) => {
        if (matches(captured)) ctx.error(`The result is saved, but could not be opened. Retry Open saved result. ${formatError(cause)}`)
        return false
      }).finally(() => { selectionInFlight = null })
      return selectionInFlight
    }
    if (outcome.state === 'committedDeleted') {
      publish({ ...intent!, phase: { state: 'committed-deleted', recordId: outcome.recordId } })
      ctx.error('This Save committed, but its record was deleted. It will not be recreated. Cancel to close this draft.')
      return false
    }
    if (outcome.state === 'aborted') publish({ ...intent!, phase: { state: 'editing' } })
    return false
  }
  function save(): Promise<boolean> {
    if (saveInFlight) return saveInFlight
    saveInFlight = saveNow().finally(() => { saveInFlight = null })
    return saveInFlight
  }
  async function saveNow(): Promise<boolean> {
    await Promise.all(staging)
    const captured = intent
    if (!captured) return true
    if (!imagesReady()) return false
    if (captured.phase.state === 'generating' || captured.phase.state === 'cancelling') return false
    if (captured.phase.state === 'saved') return acceptOutcome(captured, { state: 'committed', record: captured.phase.record })
    if (!['editing', 'uncertain'].includes(captured.phase.state)) return false
    if (!captured.title.trim()) { ctx.error('A title is required before saving.'); return false }
    let preparationMayExist = captured.phase.state === 'uncertain'
    let attempt: CreationAttempt | null = captured.phase.state === 'uncertain' ? captured.phase.attempt : null
    try {
      ctx.error(null)
      const snapshot: CreationContent = { title: captured.title, document: cloneRichEditorDocument(captured.document), metadataJson: captured.metadataJson, findingKind: captured.findingKind }
      if (!attempt) {
        const attemptId = crypto.randomUUID()
        attempt = { preparation: { attemptId, sessionId: captured.sessionId, kind: captured.kind, images: [] }, snapshot, payload: null }
        publish({ ...captured, phase: { state: 'saving', attempt } })
        const images = await creationImageInputs(snapshot.document)
        attempt.preparation.images = images.descriptors
      } else publish({ ...captured, phase: { state: 'saving', attempt } })
      preparationMayExist = true
      const prepared = await prepareCreationSave(attempt.preparation)
      if (!matches(captured)) return false
      if (prepared.outcome.state !== 'preparing') return acceptOutcome(captured, prepared.outcome)
      if (!attempt.payload) {
        const images = await creationImageInputs(attempt.snapshot.document)
        const body = materializeCreationDocument(attempt.snapshot.document, images.inputs, prepared.images)
        attempt.payload = { attemptId: attempt.preparation.attemptId, record: captured.kind === 'finding'
          ? { kind: 'finding', title: attempt.snapshot.title, ...body, metadataJson: attempt.snapshot.metadataJson, findingKind: attempt.snapshot.findingKind }
          : { kind: 'testware', title: attempt.snapshot.title, ...body, metadataJson: attempt.snapshot.metadataJson }, images: images.inputs, sharedAttachmentIds: images.shared }
      }
      return await acceptOutcome(captured, await commitCreationSave(attempt.payload))
    } catch (cause) {
      if (!matches(captured)) return false
      ctx.error(formatError(cause))
      if (!attempt || !preparationMayExist) { publish({ ...captured, phase: { state: 'editing' } }); return false }
      publish({ ...captured, phase: { state: 'uncertain', attempt } })
      try {
        const outcome = await abortCreationSave(attempt.preparation.attemptId)
        if (outcome.state === 'committed' || outcome.state === 'committedDeleted') return await acceptOutcome(captured, outcome)
        if (outcome.state === 'aborted' && matches(captured)) publish({ ...captured, phase: { state: 'editing' } })
      } catch { return false }
      return false
    }
  }
  function discard(): Promise<boolean> {
    if (discardInFlight) return discardInFlight
    discardInFlight = discardNow().finally(() => { discardInFlight = null })
    return discardInFlight
  }
  async function discardNow(): Promise<boolean> {
    if (saveInFlight) await saveInFlight
    if (selectionInFlight) await selectionInFlight
    const captured = intent
    if (!captured) return true
    if (captured.phase.state === 'generating' || captured.phase.state === 'cancelling') return false
    if (captured.phase.state === 'saved') return acceptOutcome(captured, { state: 'committed', record: captured.phase.record })
    const attempt = captured.phase.state === 'uncertain' || captured.phase.state === 'saving' ? captured.phase.attempt : null
    publish({ ...captured, phase: { state: 'discarding', attempt } })
    await Promise.all(staging)
    if (attempt) {
      try {
        const outcome = await abortCreationSave(attempt.preparation.attemptId)
        if (outcome.state === 'committed' || outcome.state === 'committedDeleted') return acceptOutcome(captured, outcome)
        if (outcome.state !== 'aborted') {
          if (matches(captured)) publish(captured)
          ctx.error('Owned image cleanup is retained. Retry discard before leaving.')
          return false
        }
      } catch (cause) {
        if (matches(captured)) publish(captured)
        ctx.error(`Could not settle this draft. ${formatError(cause)}`)
        return false
      }
    }
    if (!matches(captured)) return false
    publish({ ...captured, phase: { state: 'discarded' } })
    publish(null)
    return true
  }
  async function settle(): Promise<boolean> {
    if (discardInFlight) await discardInFlight
    if (saveInFlight) await saveInFlight
    if (selectionInFlight) await selectionInFlight
    if (!intent) return true
    if (intent.phase.state === 'committed-deleted') return discard()
    if (intent.phase.state === 'editing' && !creationIsAuthored(intent)) return discard()
    if (decision) return decision.promise
    let resolve!: (result: boolean) => void
    const promise = new Promise<boolean>((finish) => { resolve = finish })
    decision = { promise, resolve }
    ctx.decisionChanged(true)
    return promise
  }
  function finishDecision(result: boolean) {
    if (!decision) return
    const pending = decision
    decision = null
    ctx.decisionChanged(false)
    pending.resolve(result)
  }
  async function decide(choice: 'save' | 'discard' | 'keep') {
    if (choice === 'keep') { if (intent?.phase.state !== 'discarding') finishDecision(false); return }
    const settled = choice === 'save' ? await save() : await discard()
    if (settled) finishDecision(true)
  }
  const source = createCreationSourceActions({
    current: () => intent, publish, matches, acceptOutcome, sourceAllowed: () => ctx.sourceAllowed?.() ?? true,
    beginNavigation: () => ctx.beginNavigation(), navigationIsCurrent: (epoch) => ctx.navigationIsCurrent?.(epoch) ?? true,
    error: (message) => ctx.error(message), notice: (message) => ctx.notice?.(message), publishJob: (status) => ctx.publishJob?.(status), finished: () => finishDecision(true),
  })
  return { ...source, generate: (selection: AiSelection, preferences?: TestwareGenerationPreferences) => withSettledImages(() => source.generate(selection, preferences)),
    prefill: () => withSettledImages(source.prefill), pasteImage, dismissImageFailures, ownsGeneration, markSelectionReady, open, update, save, discard, settle, decide, stageImage, current: () => intent,
    hasPendingChanges: () => Boolean(intent), isSaving: () => Boolean(saveInFlight || discardInFlight || selectionInFlight) }
}

export type CreationActions = ReturnType<typeof createCreationActions>
export function useCreationActions(ctx: Omit<CreationContext, 'changed' | 'decisionChanged'>) {
  const [creationIntent, setCreationIntent] = useState<CreationIntent | null>(null)
  const [creationDecision, setCreationDecision] = useState(false)
  const creation = useStableCapability({ ...ctx, changed: setCreationIntent, decisionChanged: setCreationDecision }, createCreationActions)
  return { creation, creationIntent, creationDecision }
}
