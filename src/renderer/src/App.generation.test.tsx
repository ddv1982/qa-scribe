// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import {
  baseEntry,
  baseSession,
  claudeAvailable,
  codexAvailable,
  codexWithModelSpecificReasoning,
  copilotAvailable,
  createSnapshot,
  descriptorOnlyReasoning,
  installQaScribeApi,
  providerStatus,
  setupAppTestHooks
} from './test/appTestHelpers'

describe('App provider controls', () => {
  setupAppTestHooks()

  it('keeps Markdown and JSON export available from the secondary Session menu', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    const writeText = vi.fn(async () => undefined)
    vi.mocked(api.exportSession).mockImplementation(async (_id, format) => ({ format, content: `${format} export` }))
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Session' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Session', { selector: 'summary' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))

    await waitFor(() => expect(api.exportSession).toHaveBeenCalledTimes(2))
    expect(api.exportSession).toHaveBeenCalledWith(snapshot.session.id, 'markdown')
    expect(api.exportSession).toHaveBeenCalledWith(snapshot.session.id, 'json')
    expect(writeText).toHaveBeenCalledWith('markdown export')
    expect(writeText).toHaveBeenCalledWith('json export')
  })

  it('shows only available providers as selectable and waits for explicit Generate', async () => {
    const snapshot = createSnapshot({
      entries: [baseEntry()],
      session: {
        ...baseSession(),
        title: 'Checkout smoke',
        testTarget: 'Checkout',
        charter: 'Verify checkout completion'
      }
    })
    const api = installQaScribeApi(
      snapshot,
      providerStatus([
        descriptorOnlyReasoning(claudeAvailable()),
        codexAvailable(),
        copilotAvailable()
      ])
    )

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Checkout smoke' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Generate Testware/i }))
    fireEvent.click(await screen.findByText('Provider settings'))

    const providerSelect = (await screen.findByLabelText('Provider (required)')) as HTMLSelectElement
    await waitFor(() => expect(providerSelect).toHaveValue('claude_code'))
    expect(within(providerSelect).getByRole('option', { name: 'Claude Code' })).toBeInTheDocument()
    expect(within(providerSelect).getByRole('option', { name: 'Codex CLI' })).toBeInTheDocument()
    expect(within(providerSelect).getByRole('option', { name: 'GitHub Copilot CLI' })).toBeInTheDocument()
    expect(within(providerSelect).queryByRole('option', { name: 'Apple Intelligence' })).not.toBeInTheDocument()
    expect(api.createGenerationContext).toHaveBeenCalledTimes(1)
    expect(api.generateTestware).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /^Generate$/ }))

    await waitFor(() =>
      expect(api.generateTestware).toHaveBeenCalledWith('context-1', {
        provider: 'claude_code',
        model: 'sonnet',
        reasoningEffort: 'medium'
      })
    )
    expect(await screen.findByTestId('draft-markdown-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Session Report', level: 1 })).toBeInTheDocument()
  })

  it('updates reasoning choices when the selected model has model-specific capabilities', async () => {
    const snapshot = createSnapshot({
      entries: [baseEntry()],
      session: {
        ...baseSession(),
        title: 'Model-specific reasoning',
        testTarget: 'Checkout',
        charter: 'Verify model-specific provider options'
      }
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexWithModelSpecificReasoning()]))

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Generate Testware/i }))
    fireEvent.click(await screen.findByText('Provider settings'))
    const modelSelect = (await screen.findByLabelText('Model (optional)')) as HTMLSelectElement
    const reasoningSelect = (await screen.findByLabelText('Reasoning (optional)')) as HTMLSelectElement

    expect(within(modelSelect).getByRole('option', { name: 'GPT-5 mini' })).toBeInTheDocument()
    expect(reasoningSelect).toHaveValue('high')
    fireEvent.change(modelSelect, { target: { value: 'gpt-5-mini' } })

    await waitFor(() => expect(reasoningSelect).toHaveValue('low'))
    expect(within(reasoningSelect).queryByRole('option', { name: 'Extra high' })).not.toBeInTheDocument()
    fireEvent.change(reasoningSelect, { target: { value: '' } })
    expect(reasoningSelect).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: /^Generate$/ }))

    await waitFor(() =>
      expect(api.generateTestware).toHaveBeenCalledWith('context-1', {
        provider: 'codex_cli',
        model: 'gpt-5-mini',
        reasoningEffort: null
      })
    )
  })
})
