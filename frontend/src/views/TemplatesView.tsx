import { ClipboardCheck } from 'lucide-react'
import { EmptyCollection } from '../components/Common'
import type { AppSettings } from '../tauri'

export function TemplatesView({
  settingsDraft,
  updateSettingsDraft,
}: {
  settingsDraft: AppSettings | null
  updateSettingsDraft: (patch: Partial<AppSettings>) => void
}) {
  if (!settingsDraft) return <EmptyCollection icon={ClipboardCheck} title="Templates unavailable" />

  return (
    <section className="template-view">
      <div className="template-grid">
        <TemplateField label="Testware output" value={settingsDraft.testwareTemplate ?? ''} onChange={(value) => updateSettingsDraft({ testwareTemplate: value })} />
        <TemplateField label="Finding output" value={settingsDraft.findingTemplate ?? ''} onChange={(value) => updateSettingsDraft({ findingTemplate: value })} />
        <TemplateField label="Note summary output" value={settingsDraft.noteSummaryTemplate ?? ''} onChange={(value) => updateSettingsDraft({ noteSummaryTemplate: value })} />
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
