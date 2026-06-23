import { Flag, Loader2, Plus, Trash2 } from 'lucide-react'
import { EmptyCollection, StatusPill } from '../components/Common'
import type { Finding } from '../tauri'
import { formatFindingKind } from '../ui/format'
import type { BusyAction } from '../ui/types'

export function FindingsView({
  busyAction,
  findings,
  notice,
  error,
  isBusy,
  onDeleteFinding,
  onManualCreate,
}: {
  busyAction: BusyAction | null
  findings: Finding[]
  notice: string | null
  error: string | null
  isBusy: boolean
  onDeleteFinding: (finding: Finding) => void
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
      {notice || error ? (
        <div className="collection-status">
          <StatusPill notice={notice} error={error} busyAction={busyAction} />
        </div>
      ) : null}

      <div className="record-grid">
        {findings.map((finding) => {
          const deletingFinding = busyAction === `delete-finding:${finding.id}`
          return (
            <article className="record-card" key={finding.id}>
              <div className="record-card-header">
                <span>{formatFindingKind(finding.kind)}</span>
                <button
                  className="icon-button danger"
                  type="button"
                  aria-label={`Delete ${finding.title}`}
                  title="Delete finding"
                  disabled={isBusy}
                  onClick={() => void onDeleteFinding(finding)}
                >
                  {deletingFinding ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                </button>
              </div>
              <h2>{finding.title}</h2>
              <p>{finding.body}</p>
            </article>
          )
        })}
        {findings.length === 0 ? <EmptyCollection icon={Flag} title="No findings yet" /> : null}
      </div>
    </section>
  )
}
