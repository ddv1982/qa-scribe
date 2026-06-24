import { Loader2, RefreshCw } from 'lucide-react'
import { SaveSettingsButton } from '../components/Common'
import { ModelCombobox, ProviderGlyph } from '../components/ModelSelector'
import { ThemeToggle } from '../components/ThemeToggle'
import { modelForProvider, providerModelDefaults, providerReasoningDefaults, reasoningEffortsFor } from '../settings/defaults'
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
  onRefreshProviderStatus,
}: {
  busyAction: BusyAction | null
  providerStatus: ProviderStatus | null
  settingsDraft: AppSettings | null
  settingsSaveState: SettingsSaveState
  theme: ThemePreference
  updateSettingsDraft: (patch: Partial<AppSettings>) => void
  setTheme: (theme: ThemePreference) => void
  onSaveSettings: () => Promise<void>
  onRefreshProviderStatus: () => Promise<void>
}) {
  const providerOptions = providerStatus?.providers ?? []
  const providerStatusLoaded = providerStatus !== null
  const availableProviderOptions = providerOptions.filter((provider) => provider.available)
  const defaultProvider = settingsDraft?.selectedAiProvider ?? 'codex_cli'
  const defaultProviderStatus = providerOptions.find((provider) => provider.id === defaultProvider) ?? null
  const defaultProviderAvailable = defaultProviderStatus?.available === true
  const defaultProviderUnavailable = providerStatusLoaded && !defaultProviderAvailable
  const providerSelectDisabled = providerStatusLoaded && availableProviderOptions.length === 0
  const aiDefaultControlsDisabled = providerStatusLoaded && !defaultProviderAvailable
  const defaultModel = settingsDraft ? modelForProvider(settingsDraft, defaultProvider) : 'default'
  const reasoningEffort = settingsDraft?.selectedAiReasoningEffortsByProvider?.[defaultProvider] ?? ''
  const reasoningOptions = reasoningEffortsFor(defaultProviderStatus)

  function updateDefaultProvider(provider: AiProvider) {
    if (!settingsDraft) return
    if (providerStatusLoaded && !availableProviderOptions.some((option) => option.id === provider)) return
    const model = modelForProvider(settingsDraft, provider)
    updateSettingsDraft({
      selectedAiProvider: provider,
      selectedAiModel: model,
    })
  }

  function updateDefaultModel(model: string) {
    if (!settingsDraft) return
    if (aiDefaultControlsDisabled) return
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
    if (aiDefaultControlsDisabled) return
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
          <div className="settings-section-heading">
            <h2>Provider readiness</h2>
            <button className="secondary-button compact-button" type="button" disabled={busyAction !== null} onClick={() => void onRefreshProviderStatus()}>
              {busyAction === 'refresh-providers' ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
              Refresh
            </button>
          </div>
          <div className="provider-lines">
            {providerStatus?.providers.map((provider) => (
              <article key={provider.id}>
                <ProviderGlyph provider={provider.id} />
                <div>
                  <strong>{provider.label}</strong>
                  <p>{provider.reason}</p>
                  {provider.executablePath ? <code title={provider.executablePath}>{provider.executablePath}</code> : null}
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
                <select
                  aria-label="Default AI provider"
                  value={defaultProvider}
                  disabled={providerSelectDisabled}
                  onChange={(event) => updateDefaultProvider(event.target.value as AiProvider)}
                >
                  {!providerStatusLoaded ? <option value={defaultProvider}>{defaultProviderLabel(defaultProvider)}</option> : null}
                  {defaultProviderUnavailable ? (
                    <option value={defaultProvider} disabled>
                      {defaultProviderLabel(defaultProvider, defaultProviderStatus)} (unavailable)
                    </option>
                  ) : null}
                  {availableProviderOptions.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <ModelCombobox models={defaultProviderStatus?.models ?? []} value={defaultModel} disabled={aiDefaultControlsDisabled} onChange={updateDefaultModel} />
              <label className="select-shell">
                <span>Reasoning</span>
                <select value={reasoningEffort} disabled={aiDefaultControlsDisabled} onChange={(event) => updateReasoningEffort(event.target.value)}>
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
            <h2>Global AI instructions</h2>
            <p className="settings-note">Keep these neutral across summaries, findings, and testware. Output shape belongs in the action templates below.</p>
            <textarea value={settingsDraft.generationSystemPrompt} onChange={(event) => updateSettingsDraft({ generationSystemPrompt: event.target.value })} />
          </section>
        ) : null}

        <section className="wide-setting advanced-setting">
          <details>
            <summary>Output templates</summary>
            <TemplatesView settingsDraft={settingsDraft} updateSettingsDraft={updateSettingsDraft} />
          </details>
        </section>
      </div>
    </section>
  )
}

function defaultProviderLabel(defaultProvider: AiProvider, providerStatus?: ProviderStatus['providers'][number] | null): string {
  if (providerStatus) return providerStatus.label
  if (defaultProvider === 'claude_code') return 'Claude Code'
  if (defaultProvider === 'copilot_cli') return 'GitHub Copilot CLI'
  return 'Codex CLI'
}

function reasoningLabel(effort: string): string {
  if (effort === 'xhigh') return 'Extra high'
  return effort.charAt(0).toUpperCase() + effort.slice(1)
}
