import { getConversation, type ChatRef, openSessionNoteState, type Entry } from '../tauri'
import { richEditorDocumentFromStoredBody, serializeRichEditorDocument } from '../editor/editorDocument'
import type { SessionChatContext } from './sessionChat.types'

export function adoptChatCanonicalNote(ctx: SessionChatContext, note: Entry, expectedWriteVersion: number) {
  if (!ctx.noteEligibility.canRecoverCanonical(note.sessionId)) return false
  if (ctx.session.activeSessionIdRef.current !== note.sessionId || ctx.session.noteEntryIdRef.current !== note.id) {
    throw new Error('Open the affected Session to recover its canonical Note.')
  }
  if (!ctx.noteRecovery.has(note.sessionId) || ctx.session.noteBodyWriteVersionRef.current !== expectedWriteVersion) {
    throw new Error('The Note changed during canonical recovery. Reload it before editing.')
  }
  const document = richEditorDocumentFromStoredBody(note)
  ctx.sessionActions.adoptCanonicalNoteBody(document, note.id, note.sessionId)
  ctx.session.setNoteEntry(note)
  ctx.session.savedBodyRef.current = serializeRichEditorDocument(document)
  ctx.session.setNoteBody(document)
  ctx.generation.setLatestNoteGenerationUndo(null)
  ctx.noteRecovery.complete(note.sessionId)
  return true
}

// Recovery is read-only at the backend. It must never resubmit, call AI, or
// flush the stale visible Note while the transaction outcome is uncertain.
export async function recoverChatCanonicalNote(ctx: SessionChatContext, reference: ChatRef) {
  const { sessionId } = reference
  if (!ctx.noteEligibility.canRecoverCanonical(sessionId)) return null
  const noteId = ctx.session.noteEntryIdRef.current
  const writeVersion = ctx.session.noteBodyWriteVersionRef.current
  if (ctx.session.activeSessionIdRef.current !== sessionId || !noteId) {
    throw new Error('Open the affected Session to recover its canonical Note.')
  }
  const chat = await getConversation(reference)
  if (!ctx.noteEligibility.canRecoverCanonical(sessionId)) return null
  if (chat.owner.kind !== 'notes' || chat.draftId !== reference.draftId || chat.sessionId !== sessionId || (chat.submission && chat.submission.noteId !== noteId)) {
    throw new Error('Recovery returned an unexpected Chat or Note. The Note remains read-only.')
  }
  const canonical = await openSessionNoteState(sessionId)
  if (!ctx.noteEligibility.canRecoverCanonical(sessionId)) return null
  if (canonical.session.id !== sessionId || canonical.noteEntry.sessionId !== sessionId || canonical.noteEntry.id !== noteId) {
    throw new Error('Recovery returned an unexpected Session Note. The Note remains read-only.')
  }
  // When the invoke failed without a receipt, confirm the Chat revision did
  // not change across the Note read before clearing its independent guard.
  if (!chat.submission) {
    const confirmed = await getConversation(reference)
    if (!ctx.noteEligibility.canRecoverCanonical(sessionId)) return null
    if (confirmed.sessionId !== sessionId || confirmed.draftId !== chat.draftId
      || confirmed.revision !== chat.revision || confirmed.submission) {
      throw new Error('The submission outcome changed during recovery. Retry canonical recovery; do not edit the Note yet.')
    }
  }
  adoptChatCanonicalNote(ctx, canonical.noteEntry, writeVersion)
  return chat
}
