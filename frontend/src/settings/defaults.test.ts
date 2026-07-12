import { describe, expect, it } from 'vitest'
import { effectiveSelection, reasoningOverrideForProvider } from './defaults'
import { providerStatusFixture, settingsFixture } from '../test/fixtures'

describe('effectiveSelection', () => {
  it('inherits visible CLI defaults when overrides are empty', () => {
    const provider = providerStatusFixture().providers[0]

    expect(effectiveSelection(settingsFixture(), provider)).toEqual({
      model: 'gpt-5.5',
      reasoning: 'medium',
      warning: null,
    })
  })

  it('does not turn a discovered CLI reasoning default into a QA Scribe override', () => {
    const settings = settingsFixture()

    expect(effectiveSelection(settings, providerStatusFixture().providers[0]).reasoning).toBe('medium')
    expect(reasoningOverrideForProvider(settings, 'codex_cli')).toBeNull()
  })

  it('keeps model and reasoning overrides independent and warns on incompatibility', () => {
    const provider = providerStatusFixture().providers[0]
    provider.models.push({
      id: 'custom-model',
      label: 'Custom model',
      description: null,
      source: 'detected',
      isDefault: false,
      reasoningEfforts: ['low'],
      defaultReasoningEffort: 'low',
    })
    const settings = settingsFixture({
      selectedAiModel: 'custom-model',
      selectedAiModelsByProvider: { codex_cli: 'custom-model' },
    })

    expect(effectiveSelection(settings, provider)).toEqual({
      model: 'custom-model',
      reasoning: 'medium',
      warning: 'Reasoning “medium” is not advertised for custom-model. Choose a compatible value before generation.',
    })
  })
})
