import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { SettingsView } from './SettingsView'
import { settingsFixture } from '../test/fixtures'
import type { AiProvider, AppSettings, ProviderModelDescriptor, ProviderStatus } from '../tauri'

describe('SettingsView AI defaults', () => {
  afterEach(() => {
    cleanup()
  })

  it('does not list unavailable providers as selectable AI defaults', () => {
    renderSettingsView({
      providerStatus: providerStatusWith([codexProvider(), claudeProvider(false), copilotProvider(true)]),
    })

    const providerSelect = screen.getByLabelText('Default AI provider')
    expect(within(providerSelect).getByRole('option', { name: 'Codex CLI' })).toBeInTheDocument()
    expect(within(providerSelect).getByRole('option', { name: 'GitHub Copilot CLI' })).toBeInTheDocument()
    expect(within(providerSelect).queryByRole('option', { name: /^Claude Code$/i })).not.toBeInTheDocument()
    expect(screen.getByText('Claude Code')).toBeInTheDocument()
  })

  it('shows the resolved executable path for detected providers', () => {
    renderSettingsView({
      providerStatus: providerStatusWith([codexProvider(), claudeProvider(false), copilotProvider(true)]),
    })

    expect(screen.getByText('/mock/bin/codex')).toBeInTheDocument()
    expect(screen.queryByText('/mock/bin/claude')).not.toBeInTheDocument()
  })

  it('shows an unavailable saved default as a disabled stale option until another provider is selected', async () => {
    const user = userEvent.setup()
    renderSettingsView({
      settings: settingsFixture({ selectedAiProvider: 'claude_code' }),
      providerStatus: providerStatusWith([codexProvider(), claudeProvider(false), copilotProvider(true)]),
    })

    const providerSelect = screen.getByLabelText('Default AI provider')
    const staleOption = within(providerSelect).getByRole('option', { name: 'Claude Code (unavailable)' })
    expect(staleOption).toBeDisabled()
    expect(providerSelect).toHaveValue('claude_code')

    await user.selectOptions(providerSelect, 'codex_cli')

    expect(providerSelect).toHaveValue('codex_cli')
    expect(within(providerSelect).queryByRole('option', { name: /unavailable/i })).not.toBeInTheDocument()
  })

  it('updates the default model when an available provider is selected', async () => {
    const user = userEvent.setup()
    const { updateSettingsDraft } = renderSettingsView({
      settings: settingsFixture({
        selectedAiProvider: 'codex_cli',
        selectedAiModelsByProvider: {
          claude_code: 'sonnet',
          codex_cli: 'default',
          copilot_cli: 'gpt-4.1',
        },
      }),
      providerStatus: providerStatusWith([codexProvider(), claudeProvider(false), copilotProvider(true)]),
    })

    await user.selectOptions(screen.getByLabelText('Default AI provider'), 'copilot_cli')

    expect(updateSettingsDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedAiProvider: 'copilot_cli',
        selectedAiModel: 'gpt-4.1',
      }),
    )
  })

  it('disables AI default controls when no providers are available', () => {
    renderSettingsView({
      providerStatus: providerStatusWith([codexProvider(false), claudeProvider(false), copilotProvider(false)]),
    })

    const providerSelect = screen.getByLabelText('Default AI provider')
    expect(providerSelect).toBeDisabled()
    expect(within(providerSelect).getByRole('option', { name: 'Codex CLI (unavailable)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /model/i })).toBeDisabled()
    expect(screen.getByLabelText('Reasoning')).toBeDisabled()
  })

  it('labels the global AI instructions textarea', () => {
    renderSettingsView()

    const textarea = screen.getByRole('textbox', { name: 'Global AI instructions' })

    expect(textarea).toHaveAccessibleDescription(/Keep these neutral across summaries, findings, and testware/i)
  })
})

function renderSettingsView({
  settings = settingsFixture(),
  providerStatus = providerStatusWith([codexProvider(), claudeProvider(false), copilotProvider(true)]),
}: {
  settings?: AppSettings
  providerStatus?: ProviderStatus
} = {}) {
  const updateSettingsDraft = vi.fn()

  render(<SettingsViewHarness initialSettings={settings} providerStatus={providerStatus} updateSettingsDraftSpy={updateSettingsDraft} />)

  return { updateSettingsDraft }
}

function SettingsViewHarness({
  initialSettings,
  providerStatus,
  updateSettingsDraftSpy,
}: {
  initialSettings: AppSettings
  providerStatus: ProviderStatus
  updateSettingsDraftSpy: (patch: Partial<AppSettings>) => void
}) {
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(initialSettings)

  function updateSettingsDraft(patch: Partial<AppSettings>) {
    updateSettingsDraftSpy(patch)
    setSettingsDraft((previous) => (previous ? { ...previous, ...patch } : previous))
  }

  return (
    <SettingsView
      busyAction={null}
      providerStatus={providerStatus}
      settingsDraft={settingsDraft}
      settingsSaveState="idle"
      theme="system"
      updateSettingsDraft={updateSettingsDraft}
      setTheme={vi.fn()}
      onSaveSettings={vi.fn()}
      onRefreshProviderStatus={vi.fn()}
    />
  )
}

function providerStatusWith(providers: ProviderStatus['providers']): ProviderStatus {
  return { providers }
}

function codexProvider(available = true): ProviderStatus['providers'][number] {
  return providerDescriptor('codex_cli', 'Codex CLI', available, [modelDescriptor('default', 'Provider default', ['low'])])
}

function claudeProvider(available = true): ProviderStatus['providers'][number] {
  return providerDescriptor('claude_code', 'Claude Code', available, [modelDescriptor('sonnet', 'Claude Sonnet', ['medium'])])
}

function copilotProvider(available = true): ProviderStatus['providers'][number] {
  return providerDescriptor('copilot_cli', 'GitHub Copilot CLI', available, [modelDescriptor('gpt-4.1', 'GPT-4.1')])
}

function providerDescriptor(
  id: AiProvider,
  label: string,
  available: boolean,
  models: ProviderModelDescriptor[],
): ProviderStatus['providers'][number] {
  return {
    id,
    label,
    status: available ? 'ready' : 'authRequired',
    available,
    reason: available ? `${label} is ready.` : `${label} needs setup.`,
    command: label.toLocaleLowerCase().replaceAll(' ', '-'),
    executablePath: available ? `/mock/bin/${providerExecutable(id)}` : null,
    localOnly: true,
    models,
  }
}

function providerExecutable(id: AiProvider): string {
  if (id === 'claude_code') return 'claude'
  if (id === 'copilot_cli') return 'copilot'
  return 'codex'
}

function modelDescriptor(id: string, label: string, reasoningEfforts: string[] = []): ProviderModelDescriptor {
  return {
    id,
    label,
    description: null,
    source: id === 'default' ? 'providerDefault' : 'preset',
    isDefault: id === 'default',
    reasoningEfforts,
  }
}
