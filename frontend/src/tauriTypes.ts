export type AppStatus = {
  name: string
  storageMode: string
  migrationRequired: boolean
  implementedFeatures: string[]
}

export type CommandShellStatus = {
  appDataDir: string
  databaseFilename: string
  nativePermissions: string[]
  activeJobCount: number
  implementedCommands: string[]
  deferredCommands: string[]
}

export type Session = {
  id: string
  title: string
  sessionContext: string | null
  objectiveNotes: string | null
  environment: string | null
  buildVersion: string | null
  relatedReference: string | null
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export type SessionDraft = {
  title: string
  sessionContext?: string | null
  objectiveNotes?: string | null
  environment?: string | null
  buildVersion?: string | null
  relatedReference?: string | null
}

export type SessionPatch = {
  title?: string | null
  sessionContext?: string | null
  objectiveNotes?: string | null
  environment?: string | null
  buildVersion?: string | null
  relatedReference?: string | null
}

export type EntryType = 'note' | 'observation' | 'api_response' | 'log' | 'screenshot' | 'finding_candidate'

export type Entry = {
  id: string
  sessionId: string
  entryType: EntryType
  title: string | null
  body: string
  bodyJson: string | null
  bodyFormat: string | null
  metadataJson: string | null
  excludedFromGeneration: boolean
  createdAt: string
  updatedAt: string
}

export type EntryDraft = {
  sessionId: string
  entryType: EntryType
  title?: string | null
  body: string
  bodyJson?: string | null
  bodyFormat?: string | null
  metadataJson?: string | null
  excludedFromGeneration: boolean
}

export type EntryPatch = {
  title?: string | null
  body?: string | null
  bodyJson?: string | null
  bodyFormat?: string | null
  metadataJson?: string | null
  excludedFromGeneration?: boolean | null
}

export type FindingKind = 'bug' | 'question' | 'risk' | 'follow_up' | 'note'

export type Finding = {
  id: string
  sessionId: string
  title: string
  body: string
  bodyJson: string | null
  bodyFormat: string | null
  kind: FindingKind
  metadataJson: string | null
  createdAt: string
  updatedAt: string
}

export type FindingDraft = {
  sessionId: string
  title: string
  body: string
  bodyJson?: string | null
  bodyFormat?: string | null
  kind: FindingKind
  metadataJson?: string | null
}

export type FindingPatch = {
  title?: string | null
  body?: string | null
  bodyJson?: string | null
  bodyFormat?: string | null
}

export type EvidenceLink = {
  id: string
  findingId: string
  entryId: string | null
  attachmentId: string | null
  createdAt: string
}

export type Attachment = {
  id: string
  sessionId: string
  entryId: string | null
  filename: string
  mimeType: string | null
  sizeBytes: number
  sha256: string
  relativePath: string
  createdAt: string
}

export type GenerationContext = {
  id: string
  sessionId: string
  createdAt: string
}

export type AiProvider = 'claude_code' | 'codex_cli' | 'copilot_cli'

export type ProviderReadinessStatus = 'ready' | 'authRequired' | 'installRequired' | 'error'
export type ProviderModelSource = 'providerDefault' | 'environment' | 'preset' | 'detected'

export type AiRun = {
  id: string
  sessionId: string
  generationContextId: string | null
  provider: AiProvider
  model: string
  reasoningEffort: string | null
  promptVersion: string
  status: 'running' | 'completed' | 'failed'
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export type GenerateSessionReportResult = {
  generationContext: GenerationContext
  aiRun: AiRun
  draft: Draft | null
}

export type Draft = {
  id: string
  sessionId: string
  aiRunId: string | null
  kind: DraftKind
  title: string
  body: string
  bodyJson: string | null
  bodyFormat: string | null
  metadataJson: string | null
  createdAt: string
  updatedAt: string
}

export type DraftKind = 'session_report' | 'testware'

export type DraftPatch = {
  title?: string | null
  body?: string | null
  bodyJson?: string | null
  bodyFormat?: string | null
  metadataJson?: string | null
}

export type AppSettings = {
  schemaVersion: number
  generationSystemPrompt: string
  selectedAiProvider: AiProvider
  selectedAiModel: string
  selectedAiModelsByProvider: Record<AiProvider, string>
  selectedAiReasoningEffortsByProvider: Record<AiProvider, string | null>
  testwareTemplate: string
  findingTemplate: string
  noteSummaryTemplate: string
}

export type ProviderStatus = {
  providers: Array<{
    id: AiProvider
    label: string
    status: ProviderReadinessStatus
    available: boolean
    reason: string
    command: string | null
    executablePath: string | null
    models: ProviderModelDescriptor[]
    localOnly: boolean
  }>
}

export type ProviderModelDescriptor = {
  id: string
  label: string
  description: string | null
  source: ProviderModelSource
  isDefault: boolean
  reasoningEfforts: string[]
}

export type ExportFormat = 'markdown' | 'json'

export type SessionExport = {
  filename: string
  body: string
  format: ExportFormat
}

export type GenerateAiActionKind = 'testware' | 'finding' | 'summary'

export type TestwareTechnique =
  | 'auto'
  | 'use_case'
  | 'equivalence_boundary'
  | 'decision_table'
  | 'state_transition'
  | 'pairwise'
  | 'risk_based'
  | 'exploratory'
  | 'bdd'

export type TestwareOutputFormat = 'qa_cases' | 'checklist' | 'gherkin' | 'charters' | 'coverage_outline'

export type TestwareDepth = 'lean' | 'balanced' | 'thorough'

export type TestwareGenerationPreferences = {
  technique: TestwareTechnique
  outputFormat: TestwareOutputFormat
  depth: TestwareDepth
  includeNegativeCases: boolean
  includeBoundaryCases: boolean
  includeTestData: boolean
  preserveEvidence: boolean
  customInstructions?: string | null
}

export type GenerateAiActionResult = {
  generationContext: GenerationContext
  aiRun: AiRun
  draft: Draft | null
  finding: Finding | null
  noteEntry: Entry | null
}

export type GenerationJobState = 'starting' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled'

export type GenerationJobStatus = {
  jobId: string
  sessionId: string
  action: GenerateAiActionKind
  state: GenerationJobState
  progressMessage: string
  aiRunId: string | null
  errorMessage: string | null
  partialText: string | null
}

export type GenerationJobEvent =
  | {
      type: 'started'
      jobId: string
      status: GenerationJobStatus
      generationContext: GenerationContext
      aiRun: AiRun
    }
  | { type: 'progress'; jobId: string; status: GenerationJobStatus; message: string }
  | { type: 'partial'; jobId: string; status: GenerationJobStatus; body: string }
  | { type: 'completed'; jobId: string; status: GenerationJobStatus; result: GenerateAiActionResult }
  | { type: 'failed'; jobId: string; status: GenerationJobStatus; errorMessage: string; aiRun: AiRun | null }
  | { type: 'cancelled'; jobId: string; status: GenerationJobStatus; aiRun: AiRun | null }

export type StartAiActionJobResult = {
  jobId: string
  status: GenerationJobStatus
}
