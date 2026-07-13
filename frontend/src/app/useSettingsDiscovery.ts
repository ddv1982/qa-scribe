import { useEffect, useRef } from 'react'
import type { ProviderStatus } from '../tauri'
import { defaultSnapshotNeedsRefresh } from '../settings/defaults'
import type { MainView } from '../ui/types'

export function useSettingsDiscovery(
  activeView: MainView,
  activeProvider: ProviderStatus['providers'][number] | null,
  discoverProviderDefaults: () => Promise<void>,
) {
  const requestedProviderRef = useRef<string | null>(null)

  useEffect(() => {
    if (activeView !== 'settings') {
      requestedProviderRef.current = null
      return
    }
    if (!activeProvider || !defaultSnapshotNeedsRefresh(activeProvider)) return
    if (requestedProviderRef.current === activeProvider.id) return
    requestedProviderRef.current = activeProvider.id
    void discoverProviderDefaults()
  }, [activeProvider, activeView, discoverProviderDefaults])
}
