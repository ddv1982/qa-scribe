import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import type {
  AppSettings,
  AiModelDescriptor,
  AiRun,
  Attachment,
  Draft,
  Entry,
  GenerationContextReview,
  GenerationResult,
  ProviderStatus,
  QaScribeApi,
  Session,
  SessionSnapshot
} from '../../../shared/contracts'
import { defaultAppSettings, defaultReasoningEffortFor, type ProviderCapabilities } from '../../../shared/contracts'

export function setupAppTestHooks(): void {
  beforeEach(() => {
    installLocalStorage()
    installBrowserLayoutMocks()
  })

  afterEach(() => {
    cleanup()
    window.localStorage.clear()
    vi.restoreAllMocks()
  })
}

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

export function installQaScribeApi(snapshot: SessionSnapshot, status: ProviderStatus): QaScribeApi {
  const review = createGenerationContextReview(snapshot)
  const generated = createGenerationResult(snapshot.session.id)
  const api = {
    getSettings: vi.fn(async () => defaultSettings()),
    updateSettings: vi.fn(async (input) => ({
      ...defaultSettings(),
      ...input,
      providers: { ...defaultSettings().providers, ...input.providers },
      generation: { ...defaultSettings().generation, ...input.generation },
      templates: { ...defaultSettings().templates, ...input.templates }
    })),
    listSessions: vi.fn(async () => [snapshot.session]),
    createSession: vi.fn(),
    getSession: vi.fn(async () => snapshot),
    updateSession: vi.fn(async (_id, input) => ({ ...snapshot.session, ...input })),
    deleteSession: vi.fn(),
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
    importAttachment: vi.fn(),
    importClipboardScreenshot: vi.fn(),
    getAttachmentPreviewDataUrl: vi.fn(async () => null),
    copyAttachmentImageToClipboard: vi.fn(async () => true),
    createFinding: vi.fn(),
    updateFinding: vi.fn(),
    deleteFinding: vi.fn(),
    createEvidenceLink: vi.fn(),
    deleteEvidenceLink: vi.fn(),
    listDrafts: vi.fn(async () => []),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    deleteDraft: vi.fn(),
    getDraftEvidenceAttachments: vi.fn(async () => []),
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

export function defaultSettings(): AppSettings {
  return JSON.parse(JSON.stringify(defaultAppSettings)) as AppSettings
}

export function createSnapshot(
  input: {
    session?: Session
    entries?: Entry[]
    attachments?: Attachment[]
    findings?: SessionSnapshot['findings']
    evidenceLinks?: SessionSnapshot['evidenceLinks']
    drafts?: Draft[]
    aiRuns?: AiRun[]
  } = {}
): SessionSnapshot {
  return {
    session: input.session ?? baseSession(),
    entries: input.entries ?? [],
    attachments: input.attachments ?? [],
    findings: input.findings ?? [],
    evidenceLinks: input.evidenceLinks ?? [],
    drafts: input.drafts ?? [],
    aiRuns: input.aiRuns ?? []
  }
}

export function baseImageAttachment(): Attachment {
  return {
    id: 'attachment-1',
    sessionId: 'session-1',
    entryId: 'entry-1',
    filename: 'checkout.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    sha256: 'hash',
    relativePath: 'session-1/attachment-1.png',
    createdAt: '2026-06-15T00:01:30.000Z'
  }
}

export function baseSession(): Session {
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

export function baseEntry(): Entry {
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
    entries: snapshot.entries.map((entry) => ({
      entry,
      included: !entry.excludedFromGeneration,
      attachments: snapshot.attachments.filter((attachment) => attachment.entryId === entry.id)
    })),
    attachments: snapshot.attachments
      .filter((attachment) => attachment.entryId === null)
      .map((attachment) => ({ attachment, included: true })),
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

export function providerStatus(providers: ProviderStatus['providers']): ProviderStatus {
  const selected = providers.find((provider) => provider.available)
  return {
    providers,
    selectedProvider: selected?.provider ?? null,
    selectedModel: selected?.defaultModel ?? null,
    selectedReasoningEffort: selected ? defaultReasoningEffortFor(selected, selected.defaultModel) : null
  }
}

export function descriptorOnlyReasoning(provider: ProviderStatus['providers'][number]): ProviderStatus['providers'][number] {
  return {
    ...provider,
    reasoningEfforts: [],
    defaultReasoningEffort: null
  }
}

export function claudeAvailable(): ProviderStatus['providers'][number] {
  const capabilities = reasoningCapabilities(['low', 'medium', 'high', 'xhigh', 'max'], 'medium')
  return {
    provider: 'claude_code',
    label: 'Claude Code',
    available: true,
    reason: null,
    models: ['sonnet', 'haiku', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
    defaultModel: 'sonnet',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium',
    modelDescriptors: modelDescriptors(['sonnet', 'haiku', 'claude-sonnet-4-6', 'claude-haiku-4-5'], capabilities),
    capabilities,
    localOnly: true,
    requiresNetwork: true
  }
}

export function codexAvailable(): ProviderStatus['providers'][number] {
  const capabilities = reasoningCapabilities(['low', 'medium', 'high', 'xhigh'], 'high')
  return {
    provider: 'codex_cli',
    label: 'Codex CLI',
    available: true,
    reason: null,
    models: ['gpt-5.4'],
    defaultModel: 'gpt-5.4',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    defaultReasoningEffort: 'high',
    modelDescriptors: modelDescriptors(['gpt-5.4'], capabilities),
    capabilities,
    localOnly: true,
    requiresNetwork: true
  }
}

export function codexWithModelSpecificReasoning(): ProviderStatus['providers'][number] {
  const defaultCapabilities = reasoningCapabilities(['low', 'medium', 'high', 'xhigh'], 'high')
  const miniCapabilities = reasoningCapabilities(['low'], 'low')
  return {
    ...codexAvailable(),
    models: ['gpt-5.4', 'gpt-5-mini'],
    modelDescriptors: [
      { id: 'gpt-5.4', label: 'gpt-5.4', capabilities: defaultCapabilities },
      { id: 'gpt-5-mini', label: 'GPT-5 mini', capabilities: miniCapabilities }
    ],
    capabilities: defaultCapabilities
  }
}

export function copilotAvailable(): ProviderStatus['providers'][number] {
  return {
    provider: 'copilot_cli',
    label: 'GitHub Copilot CLI',
    available: true,
    reason: null,
    models: ['auto', 'gpt-5.3-codex', 'gpt-5.2', 'claude-sonnet-4.6', 'claude-haiku-4.5'],
    defaultModel: 'auto',
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    modelDescriptors: modelDescriptors(['auto', 'gpt-5.3-codex', 'gpt-5.2', 'claude-sonnet-4.6', 'claude-haiku-4.5'], { optionDescriptors: [] }),
    capabilities: { optionDescriptors: [] },
    localOnly: true,
    requiresNetwork: true
  }
}

function modelDescriptors(models: string[], capabilities: ProviderCapabilities): AiModelDescriptor[] {
  return models.map((model) => ({ id: model, label: model, capabilities }))
}

function reasoningCapabilities(
  efforts: Array<'low' | 'medium' | 'high' | 'xhigh' | 'max'>,
  defaultValue: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
): ProviderCapabilities {
  return {
    optionDescriptors: [
      {
        id: 'reasoningEffort',
        type: 'select',
        label: 'Reasoning',
        options: efforts.map((effort) => ({ value: effort, label: effort === 'xhigh' ? 'Extra high' : effort[0].toUpperCase() + effort.slice(1) })),
        defaultValue
      }
    ]
  }
}
