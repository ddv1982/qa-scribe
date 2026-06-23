import { Box, Loader2, Plus, Save, Trash2 } from 'lucide-react'
import { EmptyCollection, StatusPill } from '../components/Common'
import type { Draft } from '../tauri'
import type { BusyAction } from '../ui/types'

export function TestwareView({
  busyAction,
  drafts,
  notice,
  error,
  isBusy,
  updateLocalDraft,
  onDeleteDraft,
  onManualCreate,
  onSaveDraft,
}: {
  busyAction: BusyAction | null
  drafts: Draft[]
  notice: string | null
  error: string | null
  isBusy: boolean
  updateLocalDraft: (id: string, patch: Partial<Pick<Draft, 'title' | 'body'>>) => void
  onDeleteDraft: (draft: Draft) => void
  onManualCreate: () => Promise<void>
  onSaveDraft: (draft: Draft) => Promise<void>
}) {
  return (
    <section className="collection-view">
      <header className="collection-header">
        <div>
          <p className="eyebrow">Testware</p>
          <h1>Test cases</h1>
        </div>
        <button className="primary-button" type="button" disabled={isBusy} onClick={() => void onManualCreate()}>
          {busyAction === 'manual-testware' ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
          New testware
        </button>
      </header>
      {notice || error ? (
        <div className="collection-status">
          <StatusPill notice={notice} error={error} busyAction={busyAction} />
        </div>
      ) : null}

      <div className="collection-stack">
        {drafts.map((draft) => {
          const deletingDraft = busyAction === `delete-draft:${draft.id}`
          const savingDraft = busyAction === `draft:${draft.id}`
          return (
            <article className="editable-record" key={draft.id}>
              <input value={draft.title} onChange={(event) => updateLocalDraft(draft.id, { title: event.target.value })} />
              <textarea value={draft.body} onChange={(event) => updateLocalDraft(draft.id, { body: event.target.value })} />
              <div className="record-actions">
                <button className="secondary-button" type="button" disabled={isBusy} onClick={() => void onSaveDraft(draft)}>
                  {savingDraft ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                  Save
                </button>
                <button
                  className="icon-button danger"
                  type="button"
                  aria-label={`Delete ${draft.title}`}
                  title="Delete testware"
                  disabled={isBusy}
                  onClick={() => void onDeleteDraft(draft)}
                >
                  {deletingDraft ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
                </button>
              </div>
            </article>
          )
        })}
        {drafts.length === 0 ? <EmptyCollection icon={Box} title="No testware yet" /> : null}
      </div>
    </section>
  )
}
