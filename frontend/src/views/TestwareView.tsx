import { Box, Loader2, Plus, Save } from 'lucide-react'
import { EmptyCollection } from '../components/Common'
import type { Draft } from '../tauri'
import type { BusyAction } from '../ui/types'

export function TestwareView({
  busyAction,
  drafts,
  isBusy,
  updateLocalDraft,
  onManualCreate,
  onSaveDraft,
}: {
  busyAction: BusyAction | null
  drafts: Draft[]
  isBusy: boolean
  updateLocalDraft: (id: string, patch: Partial<Pick<Draft, 'title' | 'body'>>) => void
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

      <div className="collection-stack">
        {drafts.map((draft) => (
          <article className="editable-record" key={draft.id}>
            <input value={draft.title} onChange={(event) => updateLocalDraft(draft.id, { title: event.target.value })} />
            <textarea value={draft.body} onChange={(event) => updateLocalDraft(draft.id, { body: event.target.value })} />
            <button className="secondary-button" type="button" disabled={isBusy} onClick={() => void onSaveDraft(draft)}>
              {busyAction === `draft:${draft.id}` ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              Save
            </button>
          </article>
        ))}
        {drafts.length === 0 ? <EmptyCollection icon={Box} title="No testware yet" /> : null}
      </div>
    </section>
  )
}
