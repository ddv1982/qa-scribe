import { Channel } from '@tauri-apps/api/core'

import {
  commands,
  type AiProvider,
  type AppSettings,
  type Attachment,
  type Draft,
  type DraftLibraryItem,
  type DraftKind,
  type DraftPatch,
  type Entry,
  type EntryDraft,
  type EntryPatch,
  type Finding,
  type FindingDraft,
  type FindingLibraryItem,
  type FindingPatch,
  type GenerateAiActionKind,
  type GenerationJobEvent,
  type GenerationJobStatus,
  type ProviderStatus,
  type Session,
  type SessionDraft,
  type SessionNoteState,
  type SessionPatch,
  type StartAiActionJobResult,
  type TestwareGenerationPreferences,
} from './bindings'

// Thin, app-facing wrappers over the Rust-generated `commands` (see
// `bindings.ts`). The generated functions already own argument marshalling,
// command names, and — because the builder uses `ErrorHandlingMode::Throw` —
// throwing `CommandError` on rejection, so these wrappers exist only to keep a
// stable, ergonomic call surface for the rest of the app.

export function getSettings(): Promise<AppSettings> {
  return commands.getSettings()
}

export function updateSettings(settings: AppSettings): Promise<AppSettings> {
  return commands.updateSettings(settings)
}

export function listSessions(): Promise<Session[]> {
  return commands.listSessions()
}

export function listRecentSessions(limit: number): Promise<Session[]> {
  return commands.listRecentSessions(limit)
}

export function createSession(draft: SessionDraft): Promise<Session> {
  return commands.createSession(draft)
}

export function reopenSession(id: string): Promise<Session> {
  return commands.reopenSession(id)
}

export function openSessionNoteState(id: string): Promise<SessionNoteState> {
  return commands.openSessionNoteState(id)
}

export function updateSession(id: string, patch: SessionPatch): Promise<Session> {
  return commands.updateSession(id, patch)
}

export function deleteSession(id: string): Promise<void> {
  return commands.deleteSession(id).then(() => undefined)
}

export function createEntry(draft: EntryDraft): Promise<Entry> {
  return commands.createEntry(draft)
}

export function listEntries(sessionId: string): Promise<Entry[]> {
  return commands.listEntries(sessionId)
}

export function updateEntry(id: string, patch: EntryPatch): Promise<Entry> {
  return commands.updateEntry(id, patch)
}

export function createFinding(draft: FindingDraft): Promise<Finding> {
  return commands.createFinding(draft)
}

export function listFindings(sessionId: string): Promise<Finding[]> {
  return commands.listFindings(sessionId)
}

export function listFindingLibrary(): Promise<FindingLibraryItem[]> {
  return commands.listFindingLibrary()
}

export function updateFinding(id: string, patch: FindingPatch): Promise<Finding> {
  return commands.updateFinding(id, patch)
}

export function deleteFinding(id: string): Promise<void> {
  return commands.deleteFinding(id).then(() => undefined)
}

export function importClipboardScreenshot(input: {
  sessionId: string
  entryId: string | null
  filename: string
  dataUrl: string
}): Promise<Attachment> {
  return commands.importClipboardScreenshot(input.sessionId, input.entryId, input.filename, input.dataUrl)
}

export function readClipboardImageDataUrl(): Promise<string | null> {
  return commands.readClipboardImageDataUrl()
}

export function getAttachmentPreviewDataUrl(attachmentId: string): Promise<string | null> {
  return commands.getAttachmentPreviewDataUrl(attachmentId)
}

export function copyAttachmentImageToClipboard(attachmentId: string): Promise<void> {
  return commands.copyAttachmentImageToClipboard(attachmentId).then(() => undefined)
}

export function copyHtmlToClipboard(html: string, altText: string): Promise<void> {
  return commands.copyHtmlToClipboard(html, altText).then(() => undefined)
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
  return commands.createDraft(input)
}

export function listDrafts(sessionId: string): Promise<Draft[]> {
  return commands.listDrafts(sessionId)
}

export function listDraftLibrary(): Promise<DraftLibraryItem[]> {
  return commands.listDraftLibrary()
}

export function updateDraft(id: string, patch: DraftPatch): Promise<Draft> {
  return commands.updateDraft(id, patch)
}

export function deleteDraft(id: string): Promise<void> {
  return commands.deleteDraft(id).then(() => undefined)
}

export function getProviderStatus(): Promise<ProviderStatus> {
  return commands.getProviderStatus()
}

export function refreshProviderStatus(): Promise<ProviderStatus> {
  return commands.refreshProviderStatus()
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
  return commands.startAiActionJob(input, events)
}

export function getAiActionJobStatus(jobId: string): Promise<GenerationJobStatus> {
  return commands.getAiActionJobStatus(jobId)
}

export function listActiveAiActionJobs(): Promise<GenerationJobStatus[]> {
  return commands.listActiveAiActionJobs()
}

export function cancelAiActionJob(jobId: string): Promise<GenerationJobStatus> {
  return commands.cancelAiActionJob(jobId)
}
