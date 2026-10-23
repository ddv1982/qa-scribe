import { cancelAiActionJob, readNoteSource, startAiActionJob, type CreatedRecord, type CreationOutcome, type GenerationJobEvent, type GenerationJobStatus, type NoteSource, type TestwareGenerationPreferences } from '../tauri'
import { richEditorDocumentFromHtml } from '../editor/editorDocument'
import { formatError } from '../ui/format'
import { renderPrefilledFinding, renderPrefilledTestware } from '../workflows/prefillTemplates'
import type { AiSelection } from './types'
import type { CreationIntent } from './creationIntent'

export type CreationSourceHost = {
  sourceAllowed: () => boolean
  current: () => CreationIntent | null
  publish: (intent: CreationIntent | null) => void
  matches: (intent: CreationIntent) => boolean
  beginNavigation: () => number
  navigationIsCurrent: (epoch: number) => boolean
  notice?: (message: string) => void
  error: (message: string | null) => void
  publishJob: (status: GenerationJobStatus) => void
  acceptOutcome: (intent: CreationIntent, outcome: CreationOutcome) => Promise<boolean>
  finished: () => void
}

export function createCreationSourceActions(host: CreationSourceHost) {
  let sourceRead = 0
  let cancellation: Promise<void> | null = null
  async function reviewSource(): Promise<void> {
    const current = host.current()
    if (!current || current.phase.state !== 'editing' || !current.sourceNoteId) return
    const captured = current
    const read = ++sourceRead
    try {
      const source = await readNoteSource(captured.sessionId, captured.sourceNoteId!)
      if (read === sourceRead && host.matches(captured)) host.publish({ ...host.current()!, source })
    } catch (cause) { if (host.matches(captured)) host.error(formatError(cause)) }
  }
  async function confirmSource(captured: CreationIntent): Promise<NoteSource | null> {
    if (!host.sourceAllowed() || !captured.source || !captured.sourceNoteId) return null
    const latest = await readNoteSource(captured.sessionId, captured.sourceNoteId)
    if (!host.matches(captured) || !host.navigationIsCurrent(captured.epoch) || !host.sourceAllowed()) return null
    if (!latest || latest.entry.id !== captured.source.entry.id || latest.revision !== captured.source.revision) {
      host.publish({ ...host.current()!, source: latest })
      host.error('The Note changed. Review the refreshed source and confirm again.')
      return null
    }
    return latest
  }
  async function prefill(): Promise<boolean> {
    const current = host.current()
    if (!current || current.phase.state !== 'editing' || !host.sourceAllowed()) return false
    const captured = { ...current, epoch: host.beginNavigation() }
    host.publish(captured)
    try {
      const source = await confirmSource(captured)
      if (!source || !host.matches(captured) || host.current()?.phase.state !== 'editing') return false
      const html = captured.kind === 'finding' ? renderPrefilledFinding(source.entry.body) : renderPrefilledTestware(source.entry.title ?? '', source.entry.body)
      host.publish({ ...host.current()!, document: richEditorDocumentFromHtml(html), title: captured.title || source.entry.title || '' })
      host.error(null)
      return true
    } catch (cause) { if (host.matches(captured)) host.error(formatError(cause)); return false }
  }
  async function generate(selection: AiSelection, preferences?: TestwareGenerationPreferences): Promise<boolean> {
    const currentIntent = host.current()
    if (!currentIntent || currentIntent.phase.state !== 'editing' || !currentIntent.source || !host.sourceAllowed()) return false
    const captured: CreationIntent = { ...currentIntent, epoch: host.beginNavigation() }
    const operationId = crypto.randomUUID()
    host.publish({ ...captured, phase: { state: 'generating', operationId, jobId: null } })
    const owned = () => {
      const phase = host.current()?.phase
      return host.matches(captured) && (phase?.state === 'generating' || phase?.state === 'cancelling') && phase.operationId === operationId
    }
    function restore() { if (owned()) host.publish({ ...host.current()!, phase: { state: 'editing' } }) }
    function event(event: GenerationJobEvent) {
      if (!owned() || event.status.sessionId !== captured.sessionId || event.status.action !== captured.kind) return
      const current = host.current()!
      if ((current.phase.state !== 'generating' && current.phase.state !== 'cancelling')
        || (current.phase.jobId !== null && current.phase.jobId !== event.job_id)) return
      host.publishJob(event.status)
      host.publish({ ...current, phase: { ...current.phase, jobId: event.job_id } })
      if (event.type === 'cancelled' || event.type === 'failed') {
        restore()
        if (event.type === 'cancelled') host.notice?.('Generation cancelled')
        if (event.type === 'failed') { host.error(event.error_message); void reviewSource() }
      } else if (event.type === 'completed') {
        const record: CreatedRecord | null = event.result.finding ? { kind: 'finding', record: event.result.finding }
          : event.result.draft ? { kind: 'testware', record: event.result.draft } : null
        if (!record || record.kind !== captured.kind) { restore(); host.error('Generation finished without the expected saved result.'); return }
        void host.acceptOutcome(captured, { state: 'committed', record }).then((selected) => { if (selected) { host.notice?.(captured.kind === 'testware' ? 'Testware generated and saved' : 'Finding generated and saved'); host.finished() } }).catch((cause: unknown) => host.error(formatError(cause)))
      }
    }
    try {
      host.error(null)
      const source = await confirmSource(captured)
      if (!source || !owned() || host.current()?.phase.state === 'cancelling') { restore(); return false }
      const started = await startAiActionJob({ sessionId: captured.sessionId, noteEntryId: source.entry.id,
        expectedNoteRevision: source.revision, provider: selection.selectedProvider, model: selection.selectedModel.trim() || 'default',
        reasoningEffort: selection.selectedReasoningEffort, action: captured.kind,
        testwarePreferences: captured.kind === 'testware' ? preferences ?? null : null }, event)
      if (owned()) {
        host.publishJob(started.status)
        host.notice?.(captured.kind === 'testware' ? 'Generating test cases' : 'Generating finding')
        const current = host.current()!
        if (current.phase.state === 'generating' || current.phase.state === 'cancelling') {
          host.publish({ ...current, phase: { ...current.phase, jobId: started.jobId } })
          if (current.phase.state === 'cancelling') void cancelGeneration()
        }
      }
      return true
    } catch (cause) { if (owned()) { restore(); host.error(formatError(cause)); void reviewSource() }; return false }
  }
  function cancelGeneration(): Promise<void> {
    if (cancellation) return cancellation
    const captured = host.current()
    if (!captured || (captured.phase.state !== 'generating' && captured.phase.state !== 'cancelling')) return Promise.resolve()
    const phase = captured.phase
    const jobId = captured.phase.jobId
    if (!jobId) { host.publish({ ...captured, phase: { ...phase, state: 'cancelling' } }); return Promise.resolve() }
    host.publish({ ...captured, phase: { ...captured.phase, state: 'cancelling' } })
    cancellation = cancelAiActionJob(jobId).then((status) => {
      host.publishJob(status)
      const current = host.current()
      if (!current || !host.matches(captured) || (current.phase.state !== 'generating' && current.phase.state !== 'cancelling') || current.phase.operationId !== phase.operationId) return
      if (status.state === 'cancelled' || status.state === 'failed') host.publish({ ...host.current()!, phase: { state: 'editing' } })
      if (status.state === 'cancelled') host.notice?.('Generation cancelled')
      else if (status.state === 'failed') host.error(status.errorMessage ?? 'Generation failed.')
      else if (status.state === 'completed') host.notice?.('Generation already completed. Its result is saved.')
      else host.notice?.('Cancelling generation')
    }).catch((cause: unknown) => {
      const current = host.current()
      if (current && host.matches(captured) && (current.phase.state === 'generating' || current.phase.state === 'cancelling') && current.phase.operationId === phase.operationId) {
        host.publish({ ...current, phase: { ...phase, state: 'generating' } })
        host.error(formatError(cause))
      }
    }).finally(() => { cancellation = null })
    return cancellation
  }
  return { reviewSource, prefill, generate, cancelGeneration }
}
