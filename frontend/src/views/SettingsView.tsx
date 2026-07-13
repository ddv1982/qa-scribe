import { AlertCircle, ArrowLeft, BrainCircuit, CheckCircle2, Clock3, Cpu, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { SaveSettingsButton } from '../components/Common'
import { ModelCombobox, ProviderGlyph } from '../components/ModelSelector'
import { ThemeToggle } from '../components/ThemeToggle'
import {
  effectiveSelection,
  modelForProvider,
  modelOverrideForProvider,
  originSummary,
  providerModelDefaults,
  providerReasoningDefaults,
  reasoningEffortsFor,
} from '../settings/defaults'
import type { AiProvider, AppSettings, ProviderDefaultOrigin, ProviderDefaultSnapshot, ProviderDiscoveryState, ProviderState, ProviderStatus } from '../tauri'
import type { BusyAction, ProviderDiscoveryUiState, SettingsSaveState, ThemePreference } from '../ui/types'
import { TemplatesView } from './TemplatesView'

export function SettingsView({
  busyAction,
  providerStatus,
  settingsDraft,
  settingsDirty,
  settingsSaveState,
  providerDiscoveryState,
  theme,
  updateSettingsDraft,
  setTheme,
  onSaveSettings,
  onDiscardSettings,
  onRefreshProviderStatus,
  onBack,
}: {
  busyAction: BusyAction | null
  providerStatus: ProviderStatus | null
  settingsDraft: AppSettings | null
  settingsDirty: boolean
  settingsSaveState: SettingsSaveState
  providerDiscoveryState: ProviderDiscoveryUiState
  theme: ThemePreference
  updateSettingsDraft: (patch: Partial<AppSettings>) => void
  setTheme: (theme: ThemePreference) => void
  onSaveSettings: () => Promise<unknown>
  onDiscardSettings: () => void
  onRefreshProviderStatus: () => Promise<void>
  onBack: () => void
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
  const effective = settingsDraft ? effectiveSelection(settingsDraft, defaultProviderStatus) : null
  const snapshot = defaultProviderStatus?.defaultSnapshot ?? null

  function updateDefaultProvider(provider: AiProvider) {
    if (!settingsDraft) return
    if (providerStatusLoaded && !availableProviderOptions.some((option) => option.id === provider)) return
    const model = modelOverrideForProvider(settingsDraft, provider)
    updateSettingsDraft({
      selectedAiProvider: provider,
      selectedAiModel: model,
    })
  }

  function updateDefaultModel(model: string) {
    if (!settingsDraft) return
    if (aiDefaultControlsDisabled) return
    const override = model === 'default' ? null : model
    updateSettingsDraft({
      selectedAiModel: override,
      selectedAiModelsByProvider: {
        ...providerModelDefaults(),
        ...settingsDraft.selectedAiModelsByProvider,
        [defaultProvider]: override,
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
        <div className="settings-title-group">
          <button className="secondary-button compact-button settings-back-button" type="button" onClick={onBack}>
            <ArrowLeft size={15} />
            Back
          </button>
          <div>
            <p className="eyebrow">Settings</p>
            <h1>Preferences</h1>
          </div>
        </div>
        <div className="settings-header-actions">
          {settingsDirty ? (
            <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={onDiscardSettings}>
              <RotateCcw size={15} />
              Discard changes
            </button>
          ) : null}
          <SaveSettingsButton
            label="Save settings"
            busyAction={busyAction}
            disabled={!settingsDraft || !settingsDirty || busyAction !== null}
            state={settingsSaveState}
            onSave={onSaveSettings}
          />
        </div>
      </header>

      <div className="settings-grid">
        {settingsDraft ? (
          <section className="wide-setting ai-execution-settings" id="ai-execution-settings" tabIndex={-1}>
            <div className="settings-section-heading">
              <div>
                <p className="eyebrow">AI</p>
                <h2>Generation defaults</h2>
              </div>
              <button className="secondary-button compact-button" type="button" aria-label="Refresh CLI configuration" title="Refresh CLI configuration" disabled={busyAction !== null} onClick={() => void onRefreshProviderStatus()}>
                {providerDiscoveryState === 'refreshing' ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
                Refresh
              </button>
            </div>

            <div className="ai-execution-grid" role="group" aria-label="AI execution choices">
              <div className="ai-choice-card ai-provider-field">
                <div className="ai-choice-heading">
                  <span className="ai-choice-icon"><ProviderGlyph provider={defaultProvider} /></span>
                  <span>
                    <strong>Provider</strong>
                    <small>CLI runtime</small>
                  </span>
                </div>
                <label className="select-shell ai-choice-control">
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
                <p className="ai-choice-note">
                  <span className={`status-dot ${providerStateClass(defaultProviderStatus?.status)}`} />
                  {defaultProviderStatus ? providerStateLabel(defaultProviderStatus.status) : 'Checking availability'}
                </p>
              </div>

              <div className="ai-execution-field ai-choice-card">
                <ModelCombobox
                  models={defaultProviderStatus?.models ?? []}
                  value={defaultModel}
                  disabled={aiDefaultControlsDisabled}
                  describedBy="model-default-description"
                  providerLabel={defaultProviderLabel(defaultProvider, defaultProviderStatus)}
                  resolvedDefaultModel={snapshot?.model.value ?? null}
                  resolvedDefaultOrigin={originSummary(snapshot?.model.origin ?? null)}
                  onChange={updateDefaultModel}
                />
                <p className="field-description" id="model-default-description">
                  {defaultValueDescription('model', defaultModel !== 'default', snapshot, providerDiscoveryState)}
                </p>
                {modelOverrideForProvider(settingsDraft, defaultProvider) ? (
                  <button className="text-button" type="button" onClick={() => updateDefaultModel('default')}><RotateCcw size={12} /> Reset to CLI default</button>
                ) : null}
              </div>

              <div className="ai-execution-field ai-choice-card">
                <div className="ai-choice-heading">
                  <span className="ai-choice-icon"><BrainCircuit size={17} /></span>
                  <span>
                    <strong>Reasoning</strong>
                    <small>Thinking depth</small>
                  </span>
                </div>
                <label className="select-shell ai-choice-control">
                  <select
                    aria-label="Reasoning"
                    aria-describedby="reasoning-default-description"
                    value={reasoningEffort}
                    disabled={aiDefaultControlsDisabled}
                    onChange={(event) => updateReasoningEffort(event.target.value)}
                  >
                    <option value="">{snapshot?.reasoningEffort.value
                      ? `CLI default · ${snapshot.reasoningEffort.value}`
                      : 'Use model/CLI default'}</option>
                    <option value="model-recommended">Use model recommendation</option>
                    {reasoningOptions.map((effort) => (
                      <option key={effort} value={effort}>
                        {reasoningLabel(effort)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="field-description" id="reasoning-default-description">
                  {defaultValueDescription('reasoning', Boolean(reasoningEffort), snapshot, providerDiscoveryState)}
                </p>
                {reasoningEffort ? (
                  <button className="text-button" type="button" onClick={() => updateReasoningEffort('')}><RotateCcw size={12} /> Reset to CLI default</button>
                ) : null}
              </div>
            </div>

            <div className={`execution-overview ${providerDiscoveryState}`} role="status" aria-live="polite">
              <div className="execution-status-row">
                <span className="execution-status-icon">{discoveryStatusIcon(providerDiscoveryState)}</span>
                <div>
                  <span>CLI status</span>
                  <strong>{discoveryStatusTitle(providerDiscoveryState, snapshot?.state)}</strong>
                </div>
                <p>{discoveryStatusBody(providerDiscoveryState, snapshot)}</p>
              </div>

              {effective ? (
                <div className="execution-run-preview" aria-label={settingsDirty ? 'Preview if saved' : 'Next run'}>
                  <div className="execution-run-heading">
                    <span>{settingsDirty ? 'Preview if saved' : 'Next run'}</span>
                    <strong>{defaultProviderLabel(defaultProvider, defaultProviderStatus)}</strong>
                  </div>
                  <div className="execution-value-list">
                    <span className="execution-value">
                      <Cpu size={16} />
                      <span><small>Model</small><strong>{effective.model}</strong></span>
                    </span>
                    <span className="execution-value">
                      <BrainCircuit size={16} />
                      <span><small>Reasoning</small><strong>{effective.reasoning ?? 'CLI default'}</strong></span>
                    </span>
                  </div>
                  <p>{effective.runtimeSummary}</p>
                  {effective.warning ? <p className="inline-message blocking" role="alert">{effective.warning}</p> : null}
                  {snapshot?.warnings.map((warning) => (
                    <p className={`inline-message ${warning.severity}`} key={warning.code} role={warning.severity === 'blocking' ? 'alert' : 'status'}>
                      {warning.message}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>

            {snapshot ? (
              <details className="cli-details">
                <summary>CLI details</summary>
                <dl>
                  <div><dt>CLI version</dt><dd>{snapshot.cliVersion ?? 'Not reported'}</dd></div>
                  <div><dt>Resolution scope</dt><dd>{snapshot.resolutionScope.label}</dd></div>
                  <div><dt>Checked</dt><dd>{formatCheckedAt(snapshot.checkedAt)}</dd></div>
                  <div><dt>Model source</dt><dd>{technicalOrigin(snapshot.model.origin)}</dd></div>
                  <div><dt>Reasoning source</dt><dd>{technicalOrigin(snapshot.reasoningEffort.origin)}</dd></div>
                </dl>
                {snapshot.error ? <p>{snapshot.error.message}</p> : null}
                <code>{effective ? effectiveCommand(defaultProvider, effective.modelOverride ?? 'default', effective.reasoningOverride) : ''}</code>
              </details>
            ) : null}
          </section>
        ) : null}

        <section id="appearance-settings">
          <h2>Appearance</h2>
          <ThemeToggle theme={theme} onThemeChange={setTheme} />
        </section>

        <section id="provider-readiness-settings">
          <div className="settings-section-heading">
            <h2>Provider readiness</h2>
          </div>
          <div className="provider-lines">
            {providerStatus?.providers.map((provider) => (
              <article key={provider.id}>
                <ProviderGlyph provider={provider.id} />
                <div>
                  <div className="provider-line-heading">
                    <strong>{provider.label}</strong>
                    <span>{providerStateLabel(provider.status)}</span>
                  </div>
                  <p>{provider.reason}</p>
                  {provider.executablePath ? <details><summary>Executable details</summary><code>{provider.executablePath}</code></details> : null}
                </div>
                <span
                  className={`status-dot ${providerStateClass(provider.status)}`}
                  role="img"
                  aria-label={`${provider.label}: ${providerStateLabel(provider.status)}`}
                />
              </article>
            ))}
          </div>
        </section>

        {settingsDraft ? (
          <section className="wide-setting" id="instructions-settings">
            <h2 id="global-ai-instructions-label">Global AI instructions</h2>
            <p className="settings-note" id="global-ai-instructions-note">
              Shared instructions for summaries, Findings, and Testware. Output formatting belongs in the templates below.
            </p>
            <textarea
              aria-describedby="global-ai-instructions-note"
              aria-labelledby="global-ai-instructions-label"
              value={settingsDraft.generationSystemPrompt}
              onChange={(event) => updateSettingsDraft({ generationSystemPrompt: event.target.value })}
            />
          </section>
        ) : null}

        <section className="wide-setting advanced-setting" id="template-settings">
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

function providerStateClass(status?: ProviderState): string {
  if (status === 'ready') return 'ready'
  if (status === 'authRequired') return 'warning'
  if (status === 'error') return 'error'
  return 'unavailable'
}

function providerStateLabel(status: ProviderState): string {
  if (status === 'ready') return 'Ready'
  if (status === 'authRequired') return 'Sign-in needed'
  if (status === 'installRequired') return 'Not installed'
  return 'Needs attention'
}

function effectiveCommand(provider: AiProvider, model: string, reasoning: string | null): string {
  const modelPart = model === 'default' ? '(CLI resolves model)' : model
  if (provider === 'claude_code') return `claude -p · model ${modelPart} · effort ${reasoning ?? '(CLI default)'}`
  if (provider === 'copilot_cli') return `copilot -s --no-ask-user · model ${modelPart}`
  return `codex exec · model ${modelPart} · reasoning ${reasoning ?? '(CLI default)'}`
}

function defaultValueDescription(
  field: 'model' | 'reasoning',
  overridden: boolean,
  snapshot: ProviderDefaultSnapshot | null,
  uiState: ProviderDiscoveryUiState,
): string {
  const observation = field === 'model' ? snapshot?.model : snapshot?.reasoningEffort
  const label = observation?.value
  const source = originSummary(observation?.origin ?? null)
  const detected = label ? `${label}${source ? ` from ${source}` : ''}` : null
  if (overridden) {
    return detected
      ? `Override active · CLI default is ${detected}.`
      : 'Override active · no CLI default detected.'
  }
  if (uiState === 'checking') return 'Checking the CLI default…'
  if (uiState === 'refreshing') {
    return detected
      ? `Refreshing · previously ${detected}.`
      : 'Refreshing the CLI default…'
  }
  if (snapshot?.state === 'stale' && detected) {
    return `Last detected ${detected} · refresh failed.`
  }
  if (detected) return source ? `CLI default from ${source}.` : 'CLI default detected.'
  if (snapshot?.state === 'providerManaged') return 'The CLI chooses this when generation starts.'
  if (snapshot?.state === 'unavailable') return 'Provider unavailable · CLI-default intent preserved.'
  return 'The CLI chooses this at run time; the current value could not be inspected.'
}

function discoveryStatusIcon(state: ProviderDiscoveryUiState) {
  if (state === 'checking' || state === 'refreshing') return <Loader2 className="spin" size={17} />
  if (state === 'ready') return <CheckCircle2 size={17} />
  if (state === 'stale') return <Clock3 size={17} />
  return <AlertCircle size={17} />
}

function discoveryStatusTitle(state: ProviderDiscoveryUiState, snapshotState?: ProviderDiscoveryState): string {
  if (state === 'checking') return 'Checking CLI configuration'
  if (state === 'refreshing') return 'Refreshing CLI configuration'
  if (state === 'stale' || snapshotState === 'stale') return 'Showing the last successful detection'
  if (snapshotState === 'providerManaged') return 'Configuration is provider-managed'
  if (snapshotState === 'unavailable') return 'Provider unavailable'
  if (state === 'error') return 'CLI configuration could not be inspected'
  return 'Configuration detected'
}

function discoveryStatusBody(
  state: ProviderDiscoveryUiState,
  snapshot: ProviderDefaultSnapshot | null,
): string {
  if (state === 'checking') return 'Your saved selection remains active while QA Scribe checks the local CLI.'
  if (state === 'refreshing') return 'The previous observation stays visible until this refresh finishes.'
  if (snapshot?.state === 'stale') {
    return `${formatCheckedAt(snapshot.checkedAt)}. The CLI will still resolve its live configuration when a run starts.`
  }
  if (snapshot?.state === 'providerManaged') return 'No explicit values were exposed. The CLI will choose them when a run starts.'
  if (snapshot?.state === 'unavailable') return snapshot.error?.message ?? 'Set up this provider, then retry discovery.'
  if (snapshot?.state === 'unresolved') return `${snapshot.error?.message ?? 'Inspection failed.'} CLI-default execution remains available once the provider is ready.`
  return `Checked ${formatCheckedAt(snapshot?.checkedAt ?? null)}.`
}

function formatCheckedAt(value: string | null): string {
  if (!value) return 'Not checked yet'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function technicalOrigin(origin: ProviderDefaultOrigin | null): string {
  if (!origin) return 'Not reported'
  return origin.technicalPath ?? origin.displayPath ?? origin.label
}
