import { ArrowLeft, Box, ChevronDown, ChevronUp, Code2, GripVertical, RotateCcw, Save, Settings, Sparkles } from 'lucide-react'
import type { ReactElement } from 'react'
import type { AppSettings, AppSettingsPatch, FormTemplateField, TemplateFieldType } from '../../../../shared/contracts'

const providerLabels: Record<keyof AppSettings['providers'], string> = {
  claude_code: 'Claude Code',
  codex_cli: 'Codex CLI',
  copilot_cli: 'GitHub Copilot CLI'
}

const fieldTypes: TemplateFieldType[] = ['text', 'textarea', 'rich_text', 'select', 'multiselect', 'checkbox']

export function SettingsPane(props: {
  settings: AppSettings | null
  draft: AppSettings | null
  saving: boolean
  error: string | null
  onChange: (patch: AppSettingsPatch) => void
  onClose: () => Promise<void> | void
  onReset: () => void
  onSave: () => Promise<unknown>
}): ReactElement {
  const draft = props.draft

  if (!draft) {
    return (
      <section className="settings-pane" aria-label="Application Settings">
        <div className="settings-empty" role="status">
          <Settings size={28} />
          <div>
            <h2>Settings unavailable</h2>
            <p>Application settings are still loading.</p>
          </div>
        </div>
      </section>
    )
  }

  const dirty = props.settings ? JSON.stringify(props.settings) !== JSON.stringify(draft) : false

  function updateField(template: 'note' | 'finding', fieldId: string, patch: Partial<FormTemplateField>): void {
    if (!draft) return
    props.onChange({
      templates: {
        [template]: {
          fields: draft.templates[template].fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field))
        }
      }
    })
  }

  function moveField(template: 'note' | 'finding', fieldId: string, direction: -1 | 1): void {
    if (!draft) return
    const fields = [...draft.templates[template].fields]
    const index = fields.findIndex((field) => field.id === fieldId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= fields.length) return
    const [field] = fields.splice(index, 1)
    fields.splice(nextIndex, 0, field!)
    props.onChange({ templates: { [template]: { fields } } })
  }

  return (
    <section className="settings-pane" aria-label="Application Settings">
      <header className="settings-header">
        <div>
          <h2>Settings</h2>
          <p>Keep AI generation simple. Advanced capture structure is optional.</p>
        </div>
        <div className="settings-actions">
          <button className="secondary-command fit" type="button" onClick={() => void props.onClose()}>
            <ArrowLeft size={16} />
            Back to Session
          </button>
          <button className="secondary-command fit" disabled={!dirty || props.saving} type="button" onClick={props.onReset}>
            <RotateCcw size={16} />
            Reset
          </button>
          <button className="primary-command fit" disabled={!dirty || props.saving} type="button" onClick={() => void props.onSave()}>
            <Save size={16} />
            {props.saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </header>

      {props.error ? <p className="settings-error" role="alert">{props.error}</p> : null}

      <div className="settings-grid">
        <section className="settings-card settings-row-card">
          <div className="settings-section-heading">
            <h3>AI Providers</h3>
            <p>Choose which providers qa-scribe can use.</p>
          </div>
          <div className="provider-toggle-list">
            {(Object.keys(providerLabels) as Array<keyof AppSettings['providers']>).map((provider) => (
              <label className="settings-toggle" key={provider}>
                <span className={`provider-toggle-icon ${provider}`}>{providerIcon(provider)}</span>
                <span className="provider-toggle-label">{providerLabels[provider]}</span>
                <input
                  aria-label={providerLabels[provider]}
                  checked={draft.providers[provider]}
                  type="checkbox"
                  onChange={(event) => props.onChange({ providers: { [provider]: event.target.checked } as AppSettingsPatch['providers'] })}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="settings-card settings-row-card settings-card-wide">
          <div className="settings-section-heading">
            <h3>System Prompt</h3>
            <p>Customize the instructions that guide qa-scribe when generating notes.</p>
          </div>
          <div className="settings-control-stack">
            <label className="field">
              <span className="visually-hidden">Custom system prompt</span>
            <textarea
              aria-label="Custom system prompt"
              value={draft.generation.systemPrompt}
              onChange={(event) => props.onChange({ generation: { systemPrompt: event.target.value } })}
            />
            </label>
            <p className="settings-tip">Tip: Keep it concise and specific for the best results.</p>
          </div>
        </section>
      </div>

      <details className="settings-card settings-card-wide settings-advanced-card">
        <summary className="settings-advanced-summary">
          <span className="settings-section-heading">
            <span className="eyebrow">Advanced</span>
            <h3>Capture Templates</h3>
            <p>Change Note and Finding form fields only when the default notepad flow is not enough.</p>
          </span>
          <span className="secondary-command compact" aria-hidden="true">Show fields</span>
        </summary>
        <div className="template-columns">
          <TemplateEditor
            title="Note form"
            fields={draft.templates.note.fields}
            onMove={(id, direction) => moveField('note', id, direction)}
            onUpdate={(id, patch) => updateField('note', id, patch)}
          />
          <TemplateEditor
            title="Finding form"
            fields={draft.templates.finding.fields}
            onMove={(id, direction) => moveField('finding', id, direction)}
            onUpdate={(id, patch) => updateField('finding', id, patch)}
          />
        </div>
      </details>
    </section>
  )
}

function TemplateEditor(props: {
  title: string
  fields: FormTemplateField[]
  onMove: (id: string, direction: -1 | 1) => void
  onUpdate: (id: string, patch: Partial<FormTemplateField>) => void
}): ReactElement {
  return (
    <section className="template-editor">
      <h4>{props.title}</h4>
          <div className="template-field-list">
            {props.fields.map((field, index) => (
              <div className="template-field-row" key={field.id}>
                <span className="template-drag-handle" aria-hidden="true">
                  <GripVertical size={15} />
                </span>
                <label className="settings-toggle compact-toggle">
                  <input
                checked={field.enabled}
                disabled={field.required}
                type="checkbox"
                onChange={(event) => props.onUpdate(field.id, { enabled: event.target.checked })}
              />
              <span>{field.label}</span>
            </label>
            <label className="field type-field">
              <span>Type</span>
              <select
                aria-label={`${field.label} type`}
                value={field.type}
                onChange={(event) => props.onUpdate(field.id, { type: event.target.value as TemplateFieldType })}
              >
                {fieldTypes.map((type) => (
                  <option value={type} key={type}>{formatFieldType(type)}</option>
                ))}
              </select>
            </label>
            <div className="template-order-actions" role="group" aria-label={`${field.label} order`}>
              <button
                aria-label="Up"
                className="icon-command"
                disabled={index === 0}
                title="Move up"
                type="button"
                onClick={() => props.onMove(field.id, -1)}
              >
                <ChevronUp size={15} />
              </button>
              <button
                aria-label="Down"
                className="icon-command"
                disabled={index === props.fields.length - 1}
                title="Move down"
                type="button"
                onClick={() => props.onMove(field.id, 1)}
              >
                <ChevronDown size={15} />
              </button>
            </div>
            {field.type === 'select' || field.type === 'multiselect' ? (
              <label className="field options-field">
                <span>Choices</span>
                <textarea
                  aria-label={`${field.label} choices`}
                  value={(field.options ?? []).join('\n')}
                  onChange={(event) => props.onUpdate(field.id, { options: parseChoices(event.target.value) })}
                />
              </label>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function providerIcon(provider: keyof AppSettings['providers']): ReactElement {
  if (provider === 'claude_code') return <Sparkles size={18} />
  if (provider === 'codex_cli') return <Box size={18} />
  return <Code2 size={18} />
}

function formatFieldType(type: TemplateFieldType): string {
  return type.replace('_', ' ')
}

function parseChoices(value: string): string[] {
  return value
    .split('\n')
    .map((choice) => choice.trim())
    .filter(Boolean)
}
