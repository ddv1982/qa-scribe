import { useEffect, useState } from 'react'
import type { ProviderStatus } from '../tauri'
import type { MainView } from '../ui/types'
import { useSettingsDiscovery } from './useSettingsDiscovery'

export function useSettingsSectionFocus(
  activeView: MainView,
  activeProvider: ProviderStatus['providers'][number] | null,
  discoverProviderDefaults: () => Promise<void>,
) {
  const [pendingSettingsSection, setPendingSettingsSection] = useState<string | null>(null)
  useEffect(() => {
    if (activeView !== 'settings' || !pendingSettingsSection) return
    const timeout = window.setTimeout(() => {
      const section = document.getElementById(pendingSettingsSection)
      section?.scrollIntoView?.({ block: 'start' })
      section?.focus({ preventScroll: true })
      setPendingSettingsSection(null)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [activeView, pendingSettingsSection])
  useSettingsDiscovery(activeView, activeProvider, discoverProviderDefaults)
  return setPendingSettingsSection
}
