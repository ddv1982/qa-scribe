import type { CommitCreationSave, CreatedRecord, CreationKind, FindingKind, NoteSource, PrepareCreationSave } from '../tauri'
import { richEditorDocumentsEqual, type RichEditorDocument } from '../editor/editorDocument'
import { creationStarter, hasAuthoredCreationMetadata, type CreationFormat } from './creationFormats'

export type CreationAttempt = {
  preparation: PrepareCreationSave
  snapshot: CreationContent
  payload: CommitCreationSave | null
}
export type CreationImageOperation = { state: 'reading' } | { state: 'failed'; message: string }

export type CreationContent = {
  format: CreationFormat
  title: string
  document: RichEditorDocument
  metadataJson: string | null
  findingKind: FindingKind
}
export type CreationLifecycle =
  | { state: 'editing' }
  | { state: 'saving' | 'uncertain'; attempt: CreationAttempt }
  | { state: 'generating' | 'cancelling'; operationId: string; jobId: string | null }
  | { state: 'discarding'; attempt: CreationAttempt | null }
  | { state: 'saved'; record: CreatedRecord; selection: 'loading' | 'ready' }
  | { state: 'committed-deleted'; recordId: string }
  | { state: 'discarded' }
export type CreationIntent = CreationContent & {
  id: string
  sessionId: string
  kind: CreationKind
  epoch: number
  imageOperations: Record<string, CreationImageOperation>
  source: NoteSource | null
  sourceNoteId: string | null
  setup: 'ai' | null
  phase: CreationLifecycle
}

export function creationBodyIsAuthored(intent: CreationIntent): boolean {
  return Object.keys(intent.imageOperations).length > 0 || !richEditorDocumentsEqual(intent.document, creationStarter(intent.format))
}

export function creationIsAuthored(intent: CreationIntent): boolean {
  return creationBodyIsAuthored(intent) || Boolean(intent.title.trim())
    || hasAuthoredCreationMetadata(intent.metadataJson) || intent.findingKind !== 'bug'
}
