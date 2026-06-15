// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type {
  AiRun,
  Draft,
  Entry,
  Finding as StoredFinding,
  GenerationContextReview,
  GenerationResult,
  ProviderStatus,
  QaScribeApi,
  Session,
  SessionSnapshot
} from '../../shared/contracts'

describe('App Session setup and provider controls', () => {
  beforeEach(() => {
    installLocalStorage()
    installBrowserLayoutMocks()
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('blocks Generation Context creation when required Session fields are missing', async () => {
    const snapshot = createSnapshot({
      session: {
        ...baseSession(),
        title: 'Incomplete checkout',
        testTarget: null,
        charter: null
      }
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Incomplete checkout' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title (required)')).toBeInTheDocument()
    expect(screen.getByLabelText('Test Target (required)')).toBeInTheDocument()
    expect(screen.getByLabelText('Test Objective (required)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Generate Testware/i }))

    expect(await screen.findByText('Test Target is required.')).toBeInTheDocument()
    expect(screen.getByText('Test Objective is required.')).toBeInTheDocument()
    expect(api.createGenerationContext).not.toHaveBeenCalled()
    expect(api.generateTestware).not.toHaveBeenCalled()
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
        appleUnavailable('Apple Intelligence not enabled.'),
        claudeAvailable(),
        codexAvailable()
      ])
    )

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Checkout smoke' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Generate Testware/i }))

    const providerSelect = (await screen.findByLabelText('Provider (required)')) as HTMLSelectElement
    await waitFor(() => expect(providerSelect).toHaveValue('claude_code'))
    expect(within(providerSelect).getByRole('option', { name: 'Claude Code' })).toBeInTheDocument()
    expect(within(providerSelect).getByRole('option', { name: 'Codex CLI' })).toBeInTheDocument()
    expect(within(providerSelect).queryByRole('option', { name: 'Apple Intelligence' })).not.toBeInTheDocument()
    expect(screen.getByText('Apple Intelligence: Apple Intelligence not enabled.')).toBeInTheDocument()
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
  })

  it('keeps optional Session metadata behind an optional details disclosure', async () => {
    const snapshot = createSnapshot({
      session: {
        ...baseSession(),
        title: 'Checkout smoke',
        testTarget: 'Checkout',
        charter: 'Verify checkout completion'
      }
    })
    installQaScribeApi(snapshot, providerStatus([codexAvailable()]))

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Checkout smoke' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('Optional details'))

    expect(screen.getByLabelText('Environment (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Build (optional)')).toBeInTheDocument()
    expect(screen.getByLabelText('Related Reference (optional)')).toBeInTheDocument()
  })

  it('creates a structured Finding from the capture composer with selected Entry evidence', async () => {
    const snapshot = createSnapshot({
      entries: [baseEntry()],
      session: {
        ...baseSession(),
        title: 'Checkout finding',
        environment: 'Staging',
        buildVersion: '2026.06.16'
      }
    })
    const api = installQaScribeApi(snapshot, providerStatus([codexAvailable()]))
    vi.mocked(api.createFinding).mockResolvedValue({
      id: 'finding-1',
      sessionId: snapshot.session.id,
      title: 'Valid card payment fails',
      body: 'Structured finding body',
      kind: 'bug',
      metadataJson: null,
      createdAt: '2026-06-15T00:04:00.000Z',
      updatedAt: '2026-06-15T00:04:00.000Z'
    } satisfies StoredFinding)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Checkout finding' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('heading', { name: 'Checkout completed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finding' }))
    fireEvent.change(screen.getByLabelText('Finding summary (required)'), {
      target: { value: 'Valid card payment fails' }
    })
    fireEvent.change(screen.getByLabelText('Actual result (required)'), {
      target: { value: 'The payment form shows a card error.' }
    })
    fireEvent.change(screen.getByLabelText('Expected result'), {
      target: { value: 'The order should be confirmed.' }
    })
    fireEvent.change(screen.getByLabelText('Steps to reproduce'), {
      target: { value: 'Open checkout\nSubmit valid test card' }
    })
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'major' } })
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'high' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add Finding' }))

    await waitFor(() =>
      expect(api.createFinding).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: snapshot.session.id,
          title: 'Valid card payment fails',
          kind: 'bug',
          entryId: 'entry-1'
        })
      )
    )
    const payload = vi.mocked(api.createFinding).mock.calls[0]?.[0]
    expect(payload?.body).toContain('**Actual Result**')
    expect(payload?.body).toContain('The payment form shows a card error.')
    expect(JSON.parse(payload?.metadataJson ?? '{}')).toEqual(
      expect.objectContaining({
        schema: 'qa-scribe.structured-finding.v1',
        actual: 'The payment form shows a card error.',
        expected: 'The order should be confirmed.',
        steps: ['Open checkout', 'Submit valid test card'],
        severity: 'major',
        priority: 'high',
        environment: 'Staging / 2026.06.16'
      })
    )
  })
})

function installLocalStorage(): void {
  const values = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return values.size
      },
      clear: vi.fn(() => values.clear()),
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => {
        values.delete(key)
      }),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value)
      })
    } satisfies Storage
  })
}

