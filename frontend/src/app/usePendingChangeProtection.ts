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
  pendingRecoveredSummaryDecision: boolean
  dirtyDraftIdsRef: MutableRefObject<Set<string>>
  dirtyFindingIdsRef: MutableRefObject<Set<string>>
  settingsDirty: boolean
  hasPendingCompensations: () => boolean
  savePendingChanges: () => Promise<boolean>
}

export function usePendingChangeProtection({
  hasActiveSession,
  hasNoteEntry,
  sessionTitle,
  noteBody,
  savedTitleRef,
  savedBodyRef,
  pendingRecoveredSummaryDecision,
  dirtyDraftIdsRef,
  dirtyFindingIdsRef,
  settingsDirty,
  hasPendingCompensations,
  savePendingChanges,
}: UsePendingChangeProtectionOptions) {
  const pendingNoteStateRef = useRef({ hasActiveSession, hasNoteEntry, sessionTitle, noteBody, pendingRecoveredSummaryDecision })
  const savePendingChangesRef = useRef(savePendingChanges)
  const closeRequestInFlightRef = useRef(false)

  useEffect(() => {
    savePendingChangesRef.current = savePendingChanges
  }, [savePendingChanges])

  useEffect(() => {
    pendingNoteStateRef.current = { hasActiveSession, hasNoteEntry, sessionTitle, noteBody, pendingRecoveredSummaryDecision }
  }, [hasActiveSession, hasNoteEntry, sessionTitle, noteBody, pendingRecoveredSummaryDecision])

  const hasPendingChanges = useCallback(() => {
    const current = pendingNoteStateRef.current
    const titleDirty = Boolean(
      current.hasActiveSession
      && current.sessionTitle !== savedTitleRef.current,
    )
    const bodyDirty = Boolean(current.hasNoteEntry && serializeRichEditorDocument(current.noteBody) !== savedBodyRef.current)
    return current.pendingRecoveredSummaryDecision || titleDirty || bodyDirty || settingsDirty || hasPendingCompensations() || dirtyDraftIdsRef.current.size > 0 || dirtyFindingIdsRef.current.size > 0
  }, [dirtyDraftIdsRef, dirtyFindingIdsRef, hasPendingCompensations, savedBodyRef, savedTitleRef, settingsDirty])

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
    const currentWindow = getCurrentWindow()

    void currentWindow
      .onCloseRequested(async (event) => {
        if (closeRequestInFlightRef.current) {
          event.preventDefault()
          return
        }
        if (!hasPendingChanges()) return
        event.preventDefault()
        closeRequestInFlightRef.current = true
        try {
          const saved = await savePendingChangesRef.current()
          if (saved) await currentWindow.destroy()
        } finally {
          closeRequestInFlightRef.current = false
        }
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
