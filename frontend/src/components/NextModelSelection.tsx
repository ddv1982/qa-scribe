import { useId } from 'react'
import { ModelCombobox } from './ModelSelector'
import type { ProviderDescriptor } from '../tauri'
import { originSummary } from '../settings/defaults'
import '../styles/model-selection.css'

export function NextModelSelection({ provider, value, pending, disabled, catalogEnabled, onChange }: {
  provider: ProviderDescriptor | null
  value: string
  pending: boolean
  disabled: boolean
  catalogEnabled: boolean
  onChange: (value: string) => void
}) {
  const descriptionId = useId()
  const snapshot = provider?.defaultSnapshot
  return <section className="next-model-selection" aria-label="Next invocation model" onFocusCapture={(event) => {
    const focused = event.currentTarget.ownerDocument.activeElement
    if (!(focused instanceof HTMLElement) || !event.currentTarget.closest('.generation-preflight')) return
    requestAnimationFrame(() => {
      if (focused.ownerDocument.activeElement === focused) focused.scrollIntoView({ block: 'nearest' })
    })
  }}>
    <p className="chat-help">Next invocation · {provider?.label ?? 'AI provider'}</p>
    <ModelCombobox models={provider?.models ?? []} value={value}
      placement="above" disabled={disabled || pending} onChange={onChange}
      providerLabel={provider?.label} describedBy={descriptionId}
      resolvedDefaultModel={snapshot?.model.value ?? null}
      resolvedDefaultOrigin={originSummary(snapshot?.model.origin ?? null)}
      catalogChecked={catalogEnabled && ['fresh', 'stale'].includes(provider?.catalogSnapshot.state ?? '')} />
    <p className="chat-help" id={descriptionId}>Saved for this provider across QA Scribe. Changes affect the next invocation.</p>
    {snapshot?.model.value ? <p className="chat-help">Observed CLI default · {snapshot.model.value} · {snapshot.state}{snapshot.checkedAt ? ` · Checked ${new Date(snapshot.checkedAt).toLocaleString()}` : ''}</p> : null}
    {pending ? <p className="chat-help" role="status">Saving model preference…</p> : null}
  </section>
}
