import { useState } from 'react'
import { abortCreationSave, commitCreationSave, prepareCreationSave, type CreatedRecord, type CreationKind, type CreationOutcome } from '../tauri'
import { cloneRichEditorDocument } from '../editor/editorDocument'
import { pastedImageFilename, readFileAsDataUrl } from '../editor/editorHtml'
import { richEditorImageInserterForId, type RichEditorImageUpload } from '../editor/richEditorRegistry'
import { formatError } from '../ui/format'
import { creationIsAuthored, creationStarter, type CreationAttempt, type CreationContent, type CreationIntent } from './creationIntent'
import { creationImageInputs, materializeCreationDocument } from './creationImages'
import { useStableCapability } from './useStableCapability'

export type CreationContext = {
  activeSessionId: () => string | null
  beginNavigation: () => number
  openDestination: (kind: CreationKind) => void
  selectSaved: (intent: CreationIntent, record: CreatedRecord) => Promise<boolean>
  changed: (intent: CreationIntent | null) => void
  decisionChanged: (open: boolean) => void
  error: (message: string | null) => void
}

export function createCreationActions(ctx: CreationContext) {
  let intent: CreationIntent | null = null
  const staging = new Set<Promise<void>>()
  let saveInFlight: Promise<boolean> | null = null
  let discardInFlight: Promise<boolean> | null = null
  let decision: { promise: Promise<boolean>; resolve: (result: boolean) => void } | null = null
  function publish(next: CreationIntent | null) { intent = next; ctx.changed(next) }
  function matches(captured: CreationIntent) {
    return intent?.id === captured.id && intent.epoch === captured.epoch && ctx.activeSessionId() === captured.sessionId
  }
  function update(patch: Partial<CreationContent>) {
    if (intent?.phase.state !== 'editing') return
    publish({ ...intent, ...patch })
  }
  async function open(kind: CreationKind, isCurrent: () => boolean = () => true) {
    if (!await settle() || !isCurrent()) return
    const sessionId = ctx.activeSessionId()
    if (!sessionId) return
    const epoch = ctx.beginNavigation()
    publish({ id: crypto.randomUUID(), sessionId, epoch, kind, title: '', document: creationStarter(kind), metadataJson: null, findingKind: 'bug', source: null, phase: { state: 'editing' } })
    ctx.error(null)
    ctx.openDestination(kind)
  }
  function stageImage(input: RichEditorImageUpload): Promise<void> {
    const captured = intent
    if (!captured || captured.phase.state !== 'editing') return Promise.resolve()
    const operation = (async () => {
      try {
        if (input.file.size > 25 * 1024 * 1024) throw new Error('Image exceeds the 25 MiB limit.')
        const dataUrl = await readFileAsDataUrl(input.file)
        if (!matches(captured) || intent?.phase.state !== 'editing' || richEditorImageInserterForId(input.editorId) !== input.insertImage) return
        input.insertImage('', pastedImageFilename(input.file), dataUrl)
      } catch (cause) { if (matches(captured)) ctx.error(formatError(cause)) }
    })().finally(() => staging.delete(operation))
    staging.add(operation)
    return operation
  }
  async function acceptOutcome(captured: CreationIntent, outcome: CreationOutcome): Promise<boolean> {
    if (!matches(captured)) return false
    if (outcome.state === 'committed') {
      publish({ ...intent!, phase: { state: 'saved', record: outcome.record } })
      const selected = await ctx.selectSaved(captured, outcome.record)
      if (!selected || !matches(captured)) return false
      publish(null)
      return true
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
    const captured = intent
    if (!captured) return true
    if (captured.phase.state === 'saved') return acceptOutcome(captured, { state: 'committed', record: captured.phase.record })
    if (captured.phase.state === 'uncertain' || captured.phase.state === 'saving') {
      try {
        const outcome = await abortCreationSave(captured.phase.attempt.preparation.attemptId)
        if (outcome.state === 'committed' || outcome.state === 'committedDeleted') return acceptOutcome(captured, outcome)
        if (outcome.state !== 'aborted') { ctx.error('Owned image cleanup is retained. Retry discard before leaving.'); return false }
      } catch (cause) { ctx.error(`Could not settle this draft. ${formatError(cause)}`); return false }
    }
    if (!matches(captured)) return false
    publish({ ...captured, phase: { state: 'discarded' } })
    publish(null)
    return true
  }
  async function settle(): Promise<boolean> {
    if (saveInFlight) await saveInFlight
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
    if (choice === 'keep') { finishDecision(false); return }
    const settled = choice === 'save' ? await save() : await discard()
    if (settled) finishDecision(true)
  }
  return { open, update, save, discard, settle, decide, stageImage, current: () => intent,
    hasPendingChanges: () => Boolean(intent), isSaving: () => Boolean(saveInFlight || discardInFlight) }
}

export type CreationActions = ReturnType<typeof createCreationActions>
export function useCreationActions(ctx: Omit<CreationContext, 'changed' | 'decisionChanged'>) {
  const [creationIntent, setCreationIntent] = useState<CreationIntent | null>(null)
  const [creationDecision, setCreationDecision] = useState(false)
  const creation = useStableCapability({ ...ctx, changed: setCreationIntent, decisionChanged: setCreationDecision }, createCreationActions)
  return { creation, creationIntent, creationDecision }
}
