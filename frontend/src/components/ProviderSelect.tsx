import type { AiProvider, ProviderDescriptor } from '../tauri'
import { Field } from './Field'

export function ProviderSelect({ providers, value, disabled, settingsDefault, onChange }: {
  providers: ProviderDescriptor[]
  value: AiProvider | ''
  disabled?: boolean
  settingsDefault?: string
  onChange: (provider: AiProvider | '') => void
}) {
  return <Field label="Provider">
    <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as AiProvider | '')}>
      {settingsDefault !== undefined ? <option value="">Settings default · {settingsDefault}</option> : null}
      {value && !providers.some(provider => provider.id === value) ? <option value={value}>{value}</option> : null}
      {providers.map(provider => <option key={provider.id} value={provider.id}>
        {provider.label}{provider.available ? '' : ' (unavailable)'}
      </option>)}
    </select>
  </Field>
}
