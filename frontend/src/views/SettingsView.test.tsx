import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { SettingsView } from './SettingsView'
import { providerDefaultSnapshotFixture, settingsFixture } from '../test/fixtures'
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

  it('moves model options with arrow keys and selects the focused option', async () => {
    const user = userEvent.setup()
    const { updateSettingsDraft } = renderSettingsView({
      providerStatus: providerStatusWith([
        providerDescriptor('codex_cli', 'Codex CLI', true, [modelDescriptor('default', 'Provider default', ['low']), modelDescriptor('gpt-4.1', 'GPT-4.1')]),
      ]),
    })

    const combobox = screen.getByRole('combobox', { name: 'Model' })
    await user.click(combobox)
    expect(combobox).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    const options = within(screen.getByRole('listbox', { name: /ai models/i })).getAllByRole('option')
    expect(combobox).toHaveAttribute('aria-activedescendant', options[0].id)

    await user.keyboard('{ArrowDown}')
    expect(combobox).toHaveAttribute('aria-activedescendant', options[1].id)

    await user.keyboard('{Enter}')

    expect(updateSettingsDraft).toHaveBeenCalledWith(expect.objectContaining({ selectedAiModel: 'gpt-4.1' }))
  })

  it('shows the resolved CLI default and labels a live CLI model catalog', async () => {
    const user = userEvent.setup()
    const provider = providerDescriptor('codex_cli', 'Codex CLI', true, [
      modelDescriptor('default', 'Use CLI default'),
      {
        ...modelDescriptor('gpt-live', 'GPT Live', ['low', 'medium']),
        description: 'Reported by the installed CLI.',
        source: 'detected',
      },
    ])
    provider.defaultSnapshot = providerDefaultSnapshotFixture({
      model: {
        value: 'gpt-live',
        resolution: 'configured',
        origin: {
          kind: 'userConfig',
          label: 'User configuration',
          displayPath: '~/.codex/config.toml',
          technicalPath: '/mock/.codex/config.toml',
        },
        recommendedValue: 'gpt-live',
      },
    })
    renderSettingsView({ providerStatus: providerStatusWith([provider]) })

    const combobox = screen.getByRole('combobox', { name: 'Model' })
    expect(combobox).toHaveValue('CLI default · GPT Live')
    expect(screen.getByText('1 model from Codex CLI')).toBeInTheDocument()

    await user.click(combobox)

    const listbox = screen.getByRole('listbox', { name: /ai models/i })
    expect(screen.getByText('1 model reported by Codex CLI')).toBeInTheDocument()
    expect(within(listbox).getByText('Current: GPT Live · ~/.codex/config.toml')).toBeInTheDocument()
    expect(within(listbox).getByText('Reported by the installed CLI.')).toBeInTheDocument()
  })

  it('renders a fixed status dot for every provider state', () => {
    const ready = codexProvider()
    const authRequired = claudeProvider(false)
    const installRequired = { ...copilotProvider(false), status: 'installRequired' as const }
    renderSettingsView({ providerStatus: providerStatusWith([ready, authRequired, installRequired]) })

    expect(screen.getByRole('img', { name: 'Codex CLI: Ready' })).toHaveClass('status-dot', 'ready')
    expect(screen.getByRole('img', { name: 'Claude Code: Sign-in needed' })).toHaveClass('status-dot', 'warning')
    expect(screen.getByRole('img', { name: 'GitHub Copilot CLI: Not installed' })).toHaveClass('status-dot', 'unavailable')
  })

  it('groups the three execution choices and presents the resolved next run as distinct values', () => {
    const detectedProvider = {
      ...codexProvider(),
      defaultSnapshot: providerDefaultSnapshotFixture(),
    }
    renderSettingsView({ providerStatus: providerStatusWith([detectedProvider]) })

    const choices = screen.getByRole('group', { name: 'AI execution choices' })
    expect(within(choices).getByText('Provider')).toBeInTheDocument()
    expect(within(choices).getByText('Model')).toBeInTheDocument()
    expect(within(choices).getByText('Reasoning')).toBeInTheDocument()

    const nextRun = screen.getByLabelText('Next run')
    expect(within(nextRun).getByText('Codex CLI')).toBeInTheDocument()
    expect(within(nextRun).getByText('gpt-5.5')).toBeInTheDocument()
    expect(within(nextRun).getByText('medium')).toBeInTheDocument()
  })

  it('disables AI default controls when no providers are available', () => {
    renderSettingsView({
      providerStatus: providerStatusWith([codexProvider(false), claudeProvider(false), copilotProvider(false)]),
    })

    const providerSelect = screen.getByLabelText('Default AI provider')
    expect(providerSelect).toBeDisabled()
    expect(within(providerSelect).getByRole('option', { name: 'Codex CLI (unavailable)' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled()
    expect(screen.getByLabelText('Reasoning')).toBeDisabled()
  })

  it('labels the global AI instructions textarea', () => {
    renderSettingsView()

    const textarea = screen.getByRole('textbox', { name: 'Global AI instructions' })

    expect(textarea).toHaveAccessibleDescription(/Shared instructions for summaries, Findings, and Testware/i)
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
      providerDiscoveryState="ready"
      settingsDraft={settingsDraft}
      settingsDirty={false}
      settingsSaveState="idle"
      theme="system"
      updateSettingsDraft={updateSettingsDraft}
      setTheme={vi.fn()}
      onSaveSettings={vi.fn()}
      onDiscardSettings={vi.fn()}
      onRefreshProviderStatus={vi.fn()}
      onBack={vi.fn()}
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
    defaultSnapshot: providerDefaultSnapshotFixture({
      state: 'providerManaged',
      model: { value: null, resolution: 'providerManaged', origin: null, recommendedValue: null },
      reasoningEffort: { value: null, resolution: 'providerManaged', origin: null, recommendedValue: null },
    }),
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
    defaultReasoningEffort: null,
  }
}
