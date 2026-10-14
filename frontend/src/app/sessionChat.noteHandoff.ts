import { openSessionNoteState, submitChat, type ChatState } from '../tauri'
import { richEditorDocumentFromStoredBody, serializeRichEditorDocument } from '../editor/editorDocument'
import { chatScope, type SessionChatContext } from './sessionChat.types'
import { formatError } from '../ui/format'
import { adoptChatCanonicalNote } from './sessionChat.noteRecovery'

// Chat uses the same strict Note write coordinator as navigation and Summary.
// No older write or image materialization may cross the transactional handoff.
export async function submitChatToCanonicalNote(ctx: SessionChatContext, chat: ChatState) {
  const sessionId = chat.sessionId
  const noteId = ctx.session.noteEntryIdRef.current
  if (!noteId || ctx.session.activeSessionIdRef.current !== sessionId) throw new Error('Open this Session before submitting Chat.')
  const suppression = ctx.session.suppressAmbientNoteSaveRef.current
  ctx.session.suppressAmbientNoteSaveRef.current = true
  try {
    for (;;) {
      await ctx.sessionActions.waitForPendingSessionWrites()
      if (ctx.noteRecovery.isRetired(sessionId)) throw new Error('The Session was deleted.')
      if (!await ctx.sessionActions.saveNoteNow({ manageBusy: false })) throw new Error('Save the Session Note successfully before submitting Chat.')
      await ctx.sessionActions.waitForPendingSessionWrites()
      if (!await ctx.sessionActions.retryAllPendingSessionCompensations()) throw new Error('Pending Note writes could not be reconciled.')
      if (ctx.session.activeSessionIdRef.current !== sessionId || ctx.session.noteEntryIdRef.current !== noteId) {
        throw new Error('The active Session changed before Chat submission.')
      }
      if (serializeRichEditorDocument(ctx.session.noteBodyRef.current) === ctx.session.savedBodyRef.current) break
    }
    const version = ctx.session.noteBodyWriteVersionRef.current
    const before = await openSessionNoteState(sessionId)
    if (ctx.noteRecovery.isRetired(sessionId)) throw new Error('The Session was deleted.')
    const note = before.noteEntry
    if (note.id !== noteId || note.sessionId !== sessionId || before.session.id !== sessionId) {
      throw new Error('Chat submission returned an unexpected Session Note.')
    }
    if (version !== ctx.session.noteBodyWriteVersionRef.current
      || ctx.session.activeSessionIdRef.current !== sessionId
      || serializeRichEditorDocument(richEditorDocumentFromStoredBody(note)) !== ctx.session.savedBodyRef.current) {
      throw new Error('The Note changed before Chat submission. Review it and try again.')
    }
    ctx.noteRecovery.begin(sessionId)
    // Invalidate older editor/image materialization intents before the invoke.
    ctx.session.noteBodyWriteVersionRef.current += 1
    const handoffWriteVersion = ctx.session.noteBodyWriteVersionRef.current
    const receipt = await submitChat({ scope: chatScope(chat), noteId,
      expectedNoteBody: note.body, expectedNoteBodyJson: note.bodyJson, expectedNoteBodyFormat: note.bodyFormat })
    if (ctx.noteRecovery.isRetired(sessionId)) throw new Error('The Session was deleted.')
    if (receipt.draftId !== chat.draftId || receipt.noteId !== noteId) {
      throw new Error('Submission returned an unexpected receipt. Recover the canonical Note before editing.')
    }
    const after = await openSessionNoteState(sessionId).catch((cause: unknown) => {
      throw new Error(`Chat was submitted, but the updated Note could not be loaded. Reopen the Session to recover it. ${formatError(cause)}`)
    })
    if (ctx.noteRecovery.isRetired(sessionId)) throw new Error('The Session was deleted.')
    if (after.session.id !== sessionId || after.noteEntry.id !== noteId || after.noteEntry.sessionId !== sessionId) {
      throw new Error('Submitted Chat returned an unexpected Session Note. Reopen the Session to recover it.')
    }
    adoptChatCanonicalNote(ctx, after.noteEntry, handoffWriteVersion)
    ctx.feedback.setNotice('Chat submitted to Session Note')
    return receipt
  } finally {
    ctx.session.suppressAmbientNoteSaveRef.current = suppression
  }
}
