import { useEffect, type RefObject } from 'react'
import { serializeRichEditorDocument } from '../editor/editorDocument'
import type { useSessionActions } from './sessionActions'
import type { SessionWorkspace } from './types'

type SessionAutosaveOptions = {
  session: SessionWorkspace
  sessionActions: ReturnType<typeof useSessionActions>
  bootedRef: RefObject<boolean>
  pendingRecoveredSummaryDecision: boolean
}

export function useSessionAutosave({ session, sessionActions, bootedRef, pendingRecoveredSummaryDecision }: SessionAutosaveOptions) {
  const { activeSession, sessionTitle, noteEntry, noteBody, savedTitleRef, savedBodyRef, suppressAmbientNoteSaveRef } = session
  useEffect(() => {
    if (!activeSession || !bootedRef.current) return
    const trimmedTitle = sessionTitle.trim()
    if (!trimmedTitle || sessionTitle === savedTitleRef.current) return
    const timeout = window.setTimeout(() => {
      if (suppressAmbientNoteSaveRef.current) return
      void sessionActions.saveTitle(sessionTitle)
    }, 700)
    return () => window.clearTimeout(timeout)
  }, [activeSession, sessionTitle]) // oxlint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to Session identity and title
  useEffect(() => {
    if (!noteEntry || !bootedRef.current) return
    const nextBody = serializeRichEditorDocument(noteBody)
    if (nextBody === savedBodyRef.current) return
    // Recovery conflicts require an explicit save/discard choice. Ambient
    // autosave must not silently choose the authored side of that decision.
    if (pendingRecoveredSummaryDecision) return
    const timeout = window.setTimeout(() => {
      if (suppressAmbientNoteSaveRef.current) return
      void sessionActions.saveNoteNow()
    }, 850)
    return () => window.clearTimeout(timeout)
  }, [noteEntry, noteBody, pendingRecoveredSummaryDecision]) // oxlint-disable-line react-hooks/exhaustive-deps -- debounce is keyed to note identity, body, and recovery decision
}
