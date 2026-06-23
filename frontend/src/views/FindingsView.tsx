import { Flag, Loader2, Plus } from 'lucide-react'
import { EmptyCollection } from '../components/Common'
import type { Finding } from '../tauri'
import { formatFindingKind } from '../ui/format'
import type { BusyAction } from '../ui/types'

export function FindingsView({
  busyAction,
  findings,
  isBusy,
  onManualCreate,
}: {
  busyAction: BusyAction | null
  findings: Finding[]
  isBusy: boolean
  onManualCreate: () => Promise<void>
}) {
  return (
    <section className="collection-view">
      <header className="collection-header">
        <div>
          <p className="eyebrow">Findings</p>
          <h1>Issues and risks</h1>
        </div>
        <button className="primary-button" type="button" disabled={isBusy} onClick={() => void onManualCreate()}>
          {busyAction === 'manual-finding' ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
          New finding
        </button>
      </header>

      <div className="record-grid">
        {findings.map((finding) => (
          <article className="record-card" key={finding.id}>
            <span>{formatFindingKind(finding.kind)}</span>
            <h2>{finding.title}</h2>
            <p>{finding.body}</p>
          </article>
        ))}
        {findings.length === 0 ? <EmptyCollection icon={Flag} title="No findings yet" /> : null}
      </div>
    </section>
  )
}
