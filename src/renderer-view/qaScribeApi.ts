import { Electroview } from 'electrobun/view'
import type {
  AppSettingsPatch,
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
import type { QaScribeRpcSchema } from '../shared/rpc'

const rpc = Electroview.defineRPC<QaScribeRpcSchema>({
  maxRequestTime: Infinity,
  handlers: {
    requests: {},
    messages: {}
  }
})

new Electroview({ rpc })

const api: QaScribeApi = {
  getSettings: () => rpc.request.getSettings(),
  updateSettings: (input: AppSettingsPatch) => rpc.request.updateSettings(input),
  listSessions: () => rpc.request.listSessions(),
  createSession: (input: SessionDraft) => rpc.request.createSession(input),
  getSession: (id: string) => rpc.request.getSession({ id }),
  updateSession: (id: string, input: SessionPatch) => rpc.request.updateSession({ id, input }),
  deleteSession: (id: string) => rpc.request.deleteSession({ id }),
  createEntry: (input: EntryDraft) => rpc.request.createEntry(input),
  updateEntry: (id: string, input: EntryPatch) => rpc.request.updateEntry({ id, input }),
  deleteEntry: (id: string) => rpc.request.deleteEntry({ id }),
  importAttachment: (sessionId: string, entryId?: string) => rpc.request.importAttachment({ sessionId, entryId }),
  importClipboardScreenshot: (sessionId: string, entryId?: string) =>
    rpc.request.importClipboardScreenshot({ sessionId, entryId }),
  getAttachmentPreviewDataUrl: (id: string) => rpc.request.getAttachmentPreviewDataUrl({ id }),
  copyAttachmentImageToClipboard: (id: string) => rpc.request.copyAttachmentImageToClipboard({ id }),
  createFinding: (input: FindingDraft) => rpc.request.createFinding(input),
  updateFinding: (id: string, input: FindingPatch) => rpc.request.updateFinding({ id, input }),
  deleteFinding: (id: string) => rpc.request.deleteFinding({ id }),
  createEvidenceLink: (input: EvidenceLinkDraft) => rpc.request.createEvidenceLink(input),
  deleteEvidenceLink: (id: string) => rpc.request.deleteEvidenceLink({ id }),
  listDrafts: (sessionId: string) => rpc.request.listDrafts({ sessionId }),
  createDraft: (input: DraftCreate) => rpc.request.createDraft(input),
  updateDraft: (id: string, input: DraftPatch) => rpc.request.updateDraft({ id, input }),
  deleteDraft: (id: string) => rpc.request.deleteDraft({ id }),
  getDraftEvidenceAttachments: (id: string) => rpc.request.getDraftEvidenceAttachments({ id }),
  createGenerationContext: (sessionId: string) => rpc.request.createGenerationContext({ sessionId }),
  updateGenerationContextEntry: (contextId: string, entryId: string, included: boolean) =>
    rpc.request.updateGenerationContextEntry({ contextId, entryId, included }),
  updateGenerationContextAttachment: (contextId: string, attachmentId: string, included: boolean) =>
    rpc.request.updateGenerationContextAttachment({ contextId, attachmentId, included }),
  generateTestware: (contextId: string, options?: GenerationOptions) =>
    rpc.request.generateTestware({ contextId, options }),
  exportSession: (id: string, format: 'markdown' | 'json') => rpc.request.exportSession({ id, format }),
  getProviderStatus: () => rpc.request.getProviderStatus()
}

window.qaScribe = api