function installBrowserLayoutMocks(): void {
  if (!document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => document.body)
    })
  }
}

function installQaScribeApi(snapshot: SessionSnapshot, status: ProviderStatus): QaScribeApi {
  const review = createGenerationContextReview(snapshot)
  const generated = createGenerationResult(snapshot.session.id)
  const api = {
    listSessions: vi.fn(async () => [snapshot.session]),
    createSession: vi.fn(),
    getSession: vi.fn(async () => snapshot),
    updateSession: vi.fn(async (_id, input) => ({ ...snapshot.session, ...input })),
    deleteSession: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    importAttachment: vi.fn(),
    createFinding: vi.fn(),
    updateFinding: vi.fn(),
    deleteFinding: vi.fn(),
    createEvidenceLink: vi.fn(),
    deleteEvidenceLink: vi.fn(),
    listDrafts: vi.fn(async () => []),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    deleteDraft: vi.fn(),
    createGenerationContext: vi.fn(async () => review),
    updateGenerationContextEntry: vi.fn(async () => review),
    updateGenerationContextAttachment: vi.fn(async () => review),
    generateTestware: vi.fn(async () => generated),
    exportSession: vi.fn(),
    getProviderStatus: vi.fn(async () => status)
  } satisfies QaScribeApi

  window.qaScribe = api
  return api
}

function createSnapshot(input: { session?: Session; entries?: Entry[] } = {}): SessionSnapshot {
  return {
    session: input.session ?? baseSession(),
    entries: input.entries ?? [],
    attachments: [],
    findings: [],
    evidenceLinks: [],
    drafts: [],
    aiRuns: []
  }
}

function baseSession(): Session {
  return {
    id: 'session-1',
    title: 'Session',
    testTarget: 'Checkout',
    charter: 'Verify checkout',
    environment: null,
    buildVersion: null,
    relatedReference: null,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    lastOpenedAt: '2026-06-15T00:00:00.000Z'
  }
}

function baseEntry(): Entry {
  return {
    id: 'entry-1',
    sessionId: 'session-1',
    type: 'note',
    title: 'Checkout completed',
    body: 'Order confirmation displayed.',
    metadataJson: null,
    createdAt: '2026-06-15T00:01:00.000Z',
    updatedAt: '2026-06-15T00:01:00.000Z',
    excludedFromGeneration: false
  }
}

function createGenerationContextReview(snapshot: SessionSnapshot): GenerationContextReview {
  return {
    context: {
      id: 'context-1',
      sessionId: snapshot.session.id,
      createdAt: '2026-06-15T00:02:00.000Z'
    },
    session: snapshot.session,
    entries: snapshot.entries.map((entry) => ({ entry, included: !entry.excludedFromGeneration, attachments: [] })),
    attachments: [],
    findings: []
  }
}

function createGenerationResult(sessionId: string): GenerationResult {
  return {
    aiRun: {
      id: 'run-1',
      sessionId,
      generationContextId: 'context-1',
      provider: 'claude_code',
      model: 'sonnet',
      reasoningEffort: 'medium',
      promptVersion: 'session-report-v1',
      status: 'completed',
      errorMessage: null,
      createdAt: '2026-06-15T00:03:00.000Z',
      completedAt: '2026-06-15T00:03:01.000Z'
    } satisfies AiRun,
    draft: {
      id: 'draft-1',
      sessionId,
      aiRunId: 'run-1',
      kind: 'session_report',
      title: 'Session Report',
      body: '# Session Report',
      createdAt: '2026-06-15T00:03:01.000Z',
      updatedAt: '2026-06-15T00:03:01.000Z'
    } satisfies Draft
  }
}

function providerStatus(providers: ProviderStatus['providers']): ProviderStatus {
  const selected = providers.find((provider) => provider.available)
  return {
    providers,
    selectedProvider: selected?.provider ?? null,
    selectedModel: selected?.defaultModel ?? null,
    selectedReasoningEffort: selected?.defaultReasoningEffort ?? null
  }
}

function appleUnavailable(reason: string): ProviderStatus['providers'][number] {
  return {
    provider: 'apple_intelligence',
    label: 'Apple Intelligence',
    available: false,
    reason,
    models: ['system-language-model'],
    defaultModel: 'system-language-model',
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    localOnly: true,
    requiresNetwork: false
  }
}

function claudeAvailable(): ProviderStatus['providers'][number] {
  return {
    provider: 'claude_code',
    label: 'Claude Code',
    available: true,
    reason: null,
    models: ['sonnet', 'opus'],
    defaultModel: 'sonnet',
    reasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium',
    localOnly: true,
    requiresNetwork: true
  }
}

function codexAvailable(): ProviderStatus['providers'][number] {
  return {
    provider: 'codex_cli',
    label: 'Codex CLI',
    available: true,
    reason: null,
    models: ['gpt-5.5'],
    defaultModel: 'gpt-5.5',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'high',
    localOnly: true,
    requiresNetwork: true
  }
}
