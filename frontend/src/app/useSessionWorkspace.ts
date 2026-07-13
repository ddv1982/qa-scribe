import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [sessionTitle, setSessionTitle] = useState('')
  const [noteBody, setNoteBody] = useState(emptyRichEditorDocument)

  const savedTitleRef = useRef('')
  const savedBodyRef = useRef(serializeRichEditorDocument(emptyRichEditorDocument))
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

  useEffect(() => {
    noteBodyRef.current = noteBody
  }, [noteBody])

  const workspace: SessionWorkspace = {
    activeSession,
    noteEntry,
    sessions,
    sessionTitle,
    noteBody,
    noteBodyHtml,
    savedTitleRef,
    savedBodyRef,
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
