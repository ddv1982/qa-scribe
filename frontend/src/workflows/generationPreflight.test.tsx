import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GenerationPreflight } from './generationPreflight'
import { simulateDialogCancel } from '../test/dialogPolyfill'

function renderPreflight(overrides: Partial<Parameters<typeof GenerationPreflight>[0]> = {}) {
  const onCancel = vi.fn()
  const onConfirm = vi.fn()
  render(
    <GenerationPreflight
      action="summary"
      activeProviderAvailable
      activeProviderLabel="Codex CLI"
      isBusy={false}
      noteScreenshotCount={0}
      sessionTitle="Checkout"
      noteWordCount={12}
      selectedModel="default"
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  )
  return { onCancel, onConfirm }
}

describe('GenerationPreflight behavior and modal accessibility', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it.each([
    ['summary', 'Summarize note?'],
    ['testware', 'Generate test cases?'],
  ] as const)('opens %s as a named modal dialog and moves focus into it', (action, title) => {
    renderPreflight({ action })
    const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: title })
    expect(dialog.open).toBe(true)
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  // R3: native X11 f4bd08a2 at rev24 let Tab escape from Generate to BODY.
  it.each([
    ['Tab from the last enabled control', false],
    ['Shift+Tab from the first control', true],
  ] as const)('wraps %s within the Testware dialog', (_boundary, shiftKey) => {
    renderPreflight({ action: 'testware', onConfigureAi: vi.fn() })
    const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: 'Generate test cases?' })
    const controls = within(dialog)
    const first = controls.getByRole<HTMLButtonElement>('button', { name: /^AutoMixed notes/ })
    const last = controls.getByRole<HTMLButtonElement>('button', { name: 'Generate test cases' })
    expect(first.disabled).toBe(false)
    expect(last.disabled).toBe(false)

    const source = shiftKey ? first : last
    const destination = shiftKey ? last : first
    source.focus()
    expect(document.activeElement).toBe(source)

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey,
      bubbles: true,
      cancelable: true,
    })
    fireEvent(source, event)

    expect.soft(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(destination)
  })

  it('the native cancel event (Escape) invokes onCancel', () => {
    const { onCancel, onConfirm } = renderPreflight()
    const dialog = screen.getByRole<HTMLDialogElement>('dialog')
    simulateDialogCancel(dialog)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('blocks generation when provider discovery reports an incompatible default', () => {
    const { onConfirm } = renderPreflight({
      action: 'testware',
      selectionWarning: 'Configured model requires a newer Codex CLI. Upgrade it or choose an override.',
    })

    expect(screen.getByRole('alert').textContent).toContain('requires a newer Codex CLI')
    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Generate test cases' })
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms all default Testware preferences without implicit changes', () => {
    const { onConfirm } = renderPreflight({ action: 'testware' })

    fireEvent.click(screen.getByRole('button', { name: 'Generate test cases' }))

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      technique: 'auto',
      outputFormat: 'qa_cases',
      depth: 'balanced',
      includeNegativeCases: true,
      includeBoundaryCases: true,
      includeTestData: true,
      preserveEvidence: true,
      customInstructions: null,
    })
  })

  it('preserves every changed preference in the exact confirmation payload', () => {
    const { onConfirm } = renderPreflight({ action: 'testware' })
    const rules = screen.getByRole('button', { name: /^RulesBusiness rules/ })
    fireEvent.click(rules)
    expect(rules.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: /^AutoMixed notes/ }).getAttribute('aria-pressed')).toBe('false')

    fireEvent.change(screen.getByRole('combobox', { name: 'Output' }), { target: { value: 'gherkin' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Depth' }), { target: { value: 'thorough' } })
    for (const name of ['Negative cases', 'Boundary cases', 'Test data', 'Preserve evidence']) {
      const checkbox = screen.getByRole<HTMLInputElement>('checkbox', { name })
      expect(checkbox.checked).toBe(true)
      fireEvent.click(checkbox)
      expect(checkbox.checked).toBe(false)
    }
    const guidance = 'Prioritize recovery paths.\nKeep expected results explicit.'
    fireEvent.change(screen.getByRole('textbox', { name: 'Additional guidance' }), { target: { value: guidance } })
    // Revisiting a technique must not reset the other preferences.
    fireEvent.click(screen.getByRole('button', { name: /^BoundariesInputs/ }))
    fireEvent.click(rules)
    fireEvent.click(screen.getByRole('button', { name: 'Generate test cases' }))

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      technique: 'decision_table',
      outputFormat: 'gherkin',
      depth: 'thorough',
      includeNegativeCases: false,
      includeBoundaryCases: false,
      includeTestData: false,
      preserveEvidence: false,
      customInstructions: guidance,
    })
  })

  it('clears guidance back to null and preserves independently re-enabled include options', () => {
    const { onConfirm } = renderPreflight({ action: 'testware' })
    const guidance = screen.getByRole('textbox', { name: 'Additional guidance' })
    fireEvent.change(guidance, { target: { value: 'Check recovery.' } })
    fireEvent.change(guidance, { target: { value: '' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Negative cases' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Test data' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Negative cases' }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate test cases' }))

    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({
      technique: 'auto',
      outputFormat: 'qa_cases',
      depth: 'balanced',
      includeNegativeCases: true,
      includeBoundaryCases: true,
      includeTestData: false,
      preserveEvidence: true,
      customInstructions: null,
    })
  })

  it('shows advisory notices without blocking generation', () => {
    const advisories = ['Provider defaults may have changed.', 'Reasoning will be resolved when generation starts.']
    const { onConfirm } = renderPreflight({ action: 'testware', selectionAdvisories: advisories })

    expect(screen.getAllByRole('status').map((notice) => notice.textContent)).toEqual(advisories)
    expect(screen.queryByRole('alert')).toBeNull()
    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Generate test cases' })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('blocks generation without an available provider but leaves configuration and cancellation available', () => {
    const onConfigureAi = vi.fn()
    const { onCancel, onConfirm } = renderPreflight({ action: 'testware', activeProviderAvailable: false, onConfigureAi })

    const confirm = screen.getByRole<HTMLButtonElement>('button', { name: 'Generate test cases' })
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    fireEvent.click(screen.getByRole('button', { name: 'Configure AI execution…' }))
    expect(onConfigureAi).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('disables all footer actions while busy', () => {
    const onConfigureAi = vi.fn()
    const { onCancel, onConfirm } = renderPreflight({ action: 'testware', isBusy: true, onConfigureAi })

    for (const name of ['Configure AI execution…', 'Cancel', 'Generate test cases']) {
      const button = screen.getByRole<HTMLButtonElement>('button', { name })
      expect(button.disabled).toBe(true)
      fireEvent.click(button)
    }
    expect(onConfigureAi).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('retains long metadata, provenance, execution timestamp, and simultaneous notices', () => {
    const sessionTitle = 'Generic validation session with extended context and recovery scenarios '.repeat(3).trim()
    const model = 'generic-model-with-an-extended-identifier-for-validation'
    const modelPath = '/home/tester/.config/generic-provider/profiles/validation/model-settings.toml'
    const reasoningPath = '/home/tester/validation-session/configuration/reasoning-settings.toml'
    const executionSummary = 'The CLI resolves its live configuration when generation starts. No model override will be passed.'
    const checkedAt = '2026-10-15T09:30:00Z'
    const warning = 'Configured selection is incompatible. Choose a supported model before generation.'
    const advisory = 'Provider discovery used cached metadata. Review the configuration if it changed.'
    renderPreflight({
      action: 'testware', sessionTitle, selectedModel: model, selectedReasoning: 'high',
      noteWordCount: 12345, noteScreenshotCount: 12,
      delegatesModel: true, delegatesReasoning: true,
      modelOrigin: { kind: 'userConfig', label: 'User configuration', displayPath: modelPath },
      reasoningOrigin: { kind: 'projectConfig', label: 'Session configuration', displayPath: reasoningPath },
      executionSummary, checkedAt, selectionWarning: warning, selectionAdvisories: [advisory],
    })

    expect(screen.getByText(sessionTitle)).toBeTruthy()
    expect(screen.getByText('12345 words, 12 screenshots')).toBeTruthy()
    expect(screen.getByText('Codex CLI')).toBeTruthy()
    expect(screen.getByText(model, { exact: false })).toBeTruthy()
    expect(screen.getByText(/^high\b/)).toBeTruthy()
    expect(screen.getAllByText('CLI default')).toHaveLength(2)
    expect(screen.getByText(modelPath)).toBeTruthy()
    expect(screen.getByText(reasoningPath)).toBeTruthy()
    const timestamp = new Date(checkedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    expect(screen.getByText(`${executionSummary} Last checked ${timestamp}.`)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe(warning)
    expect(screen.getByRole('status').textContent).toBe(advisory)
    expect(screen.getByRole('textbox', { name: 'Additional guidance' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it.each([
    ['summary', 'Summarize note'],
    ['finding', 'Create finding'],
  ] as const)('keeps the %s action payload free of Testware preferences', (action, confirmLabel) => {
    const { onConfirm } = renderPreflight({ action })

    expect(screen.queryByRole('group', { name: 'Test design' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Additional guidance' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Configure AI execution…' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: confirmLabel }))
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(undefined)
  })

  it('returns focus to the trigger when the dialog unmounts', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = render(
      <GenerationPreflight
        action="summary"
        activeProviderAvailable
        activeProviderLabel="Codex CLI"
        isBusy={false}
        noteScreenshotCount={0}
        sessionTitle="Checkout"
        noteWordCount={12}
        selectedModel="default"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )
    expect(document.activeElement).not.toBe(trigger)

    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
