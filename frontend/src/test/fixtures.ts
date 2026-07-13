import type { AppSettings, Draft, Entry, Finding, GenerationJobStatus, ProviderDefaultSnapshot, ProviderStatus, Session } from '../tauri'

const now = '2026-06-24T10:00:00.000Z'

export function sessionFixture(patch: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: 'Checkout session',
    sessionContext: null,
    objectiveNotes: null,
    environment: null,
    buildVersion: null,
    relatedReference: null,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    ...patch,
  }
}

export function entryFixture(patch: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-1',
    sessionId: 'session-1',
    entryType: 'note',
    title: 'Note body',
    body: '<p>Checkout fails after payment.</p>',
    bodyJson: null,
    bodyFormat: 'html',
    metadataJson: null,
    excludedFromGeneration: false,
    createdAt: now,
    updatedAt: now,
    ...patch,
  }
}

export function draftFixture(patch: Partial<Draft> = {}): Draft {
  return {
    id: 'draft-1',
    sessionId: 'session-1',
    aiRunId: null,
    kind: 'testware',
    title: 'Checkout test cases',
    body: '<ol><li>Submit payment.</li></ol>',
    bodyJson: null,
    bodyFormat: 'html',
    metadataJson: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  }
}

export function findingFixture(patch: Partial<Finding> = {}): Finding {
  return {
    id: 'finding-1',
    sessionId: 'session-1',
    title: 'Checkout returns 500',
    body: '<p>Payment submission returns a server error.</p>',
    bodyJson: null,
    bodyFormat: 'html',
    kind: 'bug',
    metadataJson: null,
    createdAt: now,
    updatedAt: now,
    ...patch,
  }
}

export function settingsFixture(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    schemaVersion: 1,
    generationSystemPrompt: 'Use the selected note material to complete the requested QA action. Do not invent facts.',
    selectedAiProvider: 'codex_cli',
    selectedAiModel: null,
    selectedAiModelsByProvider: {
      claude_code: null,
      codex_cli: null,
      copilot_cli: null,
    },
    selectedAiReasoningEffortsByProvider: {
      claude_code: null,
      codex_cli: null,
      copilot_cli: null,
    },
    testwareTemplate: 'Create test scenarios with test cases from the selected note only.',
    findingTemplate: 'Create exactly one QA finding from the selected note only.',
    noteSummaryTemplate: 'Summarize and clarify the selected note without turning it into a finding or testware.',
    ...patch,
  }
}

export function providerStatusFixture(): ProviderStatus {
  return {
    providers: [
      {
        id: 'codex_cli',
        label: 'Codex CLI',
        status: 'ready',
        available: true,
        reason: 'Codex CLI is installed and authenticated.',
        command: 'codex',
        executablePath: '/mock/bin/codex',
        localOnly: true,
        defaultSnapshot: providerDefaultSnapshotFixture(),
        models: [
          {
            id: 'default',
            label: 'Provider default',
            description: null,
            source: 'providerDefault',
            isDefault: true,
            reasoningEfforts: ['low'],
            defaultReasoningEffort: null,
          },
        ],
      },
    ],
  }
}

export function providerDefaultSnapshotFixture(patch: Partial<ProviderDefaultSnapshot> = {}): ProviderDefaultSnapshot {
  return {
    state: 'detected',
    model: {
      value: 'gpt-5.5',
      resolution: 'configured',
      origin: {
        kind: 'userConfig',
        label: 'User configuration',
        displayPath: '~/.codex/config.toml',
        technicalPath: '/mock/.codex/config.toml',
      },
      recommendedValue: 'gpt-5.5',
    },
    reasoningEffort: {
      value: 'medium',
      resolution: 'configured',
      origin: {
        kind: 'userConfig',
        label: 'User configuration',
        displayPath: '~/.codex/config.toml',
        technicalPath: '/mock/.codex/config.toml',
      },
      recommendedValue: 'medium',
    },
    checkedAt: now,
    cliVersion: 'codex-cli 0.144.1',
    resolutionScope: { kind: 'neutral', label: 'Neutral QA Scribe runtime scope' },
    error: null,
    warnings: [],
    ...patch,
  }
}

export function generationStatusFixture(patch: Partial<GenerationJobStatus> = {}): GenerationJobStatus {
  return {
    jobId: 'job-1',
    sessionId: 'session-1',
    action: 'testware',
    state: 'running',
    progressMessage: 'Generating',
    aiRunId: null,
    errorMessage: null,
    partialText: null,
    ...patch,
  }
}
