import { Channel, invoke } from '@tauri-apps/api/core'

import type {
  AiProvider,
  AppSettings,
  Attachment,
  Draft,
  DraftKind,
  DraftPatch,
  Entry,
  EntryDraft,
  EntryPatch,
  ExportFormat,
  Finding,
  FindingDraft,
  FindingPatch,
  GenerateAiActionKind,
  GenerationJobEvent,
  GenerationJobStatus,
  ProviderStatus,
  Session,
  SessionDraft,
  SessionExport,
  SessionPatch,
  StartAiActionJobResult,
  TestwareGenerationPreferences,
} from './tauriTypes'

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

export function updateSession(id: string, patch: SessionPatch): Promise<Session> {
  return invoke<Session>('update_session', { id, patch })
}

export function deleteSession(id: string): Promise<void> {
  return invoke<void>('delete_session', { id })
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

export function updateFinding(id: string, patch: FindingPatch): Promise<Finding> {
  return invoke<Finding>('update_finding', { id, patch })
}

export function deleteFinding(id: string): Promise<void> {
  return invoke<void>('delete_finding', { id })
}

export function importClipboardScreenshot(input: {
  sessionId: string
  entryId: string | null
  filename: string
  dataUrl: string
}): Promise<Attachment> {
  return invoke<Attachment>('import_clipboard_screenshot', input)
}

export function readClipboardImageDataUrl(): Promise<string | null> {
  return invoke<string | null>('read_clipboard_image_data_url')
}

export function getAttachmentPreviewDataUrl(attachmentId: string): Promise<string | null> {
  return invoke<string | null>('get_attachment_preview_data_url', { attachmentId })
}

export function copyAttachmentImageToClipboard(attachmentId: string): Promise<void> {
  return invoke<void>('copy_attachment_image_to_clipboard', { attachmentId })
}

export function exportSession(sessionId: string, format: ExportFormat): Promise<SessionExport> {
  return invoke<SessionExport>('export_session', { sessionId, format })
}

export function createDraft(input: {
  sessionId: string
  aiRunId: string | null
  kind: DraftKind
  title: string
  body: string
  bodyJson?: string | null
  bodyFormat?: string | null
  metadataJson?: string | null
}): Promise<Draft> {
  return invoke<Draft>('create_draft', { draft: input })
}

export function listDrafts(sessionId: string): Promise<Draft[]> {
  return invoke<Draft[]>('list_drafts', { sessionId })
}

export function updateDraft(id: string, patch: DraftPatch): Promise<Draft> {
  return invoke<Draft>('update_draft', { id, patch })
}

export function deleteDraft(id: string): Promise<void> {
  return invoke<void>('delete_draft', { id })
}

export function getProviderStatus(): Promise<ProviderStatus> {
  return invoke<ProviderStatus>('get_provider_status')
}

export function refreshProviderStatus(): Promise<ProviderStatus> {
  return invoke<ProviderStatus>('refresh_provider_status')
}

export function startAiActionJob(
  input: {
    sessionId: string
    provider: AiProvider
    model: string
    reasoningEffort: string | null
    action: GenerateAiActionKind
    noteEntryId?: string | null
    testwarePreferences?: TestwareGenerationPreferences | null
  },
  onEvent: (event: GenerationJobEvent) => void,
): Promise<StartAiActionJobResult> {
  const events = new Channel<GenerationJobEvent>(onEvent)
  return invoke<StartAiActionJobResult>('start_ai_action_job', { request: input, events })
}

export function getAiActionJobStatus(jobId: string): Promise<GenerationJobStatus> {
  return invoke<GenerationJobStatus>('get_ai_action_job_status', { jobId })
}

export function cancelAiActionJob(jobId: string): Promise<GenerationJobStatus> {
  return invoke<GenerationJobStatus>('cancel_ai_action_job', { jobId })
}
