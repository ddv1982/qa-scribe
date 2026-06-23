import { ClipboardCheck } from 'lucide-react'
import { EmptyCollection, SaveSettingsButton } from '../components/Common'
import type { AppSettings } from '../tauri'
import type { BusyAction, SettingsSaveState } from '../ui/types'

export function TemplatesView({
  busyAction,
  settingsDraft,
  settingsSaveState,
  updateSettingsDraft,
  onSaveSettings,
}: {
  busyAction: BusyAction | null
  settingsDraft: AppSettings | null
  settingsSaveState: SettingsSaveState
  updateSettingsDraft: (patch: Partial<AppSettings>) => void
  onSaveSettings: () => Promise<void>
}) {
  if (!settingsDraft) return <EmptyCollection icon={ClipboardCheck} title="Templates unavailable" />

  return (
    <section className="template-view">
      <header className="collection-header">
        <div>
          <p className="eyebrow">Templates</p>
          <h1>Generated output structure</h1>
        </div>
        <SaveSettingsButton label="Save templates" busyAction={busyAction} disabled={busyAction !== null} state={settingsSaveState} onSave={onSaveSettings} />
      </header>
      <div className="template-grid">
        <TemplateField label="Testware" value={settingsDraft.testwareTemplate} onChange={(value) => updateSettingsDraft({ testwareTemplate: value })} />
        <TemplateField label="Findings" value={settingsDraft.findingTemplate} onChange={(value) => updateSettingsDraft({ findingTemplate: value })} />
        <TemplateField label="Note summary" value={settingsDraft.noteSummaryTemplate} onChange={(value) => updateSettingsDraft({ noteSummaryTemplate: value })} />
      </div>
    </section>
  )
}

function TemplateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="template-field">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}
