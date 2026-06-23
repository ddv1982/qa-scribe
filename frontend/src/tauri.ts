import { invoke } from '@tauri-apps/api/core'

export type AppStatus = {
  name: string
  storageMode: string
  migrationRequired: boolean
  implementedFeatures: string[]
}

export function getAppStatus(): Promise<AppStatus> {
  return invoke<AppStatus>('get_app_status')
}

export type CommandShellStatus = {
  appDataDir: string
  databaseFilename: string
  nativePermissions: string[]
  activeJobCount: number
  grantedPathCount: number
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

export type EntryType = 'note' | 'observation' | 'api_response' | 'log' | 'screenshot' | 'finding_candidate'

export type Entry = {
  id: string
  sessionId: string
  entryType: EntryType
  title: string | null
  body: string
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
  metadataJson?: string | null
  excludedFromGeneration: boolean
}

export type EntryPatch = {
  excludedFromGeneration?: boolean | null
}

export type FindingKind = 'bug' | 'question' | 'risk' | 'follow_up' | 'note'

export type Finding = {
  id: string
  sessionId: string
  title: string
  body: string
  kind: FindingKind
  metadataJson: string | null
  createdAt: string
  updatedAt: string
}

export type FindingDraft = {
  sessionId: string
  title: string
  body: string
  kind: FindingKind
  metadataJson?: string | null
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
  kind: 'session_report'
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

export type DraftPatch = {
  title?: string | null
  body?: string | null
}

export type AppSettings = {
  schemaVersion: number
  generationSystemPrompt: string
}

export type ProviderStatus = {
  providers: Array<{
    id: AiProvider
    label: string
    available: boolean
    reason: string
    localOnly: boolean
  }>
}

export type ExportFormat = 'markdown' | 'json'

export type SessionExport = {
  filename: string
  body: string
  format: ExportFormat
}

export function getCommandShellStatus(): Promise<CommandShellStatus> {
  return invoke<CommandShellStatus>('get_command_shell_status')
}

export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_settings')
}

export function updateSettings(settings: AppSettings): Promise<AppSettings> {
  return invoke<AppSettings>('update_settings', { settings })
}

export function listSessions(): Promise<Session[]> {
  return invoke<Session[]>('list_sessions')
}

export function createSession(draft: SessionDraft): Promise<Session> {
  return invoke<Session>('create_session', { draft })
}

export function reopenSession(id: string): Promise<Session> {
  return invoke<Session>('reopen_session', { id })
}

export function createEntry(draft: EntryDraft): Promise<Entry> {
  return invoke<Entry>('create_entry', { draft })
}

export function listEntries(sessionId: string): Promise<Entry[]> {
  return invoke<Entry[]>('list_entries', { sessionId })
}

export function updateEntry(id: string, patch: EntryPatch): Promise<Entry> {
  return invoke<Entry>('update_entry', { id, patch })
}

export function createFinding(draft: FindingDraft): Promise<Finding> {
  return invoke<Finding>('create_finding', { draft })
}

export function listFindings(sessionId: string): Promise<Finding[]> {
  return invoke<Finding[]>('list_findings', { sessionId })
}

export function createEvidenceLink(input: {
  findingId: string
  entryId?: string | null
  attachmentId?: string | null
}): Promise<EvidenceLink> {
  return invoke<EvidenceLink>('create_evidence_link', {
    draft: { findingId: input.findingId, entryId: input.entryId ?? null, attachmentId: input.attachmentId ?? null },
  })
}

export function importAttachment(input: {
  sessionId: string
  entryId: string | null
  sourcePath: string
}): Promise<Attachment> {
  return invoke<Attachment>('import_attachment', input)
}

export function importClipboardScreenshot(input: {
  sessionId: string
  entryId: string | null
  filename: string
  dataUrl: string
}): Promise<Attachment> {
  return invoke<Attachment>('import_clipboard_screenshot', input)
}

export function listAttachments(sessionId: string): Promise<Attachment[]> {
  return invoke<Attachment[]>('list_attachments', { sessionId })
}

export function getAttachmentPreviewDataUrl(attachmentId: string): Promise<string | null> {
  return invoke<string | null>('get_attachment_preview_data_url', { attachmentId })
}

export function exportSession(sessionId: string, format: ExportFormat): Promise<SessionExport> {
  return invoke<SessionExport>('export_session', { sessionId, format })
}

export function createGenerationContext(sessionId: string): Promise<GenerationContext> {
  return invoke<GenerationContext>('create_generation_context', { sessionId })
}

export function createAiRun(input: {
  sessionId: string
  generationContextId: string | null
  provider: AiProvider
  model: string
  reasoningEffort: string | null
  promptVersion: string
}): Promise<AiRun> {
  return invoke<AiRun>('create_ai_run', { draft: input })
}

export function createDraft(input: {
  sessionId: string
  aiRunId: string | null
  kind: 'session_report'
  title: string
  body: string
}): Promise<Draft> {
  return invoke<Draft>('create_draft', { draft: input })
}

export function listDrafts(sessionId: string): Promise<Draft[]> {
  return invoke<Draft[]>('list_drafts', { sessionId })
}

export function updateDraft(id: string, patch: DraftPatch): Promise<Draft> {
  return invoke<Draft>('update_draft', { id, patch })
}

export function getProviderStatus(): Promise<ProviderStatus> {
  return invoke<ProviderStatus>('get_provider_status')
}

export function generateSessionReport(input: {
  sessionId: string
  provider: AiProvider
  model: string
  reasoningEffort: string | null
}): Promise<GenerateSessionReportResult> {
  return invoke<GenerateSessionReportResult>('generate_session_report', { request: input })
}
