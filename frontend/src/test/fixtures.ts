import type { AppSettings, Draft, Entry, Finding, GenerationJobStatus, ProviderStatus, Session } from '../tauri'

const now = '2026-06-24T10:00:00.000Z'

export function sessionFixture(patch: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    title: 'Checkout note',
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
    generationSystemPrompt: 'Use the note to create useful QA output.',
    selectedAiProvider: 'codex_cli',
    selectedAiModel: 'default',
    selectedAiModelsByProvider: {
      claude_code: 'default',
      codex_cli: 'default',
      copilot_cli: 'auto',
    },
    selectedAiReasoningEffortsByProvider: {
      claude_code: 'medium',
      codex_cli: 'low',
      copilot_cli: null,
    },
    testwareTemplate: 'Write test cases.',
    findingTemplate: 'Write a bug finding.',
    noteSummaryTemplate: 'Summarize the note.',
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
        localOnly: true,
        models: [
          {
            id: 'default',
            label: 'Provider default',
            description: null,
            source: 'providerDefault',
            isDefault: true,
            reasoningEfforts: ['low'],
          },
        ],
      },
    ],
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
