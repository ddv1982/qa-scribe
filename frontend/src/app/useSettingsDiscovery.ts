import { useEffect, useRef } from 'react'
import type { ProviderStatus } from '../tauri'
import { defaultSnapshotNeedsRefresh } from '../settings/defaults'
import type { MainView } from '../ui/types'

const CATALOG_FRESHNESS_MS = 5 * 60 * 1000

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
    if (!activeProvider) {
      requestedProviderRef.current = null
      return
    }
    const needsRefresh = defaultSnapshotNeedsRefresh(activeProvider)
      || catalogSnapshotNeedsRefresh(activeProvider)
    if (!needsRefresh) {
      // A successful observation completes the request cycle. Resetting here
      // allows the same provider to be refreshed again when either independent
      // snapshot later becomes stale without causing retry loops after a failed
      // request.
      requestedProviderRef.current = null
      return
    }
    if (requestedProviderRef.current === activeProvider.id) return
    requestedProviderRef.current = activeProvider.id
    void discoverProviderDefaults()
  }, [activeProvider, activeView, discoverProviderDefaults])
}

export function catalogSnapshotNeedsRefresh(
  provider: ProviderStatus['providers'][number] | null,
  now = Date.now(),
): boolean {
  if (!provider) return true
  const snapshot = provider.catalogSnapshot
  if (['idle', 'stale', 'failed'].includes(snapshot.state)) return true
  if (snapshot.state !== 'fresh') return false
  if (!snapshot.checkedAt) return true
  const checkedAt = Date.parse(snapshot.checkedAt)
  return Number.isNaN(checkedAt) || now - checkedAt >= CATALOG_FRESHNESS_MS
}
