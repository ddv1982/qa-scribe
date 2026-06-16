import { contextBridge, ipcRenderer } from 'electron'
import type {
  DraftCreate,
  DraftPatch,
  EntryDraft,
  EntryPatch,
  EvidenceLinkDraft,
  FindingDraft,
  FindingPatch,
  GenerationOptions,
  QaScribeApi,
  SessionDraft,
  SessionPatch
} from '../shared/contracts'

const api: QaScribeApi = {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  createSession: (input: SessionDraft) => ipcRenderer.invoke('sessions:create', input),
  getSession: (id: string) => ipcRenderer.invoke('sessions:get', id),
  updateSession: (id: string, input: SessionPatch) => ipcRenderer.invoke('sessions:update', id, input),
  deleteSession: (id: string) => ipcRenderer.invoke('sessions:delete', id),
  createEntry: (input: EntryDraft) => ipcRenderer.invoke('entries:create', input),
  updateEntry: (id: string, input: EntryPatch) => ipcRenderer.invoke('entries:update', id, input),
  deleteEntry: (id: string) => ipcRenderer.invoke('entries:delete', id),
  importAttachment: (sessionId: string, entryId?: string) => ipcRenderer.invoke('attachments:import', sessionId, entryId),
  importClipboardScreenshot: (sessionId: string, entryId?: string) =>
    ipcRenderer.invoke('attachments:import-clipboard-screenshot', sessionId, entryId),
  getAttachmentPreviewDataUrl: (id: string) => ipcRenderer.invoke('attachments:preview', id),
  createFinding: (input: FindingDraft) => ipcRenderer.invoke('findings:create', input),
  updateFinding: (id: string, input: FindingPatch) => ipcRenderer.invoke('findings:update', id, input),
  deleteFinding: (id: string) => ipcRenderer.invoke('findings:delete', id),
  createEvidenceLink: (input: EvidenceLinkDraft) => ipcRenderer.invoke('evidence-links:create', input),
  deleteEvidenceLink: (id: string) => ipcRenderer.invoke('evidence-links:delete', id),
  listDrafts: (sessionId: string) => ipcRenderer.invoke('drafts:list', sessionId),
  createDraft: (input: DraftCreate) => ipcRenderer.invoke('drafts:create', input),
  updateDraft: (id: string, input: DraftPatch) => ipcRenderer.invoke('drafts:update', id, input),
  deleteDraft: (id: string) => ipcRenderer.invoke('drafts:delete', id),
  createGenerationContext: (sessionId: string) => ipcRenderer.invoke('generation-contexts:create', sessionId),
  updateGenerationContextEntry: (contextId: string, entryId: string, included: boolean) =>
    ipcRenderer.invoke('generation-contexts:update-entry', contextId, entryId, included),
  updateGenerationContextAttachment: (contextId: string, attachmentId: string, included: boolean) =>
    ipcRenderer.invoke('generation-contexts:update-attachment', contextId, attachmentId, included),
  generateTestware: (contextId: string, options?: GenerationOptions) =>
    ipcRenderer.invoke('generation:run', contextId, options),
  exportSession: (id: string, format: 'markdown' | 'json') => ipcRenderer.invoke('sessions:export', id, format),
  getProviderStatus: () => ipcRenderer.invoke('ai:provider-status')
}

contextBridge.exposeInMainWorld('qaScribe', api)
