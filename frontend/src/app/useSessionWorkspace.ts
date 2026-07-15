import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Entry, Session } from '../tauri'
import {
  emptyRichEditorDocument,
  richEditorDocumentToHtml,
  serializeRichEditorDocument,
} from '../editor/editorDocument'
import type { SessionWorkspace } from './types'

export function useSessionWorkspace() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [noteEntry, setNoteEntry] = useState<Entry | null>(null)
  const [sessionLibraryComplete, setSessionLibraryComplete] = useState(false)
  const [sessionTitle, setSessionTitleState] = useState('')
  const [noteBody, setNoteBodyState] = useState(emptyRichEditorDocument)

  const savedTitleRef = useRef('')
  const savedBodyRef = useRef(serializeRichEditorDocument(emptyRichEditorDocument))
  const sessionTitleRef = useRef('')
  const noteBodyRef = useRef(emptyRichEditorDocument)
  const sessionTitleWriteVersionRef = useRef(0)
  const noteBodyWriteVersionRef = useRef(0)
  const deletingSessionIdRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const noteEntryIdRef = useRef<string | null>(null)
  const suppressAmbientNoteSaveRef = useRef(false)
  const forcedPendingSaveRef = useRef<Promise<boolean> | null>(null)
  const noteBodyHtml = useMemo(() => richEditorDocumentToHtml(noteBody), [noteBody])

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id ?? null
    noteEntryIdRef.current = noteEntry?.id ?? null
  }, [activeSession?.id, noteEntry?.id])

  const setSessionTitle = useCallback<Dispatch<SetStateAction<string>>>((value) => {
    const next = typeof value === 'function' ? value(sessionTitleRef.current) : value
    sessionTitleRef.current = next
    setSessionTitleState(next)
  }, [])

  const setNoteBody = useCallback<Dispatch<SetStateAction<typeof emptyRichEditorDocument>>>((value) => {
    const next = typeof value === 'function' ? value(noteBodyRef.current) : value
    noteBodyRef.current = next
    setNoteBodyState(next)
  }, [])

  const workspace: SessionWorkspace = {
    activeSession,
    noteEntry,
    sessions,
    sessionTitle,
    noteBody,
    noteBodyHtml,
    savedTitleRef,
    savedBodyRef,
    sessionTitleRef,
    noteBodyRef,
    sessionTitleWriteVersionRef,
    noteBodyWriteVersionRef,
    deletingSessionIdRef,
    activeSessionIdRef,
    noteEntryIdRef,
    suppressAmbientNoteSaveRef,
    forcedPendingSaveRef,
    setSessions,
    setActiveSession,
    setNoteEntry,
    setSessionTitle,
    setNoteBody,
  }

  return { ...workspace, sessionLibraryComplete, setSessionLibraryComplete, workspace }
}
