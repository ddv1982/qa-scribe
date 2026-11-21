import type { ProviderCatalogRollout, ProviderDescriptor } from '../tauri'

// Mirrors `catalog_selector_enabled` in src-tauri/src/commands/providers/rollout.rs.
export function catalogSelectorEnabled(provider: Pick<ProviderDescriptor, 'id'> | null, rollout: ProviderCatalogRollout | null): boolean {
  switch (provider?.id) {
    case 'codex_cli': return true
    case 'claude_code': return rollout !== 'disabled'
    case 'copilot_cli': return rollout === 'selector'
    default: return false
  }
}
