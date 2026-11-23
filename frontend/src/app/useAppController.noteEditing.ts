import type { Entry } from '../bindings'
import { richEditorDocumentFromStoredBody, serializeRichEditorDocument } from '../editor/editorDocument'
import { useRef } from 'react'
import type { useSessionActions } from './sessionActions'
import type { SessionWorkspace } from './types'
import { useGenerationWorkspace } from './useGenerationWorkspace'

export function useCoordinatedGenerationWorkspace() {
  const {
    generationJobs,
    pendingGenerationAction,
    latestNoteGenerationUndo,
    setPendingGenerationAction,
    setLatestNoteGenerationUndo: setLatestNoteGenerationUndoState,
    workspace: generationWorkspace,
  } = useGenerationWorkspace()
  const latestNoteGenerationUndoRef = useRef(latestNoteGenerationUndo)
  function setLatestNoteGenerationUndo(value: Parameters<typeof setLatestNoteGenerationUndoState>[0]) {
    const next = typeof value === 'function' ? value(latestNoteGenerationUndoRef.current) : value
    latestNoteGenerationUndoRef.current = next
    setLatestNoteGenerationUndoState(next)
  }
  const coordinatedGenerationWorkspace = {
    ...generationWorkspace,
    latestNoteGenerationUndo,
    setLatestNoteGenerationUndo,
  }
  return {
    generationJobs,
    pendingGenerationAction,
    latestNoteGenerationUndo,
    latestNoteGenerationUndoRef,
    setPendingGenerationAction,
    setLatestNoteGenerationUndo,
    coordinatedGenerationWorkspace,
  }
}

type CoordinatedGenerationWorkspace = ReturnType<typeof useCoordinatedGenerationWorkspace>

type NoteEditorsContext = {
  session: SessionWorkspace
  sessionActions: ReturnType<typeof useSessionActions>
  latestNoteGenerationUndoRef: CoordinatedGenerationWorkspace['latestNoteGenerationUndoRef']
  setLatestNoteGenerationUndo: CoordinatedGenerationWorkspace['setLatestNoteGenerationUndo']
}

export function createNoteEditors({
  session,
  sessionActions,
  latestNoteGenerationUndoRef,
  setLatestNoteGenerationUndo,
}: NoteEditorsContext) {
  function setEditedSessionTitle(value: Parameters<SessionWorkspace['setSessionTitle']>[0]) {
    const next = typeof value === 'function' ? value(session.sessionTitleRef.current) : value
    if (next === session.sessionTitleRef.current) return
    sessionActions.registerTitleEditIntent()
    session.setSessionTitle(next)
  }
  function setEditedNoteBody(value: Parameters<SessionWorkspace['setNoteBody']>[0]) {
    const next = typeof value === 'function' ? value(session.noteBodyRef.current) : value
    if (!sessionActions.registerNoteEditIntent(next)) return
    const recoveryDecision = latestNoteGenerationUndoRef.current
    if (recoveryDecision?.kind === 'recovery-choice') {
      setLatestNoteGenerationUndo(recoveryDecision.choice === 'authored'
        ? { ...recoveryDecision, before: next }
        : { ...recoveryDecision, generated: next, choice: 'generated' })
    } else {
      setLatestNoteGenerationUndo(null)
    }
    session.setNoteBody(next)
  }
  function adoptRefinedNote(note: Entry, expected: string) {
    if (session.activeSessionIdRef.current !== note.sessionId || session.noteEntryIdRef.current !== note.id) return
    const document = richEditorDocumentFromStoredBody(note)
    const current = serializeRichEditorDocument(session.noteBodyRef.current)
    session.savedBodyRef.current = serializeRichEditorDocument(document)
    session.setNoteEntry(note)
    if (current === expected) {
      sessionActions.adoptCanonicalNoteBody(document, note.id, note.sessionId)
      session.setNoteBody(document)
    }
    setLatestNoteGenerationUndo(null)
  }

  return { setEditedSessionTitle, setEditedNoteBody, adoptRefinedNote }
}
