import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { SettingsView } from './SettingsView'
import { providerDefaultSnapshotFixture, settingsFixture } from '../test/fixtures'
import type { ModelCatalogEntry } from '../components/ModelSelector'
import type { AiProvider, AppSettings, ProviderCatalogRollout, ProviderModelCatalogSnapshot, ProviderStatus } from '../tauri'

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

  it('never renders a local executable path from a legacy provider snapshot', () => {
    const status = providerStatusWith([codexProvider(), claudeProvider(false), copilotProvider(true)])
    const legacyProvider = status.providers[0] as ProviderStatus['providers'][number] & { executablePath?: string }
    legacyProvider.executablePath = '/mock/bin/codex'
    renderSettingsView({
      providerStatus: status,
    })

    expect(screen.queryByText('/mock/bin/codex')).not.toBeInTheDocument()
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
        source: 'cliCatalog',
        availability: 'available',
        confidence: 'authoritative',
      },
    ])
    setCatalogSnapshot(provider, { source: 'cliCatalog', models: providerModels(provider) })
    provider.defaultSnapshot = providerDefaultSnapshotFixture({
      model: {
        value: 'gpt-live',
        resolution: 'configured',
        origin: {
          kind: 'userConfig',
          label: 'User configuration',
          displayPath: '~/.codex/config.toml',
        },
        recommendedValue: 'gpt-live',
      },
    })
    renderSettingsView({ providerStatus: providerStatusWith([provider]) })

    const combobox = screen.getByRole('combobox', { name: 'Model' })
    expect(combobox).toHaveValue('CLI default · GPT Live')
    expect(screen.getByText('1 model available for this account')).toBeInTheDocument()
    expect(screen.getByText(/Available for this account · checked/i)).toBeInTheDocument()

    await user.click(combobox)

    const listbox = screen.getByRole('listbox', { name: /ai models/i })
    expect(screen.getByText('1 model available for this account · custom IDs supported')).toBeInTheDocument()
    expect(within(listbox).getByText('Current: GPT Live · ~/.codex/config.toml')).toBeInTheDocument()
    expect(within(listbox).getByText('Reported by the installed CLI.')).toBeInTheDocument()
    expect(within(listbox).getByText('Account')).toBeInTheDocument()
  })

  it('keeps policy-disabled models visible but unselectable', async () => {
    const user = userEvent.setup()
    const provider = providerDescriptor('copilot_cli', 'GitHub Copilot CLI', true, [
      modelDescriptor('default', 'Use CLI default'),
      { ...modelDescriptor('gpt-account', 'GPT Account'), source: 'cliCatalog', availability: 'available', confidence: 'authoritative' },
      { ...modelDescriptor('gpt-policy', 'GPT Policy'), source: 'cliCatalog', availability: 'policyDisabled', confidence: 'authoritative' },
    ])
    setCatalogSnapshot(provider, { source: 'cliCatalog', models: providerModels(provider) })
    const { updateSettingsDraft } = renderSettingsView({
      settings: settingsFixture({ selectedAiProvider: 'copilot_cli' }),
      providerStatus: providerStatusWith([provider]),
    })

    expect(screen.getByText('1 model available for this account')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Model' }))

    const listbox = screen.getByRole('listbox', { name: /ai models/i })
    const policyOption = within(listbox).getByRole('option', { name: /GPT Policy/i })
    expect(policyOption).toHaveAttribute('aria-disabled', 'true')
    expect(within(policyOption).getByText('Policy')).toBeInTheDocument()
    expect(within(policyOption).getByText('Disabled by account or organization policy.')).toBeInTheDocument()

    await user.click(policyOption)
    expect(updateSettingsDraft).not.toHaveBeenCalled()
  })

  it('distinguishes CLI-recognized and static fallback models from account availability', async () => {
    const user = userEvent.setup()
    const provider = providerDescriptor('claude_code', 'Claude Code', true, [
      modelDescriptor('default', 'Use CLI default'),
      { ...modelDescriptor('opus', 'Opus'), source: 'cliHelp', availability: 'supportedByBinary', confidence: 'heuristic' },
      { ...modelDescriptor('haiku-static', 'Haiku static'), source: 'preset', availability: 'staticHint', confidence: 'static' },
    ])
    setCatalogSnapshot(provider, { source: 'cliHelp', models: providerModels(provider) })
    renderSettingsView({
      settings: settingsFixture({ selectedAiProvider: 'claude_code' }),
      providerStatus: providerStatusWith([provider]),
    })

    expect(screen.getByText('1 model recognized by CLI')).toBeInTheDocument()
    expect(screen.getByText(/Recognized by the installed CLI · checked/i)).toBeInTheDocument()
    expect(screen.queryByText(/available for this account/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    const listbox = screen.getByRole('listbox', { name: /ai models/i })
    expect(within(within(listbox).getByRole('option', { name: /Opus/i })).getByText('CLI')).toBeInTheDocument()
    expect(within(within(listbox).getByRole('option', { name: /Haiku static/i })).getByText('Suggested')).toBeInTheDocument()
  })

  it('preserves an absent custom model as a warning instead of blocking it', () => {
    const provider = providerDescriptor('codex_cli', 'Codex CLI', true, [
      modelDescriptor('default', 'Use CLI default'),
      { ...modelDescriptor('gpt-account', 'GPT Account'), source: 'cliCatalog', availability: 'available', confidence: 'authoritative' },
    ])
    setCatalogSnapshot(provider, { source: 'cliCatalog', models: providerModels(provider) })
    renderSettingsView({
      settings: settingsFixture({
        selectedAiModel: 'gpt-private',
        selectedAiModelsByProvider: { claude_code: null, codex_cli: 'gpt-private', copilot_cli: null },
      }),
      providerStatus: providerStatusWith([provider]),
    })

    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('gpt-private')
    expect(screen.getByText(/Custom model “gpt-private” is not in the current catalog/i)).toBeInTheDocument()
    expect(screen.getByText(/The CLI will validate it at run time/i)).toBeInTheDocument()
  })

  it('uses the backend selector projection during catalog diagnostics', async () => {
    const user = userEvent.setup()
    const provider = providerDescriptor('claude_code', 'Claude Code', true, [
      modelDescriptor('default', 'Use CLI default'),
      { ...modelDescriptor('sonnet-compat', 'Sonnet compatibility'), source: 'preset', availability: 'staticHint', confidence: 'static' },
    ])
    setCatalogSnapshot(provider, {
      source: 'cliCatalog',
      models: [
        modelDescriptor('default', 'Use CLI default'),
        { ...modelDescriptor('opus-account', 'Opus account'), source: 'cliCatalog', availability: 'available', confidence: 'authoritative' },
      ],
    })
    renderSettingsView({
      settings: settingsFixture({ selectedAiProvider: 'claude_code' }),
      providerStatus: providerStatusWith([provider], 'diagnostics'),
    })

    expect(screen.getByText(/Compatibility model choices remain active while catalog diagnostics run/i)).toBeInTheDocument()
    expect(screen.getByText('1 model in static fallback')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Model' }))
    const listbox = screen.getByRole('listbox', { name: /ai models/i })
    expect(within(listbox).getByRole('option', { name: /Sonnet compatibility/i })).toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: /Opus account/i })).not.toBeInTheDocument()
  })

  it('shows sanitized sign-in and network recovery without raw diagnostics', () => {
    const provider = providerDescriptor('copilot_cli', 'GitHub Copilot CLI', true, [modelDescriptor('default', 'Use CLI default')])
    setCatalogSnapshot(provider, {
      state: 'failed',
      error: { code: 'network', message: 'token ghp_secret failed at /Users/private/repository', retryable: true },
      models: [],
    })
    renderSettingsView({
      settings: settingsFixture({ selectedAiProvider: 'copilot_cli' }),
      providerStatus: providerStatusWith([provider]),
    })

    expect(screen.getByText('The account catalog is unavailable. Check sign-in and network access, then retry.')).toBeInTheDocument()
    expect(screen.queryByText(/ghp_secret|\/Users\/private/)).not.toBeInTheDocument()
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

function providerStatusWith(
  providers: ProviderStatus['providers'],
  catalogRollout: ProviderCatalogRollout = 'selector',
): ProviderStatus {
  return { providers, catalogRollout }
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
  models: ModelCatalogEntry[],
): ProviderStatus['providers'][number] {
  return {
    id,
    label,
    status: available ? 'ready' : 'authRequired',
    available,
    reason: available ? `${label} is ready.` : `${label} needs setup.`,
    command: label.toLocaleLowerCase().replaceAll(' ', '-'),
    localOnly: true,
    defaultSnapshot: providerDefaultSnapshotFixture({
      state: 'providerManaged',
      model: { value: null, resolution: 'providerManaged', origin: null, recommendedValue: null },
      reasoningEffort: { value: null, resolution: 'providerManaged', origin: null, recommendedValue: null },
    }),
    models,
    catalogSnapshot: catalogSnapshot({ models }),
  }
}

function modelDescriptor(id: string, label: string, reasoningEfforts: string[] = []): ModelCatalogEntry {
  return {
    id,
    label,
    description: null,
    source: id === 'default' ? 'providerDefault' : 'preset',
    availability: id === 'default' ? 'available' : 'staticHint',
    confidence: id === 'default' ? 'observed' : 'static',
    isDefault: id === 'default',
    reasoningEfforts,
    defaultReasoningEffort: null,
    capabilities: {
      vision: null,
      reasoning: null,
      adaptiveThinking: null,
      fastMode: null,
      autoMode: null,
      contextWindowTokens: null,
      maxOutputTokens: null,
    },
    resolvedModel: null,
  }
}

function setCatalogSnapshot(
  provider: ProviderStatus['providers'][number],
  patch: Partial<ProviderModelCatalogSnapshot> = {},
) {
  provider.catalogSnapshot = catalogSnapshot({
    models: provider.models,
    ...patch,
  })
}

function catalogSnapshot(
  patch: Partial<ProviderModelCatalogSnapshot> = {},
): ProviderModelCatalogSnapshot {
  return {
    state: 'fresh',
    source: 'preset',
    models: [],
    checkedAt: '2026-07-13T10:00:00Z',
    cliVersion: 'test-cli 1.0.0',
    resolutionScope: { kind: 'neutral', label: 'Neutral QA Scribe runtime scope' },
    error: null,
    warnings: [],
    ...patch,
  }
}

function providerModels(provider: ProviderStatus['providers'][number]): ModelCatalogEntry[] {
  return provider.models
}
