// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import {
  baseEntry,
  baseImageAttachment,
  baseSession,
  claudeAvailable,
  codexAvailable,
  codexWithModelSpecificReasoning,
  copilotAvailable,
  createSnapshot,
  defaultSettings,
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
    fireEvent.click(screen.getByLabelText('Session actions'))
    fireEvent.click(screen.getByRole('button', { name: 'Export Markdown' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))

    await waitFor(() => expect(api.exportSession).toHaveBeenCalledTimes(2))
    expect(api.exportSession).toHaveBeenCalledWith(snapshot.session.id, 'markdown')
    expect(api.exportSession).toHaveBeenCalledWith(snapshot.session.id, 'json')
    expect(writeText).toHaveBeenCalledWith('markdown export')
    expect(writeText).toHaveBeenCalledWith('json export')
  })

  it('shows only available providers as selectable and waits for explicit Generate', async () => {
    const screenshot = baseImageAttachment()
    const snapshot = createSnapshot({
      entries: [baseEntry()],
      attachments: [screenshot],
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
    vi.mocked(api.getDraftEvidenceAttachments).mockResolvedValue([screenshot])
    vi.mocked(api.getAttachmentPreviewDataUrl).mockResolvedValue('data:image/png;base64,c2NyZWVu')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Checkout smoke' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Generate Testware/i }))

    const providerSelect = (await screen.findByLabelText('Provider (required)')) as HTMLSelectElement
    await waitFor(() => expect(providerSelect).toHaveValue('claude_code'))
    expect(within(providerSelect).getByRole('option', { name: 'Claude Code' })).toBeInTheDocument()
    expect(within(providerSelect).getByRole('option', { name: 'Codex CLI' })).toBeInTheDocument()
    expect(within(providerSelect).getByRole('option', { name: 'GitHub Copilot CLI' })).toBeInTheDocument()
    expect(within(providerSelect).queryByRole('option', { name: 'Apple Intelligence' })).not.toBeInTheDocument()
    expect(api.createGenerationContext).toHaveBeenCalledTimes(1)
    expect(api.generateTestware).not.toHaveBeenCalled()
    expect(await screen.findByText('checkout.png')).toBeInTheDocument()
    expect(screen.getByText('image/png / 1 KB')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Generate Testware' }).at(-1)!)

    await waitFor(() =>
      expect(api.generateTestware).toHaveBeenCalledWith('context-1', {
        provider: 'claude_code',
        model: 'sonnet',
        reasoningEffort: 'medium'
      })
    )
    expect(await screen.findByTestId('draft-report-view')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Generated Testware' })).toBeInTheDocument()
    expect(api.getDraftEvidenceAttachments).toHaveBeenCalledWith('draft-1')
    const preview = await screen.findByRole('img', { name: 'Screenshot preview: checkout.png' })
    expect(preview).toHaveAttribute('src', 'data:image/png;base64,c2NyZWVu')
    fireEvent.click(screen.getByRole('button', { name: 'Copy screenshot: checkout.png' }))

    await waitFor(() => expect(api.copyAttachmentImageToClipboard).toHaveBeenCalledWith(screenshot.id))
    expect(await screen.findByText('Screenshot copied')).toBeInTheDocument()
  })

  it('does not offer settings-disabled providers in generation controls', async () => {
    const snapshot = createSnapshot({
      entries: [baseEntry()],
      session: {
        ...baseSession(),
        title: 'Disabled provider controls',
        testTarget: 'Checkout',
        charter: 'Verify settings-disabled provider filtering'
      }
    })
    installQaScribeApi(
      snapshot,
      providerStatus([
        codexAvailable(),
        {
          ...copilotAvailable(),
          available: false,
          reason: 'GitHub Copilot CLI is disabled in Settings.'
        }
      ])
    )

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Generate Testware/i }))
    const providerSelect = (await screen.findByLabelText('Provider (required)')) as HTMLSelectElement

    expect(within(providerSelect).getByRole('option', { name: 'Codex CLI' })).toBeInTheDocument()
    expect(within(providerSelect).queryByRole('option', { name: 'GitHub Copilot CLI' })).not.toBeInTheDocument()
    expect(await screen.findByText('GitHub Copilot CLI: GitHub Copilot CLI is disabled in Settings.')).toBeInTheDocument()
  })

  it('opens settings and saves provider prompt and template changes', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable(), copilotAvailable()]))
    vi.mocked(api.getSettings).mockResolvedValue(defaultSettings())
    vi.mocked(api.updateSettings).mockImplementation(async (input) => ({
      ...defaultSettings(),
      ...input,
      providers: { ...defaultSettings().providers, ...input.providers },
      generation: { ...defaultSettings().generation, ...input.generation },
      templates: { ...defaultSettings().templates, ...input.templates }
    }))

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Codex CLI'))
    fireEvent.change(screen.getByLabelText('Custom system prompt'), {
      target: { value: 'Use my concise QA voice.' }
    })
    fireEvent.change(screen.getByLabelText('Note title type'), { target: { value: 'textarea' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Note title order' })).getByRole('button', { name: 'Down' }))
    fireEvent.change(screen.getByLabelText('Severity choices'), { target: { value: 'blocker\nminor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled())
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({ codex_cli: false }),
        generation: expect.objectContaining({ systemPrompt: 'Use my concise QA voice.' }),
        templates: expect.objectContaining({
          note: expect.objectContaining({
            fields: expect.arrayContaining([expect.objectContaining({ id: 'title', type: 'textarea' })])
          }),
          finding: expect.objectContaining({
            fields: expect.arrayContaining([expect.objectContaining({ id: 'severity', options: ['blocker', 'minor'] })])
          })
        })
      })
    )
    const savedSettings = vi.mocked(api.updateSettings).mock.calls[0]?.[0]
    expect(savedSettings?.templates?.note?.fields.map((field) => field.id).slice(0, 2)).toEqual(['body', 'title'])
    await waitFor(() => expect(api.getProviderStatus).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Settings saved')).toBeInTheDocument()
  })

  it('shows settings save errors without leaving the settings pane', async () => {
    const snapshot = createSnapshot()
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.updateSettings).mockRejectedValue(new Error('Prompt is required'))

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.change(await screen.findByLabelText('Custom system prompt'), { target: { value: 'Broken prompt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Prompt is required')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
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
    const modelSelect = (await screen.findByLabelText('Model (optional)')) as HTMLSelectElement
    const reasoningSelect = (await screen.findByLabelText('Reasoning (optional)')) as HTMLSelectElement

    expect(within(modelSelect).getByRole('option', { name: 'GPT-5 mini' })).toBeInTheDocument()
    expect(reasoningSelect).toHaveValue('high')
    fireEvent.change(modelSelect, { target: { value: 'gpt-5-mini' } })

    await waitFor(() => expect(reasoningSelect).toHaveValue('low'))
    expect(within(reasoningSelect).queryByRole('option', { name: 'Extra high' })).not.toBeInTheDocument()
    fireEvent.change(reasoningSelect, { target: { value: '' } })
    expect(reasoningSelect).toHaveValue('')

    fireEvent.click(screen.getAllByRole('button', { name: 'Generate Testware' }).at(-1)!)

    await waitFor(() =>
      expect(api.generateTestware).toHaveBeenCalledWith('context-1', {
        provider: 'codex_cli',
        model: 'gpt-5-mini',
        reasoningEffort: null
      })
    )
  })

  it('preserves reviewed generation context after provider failure', async () => {
    const excludedEntry = baseEntry()
    const includedEntry = {
      ...baseEntry(),
      id: 'entry-2',
      title: 'Payment retry observed',
      body: 'Retry completed successfully.'
    }
    const snapshot = createSnapshot({
      entries: [excludedEntry, includedEntry],
      session: {
        ...baseSession(),
        title: 'Generation failure recovery',
        testTarget: 'Checkout',
        charter: 'Verify provider failure recovery'
      }
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    const excludedReview = {
      context: {
        id: 'context-1',
        sessionId: snapshot.session.id,
        createdAt: '2026-06-15T00:02:00.000Z'
      },
      session: snapshot.session,
      entries: [
        { entry: excludedEntry, included: false, attachments: [] },
        { entry: includedEntry, included: true, attachments: [] }
      ],
      attachments: [],
      findings: []
    }
    vi.mocked(api.updateGenerationContextEntry).mockResolvedValue(excludedReview)
    vi.mocked(api.generateTestware).mockRejectedValue(new Error('provider failed'))

    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: /Generate Testware/i }))
    const excludeButtons = await screen.findAllByRole('button', { name: 'Exclude' })
    fireEvent.click(excludeButtons[0]!)
    expect(await screen.findByRole('button', { name: 'Include' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Generate Testware' }).at(-1)!)

    expect(await screen.findByText('provider failed')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Generation Context' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Include' })).toBeInTheDocument()
    expect(api.getSession).toHaveBeenCalledTimes(1)
  })
})
