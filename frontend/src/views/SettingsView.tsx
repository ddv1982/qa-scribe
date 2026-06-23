import { Moon, Sun } from 'lucide-react'
import { SaveSettingsButton } from '../components/Common'
import { ProviderGlyph } from '../components/ModelSelector'
import type { AppSettings, ProviderStatus } from '../tauri'
import type { BusyAction, SettingsSaveState, ThemePreference } from '../ui/types'

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
          <div className="theme-toggle" role="group" aria-label="Theme">
            <button className={theme === 'light' ? 'active' : ''} type="button" onClick={() => setTheme('light')}>
              <Sun size={15} />
              Light
            </button>
            <button className={theme === 'dark' ? 'active' : ''} type="button" onClick={() => setTheme('dark')}>
              <Moon size={15} />
              Dark
            </button>
          </div>
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
          <section className="wide-setting">
            <h2>Generation prompt</h2>
            <textarea value={settingsDraft.generationSystemPrompt} onChange={(event) => updateSettingsDraft({ generationSystemPrompt: event.target.value })} />
          </section>
        ) : null}
      </div>
    </section>
  )
}
