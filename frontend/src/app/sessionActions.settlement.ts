import { serializeRichEditorDocument } from '../editor/editorDocument'
import type { SessionActionsContext } from './sessionActions'

export function createSessionSettlement(ctx: SessionActionsContext, hasPendingCompensations: () => boolean) {
  function snapshot() {
    const titleDirty = Boolean(ctx.session.activeSessionIdRef.current
      && ctx.session.sessionTitleRef.current !== ctx.session.savedTitleRef.current)
    const bodyDirty = Boolean(ctx.session.noteEntryIdRef.current
      && serializeRichEditorDocument(ctx.session.noteBodyRef.current) !== ctx.session.savedBodyRef.current)
    const undo = ctx.latestNoteGenerationUndoRef.current
    const recoveryChoice = undo?.kind === 'recovery-choice' && undo.entryId === ctx.session.noteEntryIdRef.current
    return { titleDirty, bodyDirty, recoveryChoice, pending: titleDirty || bodyDirty || recoveryChoice }
  }
  return {
    snapshot,
    checkpoint: () => {
      const titleVersion = ctx.session.sessionTitleWriteVersionRef.current
      const bodyVersion = ctx.session.noteBodyWriteVersionRef.current
      return () => titleVersion === ctx.session.sessionTitleWriteVersionRef.current
        && bodyVersion === ctx.session.noteBodyWriteVersionRef.current
        && !snapshot().pending && !hasPendingCompensations()
    },
  }
}
