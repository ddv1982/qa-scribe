import type { ProviderModelDescriptor } from '../tauri'

export function customModelCatalogAdvisory(models: readonly ProviderModelDescriptor[], value: string, catalogChecked: boolean): string | null {
  const currentValue = value.trim() || 'default'
  return catalogChecked
    && !['default', 'auto'].includes(currentValue.toLocaleLowerCase())
    && !models.some(model => model.id === currentValue)
    ? `Custom model “${currentValue}” is not in the current catalog. The CLI will validate it at run time.`
    : null
}
