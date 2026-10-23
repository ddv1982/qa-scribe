import creationSections from '../../../shared/creation-starters.json'
export { creationSections }
import type { CommitCreationSave, CreatedRecord, CreationKind, FindingKind, NoteSource, PrepareCreationSave } from '../tauri'
import { richEditorDocumentFromHtml, richEditorDocumentToPlainText, type RichEditorDocument } from '../editor/editorDocument'

export function creationStarter(kind: CreationKind): RichEditorDocument {
  return richEditorDocumentFromHtml(creationSections[kind].map((section) => `<h3>${section}</h3><p></p>`).join(''))
}

export type CreationAttempt = {
  preparation: PrepareCreationSave
  snapshot: CreationContent
  payload: CommitCreationSave | null
}
export type CreationImageOperation = { state: 'reading' } | { state: 'failed'; message: string }

export type CreationContent = {
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

export function creationIsAuthored(intent: CreationIntent): boolean {
  if (Object.keys(intent.imageOperations).length || intent.title.trim() || intent.metadataJson || intent.findingKind !== 'bug') return true
  const remaining = intent.document.doc.content?.filter((node) => {
    if (node.type === 'heading' && creationSections[intent.kind].includes((node.content ?? []).map((child) => child.text ?? '').join(''))) return false
    return node.type !== 'paragraph' || Boolean(node.content?.length)
  }) ?? []
  return remaining.some((node) => node.type !== 'paragraph')
    || Boolean(richEditorDocumentToPlainText({ schemaVersion: 1, doc: { type: 'doc', content: remaining } }))
}
