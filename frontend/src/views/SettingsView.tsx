import { SaveSettingsButton } from '../components/Common'
import { ModelCombobox, ProviderGlyph } from '../components/ModelSelector'
import { ThemeToggle } from '../components/ThemeToggle'
import type { AiProvider, AppSettings, ProviderStatus } from '../tauri'
import type { BusyAction, SettingsSaveState, ThemePreference } from '../ui/types'
import { TemplatesView } from './TemplatesView'

export function SettingsView({
  busyAction,
  providerStatus,
  settingsDraft,
  settingsSaveState,
  theme,
  updateSettingsDraft,
  setTheme,
  onSaveSettings,
}: {
  busyAction: BusyAction | null
  providerStatus: ProviderStatus | null
  settingsDraft: AppSettings | null
  settingsSaveState: SettingsSaveState
  theme: ThemePreference
  updateSettingsDraft: (patch: Partial<AppSettings>) => void
  setTheme: (theme: ThemePreference) => void
  onSaveSettings: () => Promise<void>
}) {
  const providerOptions = providerStatus?.providers ?? []
  const defaultProvider = settingsDraft?.selectedAiProvider ?? 'codex_cli'
  const defaultProviderStatus = providerOptions.find((provider) => provider.id === defaultProvider) ?? providerOptions[0] ?? null
  const defaultModel = settingsDraft ? modelForProvider(settingsDraft, defaultProvider) : 'default'
  const reasoningEffort = settingsDraft?.selectedAiReasoningEffortsByProvider?.[defaultProvider] ?? ''
  const reasoningOptions = reasoningEffortsFor(defaultProviderStatus)

  function updateDefaultProvider(provider: AiProvider) {
    if (!settingsDraft) return
    const model = modelForProvider(settingsDraft, provider)
    updateSettingsDraft({
      selectedAiProvider: provider,
      selectedAiModel: model,
    })
  }

  function updateDefaultModel(model: string) {
    if (!settingsDraft) return
    updateSettingsDraft({
      selectedAiModel: model,
      selectedAiModelsByProvider: {
        ...providerModelDefaults(),
        ...settingsDraft.selectedAiModelsByProvider,
        [defaultProvider]: model,
      },
    })
  }

  function updateReasoningEffort(value: string) {
    if (!settingsDraft) return
    updateSettingsDraft({
      selectedAiReasoningEffortsByProvider: {
        ...providerReasoningDefaults(),
        ...settingsDraft.selectedAiReasoningEffortsByProvider,
        [defaultProvider]: value || null,
      },
    })
  }

  return (
    <section className="settings-view">
      <header className="collection-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>Local app preferences</h1>
        </div>
        <SaveSettingsButton
          label="Save settings"
          busyAction={busyAction}
          disabled={!settingsDraft || busyAction !== null}
          state={settingsSaveState}
          onSave={onSaveSettings}
        />
      </header>

      <div className="settings-grid">
        <section>
          <h2>Appearance</h2>
          <ThemeToggle theme={theme} onThemeChange={setTheme} />
        </section>

        <section>
          <h2>Provider readiness</h2>
          <div className="provider-lines">
            {providerStatus?.providers.map((provider) => (
              <article key={provider.id}>
                <ProviderGlyph provider={provider.id} />
                <div>
                  <strong>{provider.label}</strong>
                  <p>{provider.reason}</p>
                </div>
                <span className={provider.available ? 'status-dot ready' : 'status-dot'} />
              </article>
            ))}
          </div>
        </section>

        {settingsDraft ? (
          <section>
            <h2>AI defaults</h2>
            <div className="ai-defaults-stack">
              <label className="select-shell">
                <ProviderGlyph provider={defaultProvider} />
                <select value={defaultProvider} onChange={(event) => updateDefaultProvider(event.target.value as AiProvider)}>
                  {providerOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <ModelCombobox models={defaultProviderStatus?.models ?? []} value={defaultModel} onChange={updateDefaultModel} />
              <label className="select-shell">
                <span>Reasoning</span>
                <select value={reasoningEffort} onChange={(event) => updateReasoningEffort(event.target.value)}>
                  <option value="">Provider default</option>
                  {reasoningOptions.map((effort) => (
                    <option key={effort} value={effort}>
                      {reasoningLabel(effort)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        ) : null}

        {settingsDraft ? (
          <section className="wide-setting">
            <h2>Generation prompt</h2>
            <p className="settings-note">Standard note capture and generation work without template tuning. Adjust these only when your Jira or testware format needs stricter wording.</p>
            <textarea value={settingsDraft.generationSystemPrompt} onChange={(event) => updateSettingsDraft({ generationSystemPrompt: event.target.value })} />
          </section>
        ) : null}

        <section className="wide-setting advanced-setting">
          <details>
            <summary>Advanced templates</summary>
            <TemplatesView
              busyAction={busyAction}
              settingsDraft={settingsDraft}
              settingsSaveState={settingsSaveState}
              updateSettingsDraft={updateSettingsDraft}
              onSaveSettings={onSaveSettings}
            />
          </details>
        </section>
      </div>
    </section>
  )
}

function providerModelDefaults(): Record<AiProvider, string> {
  return {
    claude_code: 'default',
    codex_cli: 'default',
    copilot_cli: 'auto',
  }
}

function providerReasoningDefaults(): Record<AiProvider, string | null> {
  return {
    claude_code: 'medium',
    codex_cli: 'low',
    copilot_cli: null,
  }
}

function modelForProvider(settings: AppSettings, provider: AiProvider): string {
  return settings.selectedAiModelsByProvider?.[provider] || (provider === settings.selectedAiProvider ? settings.selectedAiModel : null) || providerModelDefaults()[provider]
}

function reasoningEffortsFor(provider: ProviderStatus['providers'][number] | null): string[] {
  const efforts = provider?.models.flatMap((model) => model.reasoningEfforts) ?? []
  const unique = Array.from(new Set(efforts))
  return unique.length > 0 ? unique : ['low', 'medium', 'high', 'xhigh']
}

function reasoningLabel(effort: string): string {
  if (effort === 'xhigh') return 'Extra high'
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}
