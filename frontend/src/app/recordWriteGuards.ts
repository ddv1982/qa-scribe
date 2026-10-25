import type { Draft, EditorStage, Finding, RecordWriteGuard, RefinementEditorValue } from '../bindings'
import { richEditorDocumentFromStoredBody, serializeRichEditorDocument } from '../editor/editorDocument'

export class RecordWriteConflict extends Error {
  constructor(readonly current: Finding | Draft) {
    super('Stored record changed. Your local changes are retained. Use Discard to review the latest saved record before requesting another refinement.')
  }
}

export async function recordWriteGuard(record: Finding | Draft, table: 'findings' | 'drafts', stage?: EditorStage): Promise<RecordWriteGuard> {
  if (stage) return { sessionId: record.sessionId, expectedStoredBase: stage.storedBaseToken, origin: { kind: 'proposal', stageId: stage.id } }
  const text = JSON.stringify([table, record.sessionId, record.id, [record.title, record.body, record.bodyJson, record.bodyFormat ?? 'html', record.kind, record.metadataJson]])
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return { sessionId: record.sessionId, expectedStoredBase: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''), origin: { kind: 'editor' } }
}

export function editorValue(record: Finding | Draft): RefinementEditorValue {
  return { title: record.title, documentJson: serializeRichEditorDocument(richEditorDocumentFromStoredBody(record)), metadataJson: record.metadataJson, recordKind: record.kind }
}

export function editorKey(value: RefinementEditorValue): string {
  const doc: unknown = JSON.parse(value.documentJson)
  return JSON.stringify([value.title, doc, value.recordKind, value.metadataJson], (_key, item: unknown) => {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    }
    return item
  })
}
