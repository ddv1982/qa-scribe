import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useRef } from 'react'
type UsePendingChangeProtectionOptions = {
  hasPendingChanges: () => boolean
  savePendingChanges: () => Promise<boolean>
}

export function usePendingChangeProtection({ hasPendingChanges, savePendingChanges }: UsePendingChangeProtectionOptions) {
  const savePendingChangesRef = useRef(savePendingChanges)
  const closeRequestInFlightRef = useRef(false)

  useEffect(() => { savePendingChangesRef.current = savePendingChanges }, [savePendingChanges])

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
