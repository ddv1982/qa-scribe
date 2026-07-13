import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { serializeRichEditorDocument, type RichEditorDocument } from '../editor/editorDocument'

type UsePendingChangeProtectionOptions = {
  hasActiveSession: boolean
  hasNoteEntry: boolean
  sessionTitle: string
  noteBody: RichEditorDocument
  savedTitleRef: MutableRefObject<string>
  savedBodyRef: MutableRefObject<string>
  dirtyDraftIdsRef: MutableRefObject<Set<string>>
  dirtyFindingIdsRef: MutableRefObject<Set<string>>
  savePendingChanges: () => Promise<boolean>
}

export function usePendingChangeProtection({
  hasActiveSession,
  hasNoteEntry,
  sessionTitle,
  noteBody,
  savedTitleRef,
  savedBodyRef,
  dirtyDraftIdsRef,
  dirtyFindingIdsRef,
  savePendingChanges,
}: UsePendingChangeProtectionOptions) {
  const hasPendingNoteChangesRef = useRef(false)
  const savePendingChangesRef = useRef(savePendingChanges)
  const closingAfterSaveRef = useRef(false)

  useEffect(() => {
    savePendingChangesRef.current = savePendingChanges
  }, [savePendingChanges])

  useEffect(() => {
    const titleDirty = Boolean(hasActiveSession && sessionTitle.trim() && sessionTitle.trim() !== savedTitleRef.current)
    const bodyDirty = Boolean(hasNoteEntry && serializeRichEditorDocument(noteBody) !== savedBodyRef.current)
    hasPendingNoteChangesRef.current = titleDirty || bodyDirty
  }, [hasActiveSession, hasNoteEntry, sessionTitle, noteBody, savedTitleRef, savedBodyRef])

  const hasPendingChanges = useCallback(() => {
    return hasPendingNoteChangesRef.current || dirtyDraftIdsRef.current.size > 0 || dirtyFindingIdsRef.current.size > 0
  }, [dirtyDraftIdsRef, dirtyFindingIdsRef])

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasPendingChanges()) return
      event.preventDefault()
      event.returnValue = ''
      void savePendingChangesRef.current()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasPendingChanges])

  useEffect(() => {
    let disposed = false
    let removeListener: (() => void) | null = null

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closingAfterSaveRef.current || !hasPendingChanges()) return
        event.preventDefault()
        const saved = await savePendingChangesRef.current()
        if (!saved) return
        closingAfterSaveRef.current = true
        await getCurrentWindow().close()
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten()
        } else {
          removeListener = unlisten
        }
      })
      .catch(() => {
        // The beforeunload fallback still protects browser/dev-preview usage.
      })

    return () => {
      disposed = true
      removeListener?.()
    }
  }, [hasPendingChanges])
}
