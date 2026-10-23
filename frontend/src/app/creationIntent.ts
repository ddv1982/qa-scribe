import type { CommitCreationSave, CreatedRecord, CreationKind, Entry, FindingKind, PrepareCreationSave } from '../tauri'
import { richEditorDocumentFromHtml, serializeRichEditorDocument, type RichEditorDocument } from '../editor/editorDocument'

export const creationSections = {
  finding: ['Environment', 'Steps to reproduce', 'Expected result', 'Actual result', 'Evidence', 'Impact'],
  testware: ['Scenario', 'Test case', 'Purpose', 'Preconditions', 'Steps', 'Expected result'],
} as const

export function creationStarter(kind: CreationKind): RichEditorDocument {
  return richEditorDocumentFromHtml(creationSections[kind].map((section) => `<h3>${section}</h3><p></p>`).join(''))
}

export type CreationAttempt = {
  preparation: PrepareCreationSave
  snapshot: CreationContent
  payload: CommitCreationSave | null
}
export type CreationContent = {
  title: string
  document: RichEditorDocument
  metadataJson: string | null
  findingKind: FindingKind
}
export type CreationLifecycle =
  | { state: 'editing' }
  | { state: 'saving' | 'uncertain'; attempt: CreationAttempt }
  | { state: 'saved'; record: CreatedRecord }
  | { state: 'committed-deleted'; recordId: string }
  | { state: 'discarded' }
export type CreationIntent = CreationContent & {
  id: string
  sessionId: string
  kind: CreationKind
  epoch: number
  source: { entry: Entry; revision: number } | null
  phase: CreationLifecycle
}

export function creationIsAuthored(intent: CreationIntent): boolean {
  return Boolean(intent.title.trim() || intent.metadataJson || intent.findingKind !== 'bug'
    || serializeRichEditorDocument(intent.document) !== serializeRichEditorDocument(creationStarter(intent.kind)))
}
