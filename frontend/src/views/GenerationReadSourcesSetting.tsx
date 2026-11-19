import type { AppSettings, GenerationReadSource } from '../tauri'

const readSourceOptions: ReadonlyArray<{ source: GenerationReadSource, label: string }> = [
  { source: 'jira', label: 'Jira issues' },
  { source: 'confluence', label: 'Confluence pages' },
  { source: 'teamsChannels', label: 'Teams channels' },
  { source: 'teamsChats', label: 'Teams chats' },
]

/** Opt-in read-only lookups for Generate. Generate has no tools otherwise. */
export function GenerationReadSourcesSetting({ settingsDraft, updateSettingsDraft }: {
  settingsDraft: AppSettings
  updateSettingsDraft: (patch: Partial<AppSettings>) => void
}) {
  const selected = new Set(settingsDraft.generationReadSources ?? [])

  function toggle(source: GenerationReadSource, enabled: boolean) {
    const next = new Set(selected)
    if (enabled) next.add(source)
    else next.delete(source)
    updateSettingsDraft({ generationReadSources: readSourceOptions.map(option => option.source).filter(option => next.has(option)) })
  }

  return (
    <section className="wide-setting" id="generation-read-sources-settings">
      <fieldset className="read-source-fieldset" aria-describedby="generation-read-sources-note">
        <legend><h2>Generate may read</h2></legend>
        <p className="settings-note" id="generation-read-sources-note">
          Generate, Create Finding and Summarize run without tools. Turn on a source to let them look up items your note refers to, read-only, through the Claude Code Atlassian and Microsoft 365 connectors. Codex and Copilot always run without tools. Teams chats can include private conversations.
        </p>
        <div className="read-source-options">
          {readSourceOptions.map(({ source, label }) => (
            <label key={source} className="read-source-option">
              <input type="checkbox" checked={selected.has(source)} onChange={(event) => toggle(source, event.target.checked)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  )
}
