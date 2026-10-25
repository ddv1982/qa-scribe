import type { ChatTarget, Draft, Finding } from '../bindings'
import { richEditorDocumentFromStoredBody, serializeRichEditorDocument } from '../editor/editorDocument'
import type { RecordWorkspace } from './types'

export type RecordChatTarget = { kind: 'finding' | 'test_cases_draft'; recordId: string }
export type RecordChatSelection = RecordChatTarget & { title: string; unsaved: boolean }
export type ChatContextPresentation = { kind: 'session' } | RecordChatSelection
export type RecordChatActions = {
  onAskAi: (target: RecordChatSelection) => void | Promise<void>
  onSelectRecord: (target: RecordChatSelection | null, requestId?: string) => void
  revealRequest?: import('./conversationPresentation').RecordRevealRequest | null
  acknowledgeReveal?: (request: import('./conversationPresentation').RecordRevealRequest) => void
}

export function captureRecordContext(sessionId: string, target: RecordChatTarget, records: RecordWorkspace): ChatTarget {
  const record: Finding | Draft | undefined = target.kind === 'finding'
    ? records.findingsRef.current.find(record => record.id === target.recordId)
    : records.draftsRef.current.find(record => record.id === target.recordId && record.kind === 'testware')
  if (!record || record.sessionId !== sessionId) throw new Error('This record is no longer available in this Session.')
  const dirty = target.kind === 'finding' ? records.dirtyFindingIdsRef.current : records.dirtyDraftIdsRef.current
  return {
    kind: target.kind,
    snapshot: {
      sessionId, recordId: record.id, title: record.title,
      documentJson: serializeRichEditorDocument(richEditorDocumentFromStoredBody(record)),
      metadataJson: record.metadataJson, recordKind: record.kind,
      origin: dirty.has(record.id) ? 'unsaved_editor' : 'saved',
      localFingerprint: '', storedBaseToken: '',
    },
  }
}
