import type { ProviderCatalogRollout, ProviderDescriptor } from '../tauri'

export function catalogSelectorEnabled(provider: Pick<ProviderDescriptor, 'id'> | null, rollout: ProviderCatalogRollout | null): boolean {
  return Boolean(provider && (provider.id === 'codex_cli' || rollout === 'selector'))
}
