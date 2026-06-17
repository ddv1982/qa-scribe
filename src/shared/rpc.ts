import type {
  AiProviderStatus,
  AppSettings,
  AppSettingsPatch,
  Attachment,
  Draft,
  DraftCreate,
  DraftPatch,
  Entry,
  EntryDraft,
  EntryPatch,
  EvidenceLink,
  EvidenceLinkDraft,
  Finding,
  FindingDraft,
  FindingPatch,
  GenerationContextReview,
  GenerationOptions,
  GenerationResult,
  ProviderStatus,
  Session,
  SessionDraft,
  SessionExport,
  SessionPatch,
  SessionSnapshot
} from './contracts'

type RpcRequest<Params, Response> = {
  params: Params
  response: Response
}

type EmptyMessages = Record<never, never>

export type QaScribeRpcSchema = {
  bun: {
    requests: {
      getSettings: RpcRequest<void, AppSettings>
      updateSettings: RpcRequest<AppSettingsPatch, AppSettings>
      listSessions: RpcRequest<void, Session[]>
      createSession: RpcRequest<SessionDraft, Session>
      getSession: RpcRequest<{ id: string }, SessionSnapshot | null>
      updateSession: RpcRequest<{ id: string; input: SessionPatch }, Session>
      deleteSession: RpcRequest<{ id: string }, void>
      createEntry: RpcRequest<EntryDraft, Entry>
      updateEntry: RpcRequest<{ id: string; input: EntryPatch }, Entry>
      deleteEntry: RpcRequest<{ id: string }, void>
      importAttachment: RpcRequest<{ sessionId: string; entryId?: string }, Attachment | null>
      importClipboardScreenshot: RpcRequest<{ sessionId: string; entryId?: string }, Attachment | null>
      getAttachmentPreviewDataUrl: RpcRequest<{ id: string }, string | null>
      copyAttachmentImageToClipboard: RpcRequest<{ id: string }, boolean>
      createFinding: RpcRequest<FindingDraft, Finding>
      updateFinding: RpcRequest<{ id: string; input: FindingPatch }, Finding>
      deleteFinding: RpcRequest<{ id: string }, void>
      createEvidenceLink: RpcRequest<EvidenceLinkDraft, EvidenceLink>
      deleteEvidenceLink: RpcRequest<{ id: string }, void>
      listDrafts: RpcRequest<{ sessionId: string }, Draft[]>
      createDraft: RpcRequest<DraftCreate, Draft>
      updateDraft: RpcRequest<{ id: string; input: DraftPatch }, Draft>
      deleteDraft: RpcRequest<{ id: string }, void>
      getDraftEvidenceAttachments: RpcRequest<{ id: string }, Attachment[]>
      createGenerationContext: RpcRequest<{ sessionId: string }, GenerationContextReview>
      updateGenerationContextEntry: RpcRequest<
        { contextId: string; entryId: string; included: boolean },
        GenerationContextReview
      >
      updateGenerationContextAttachment: RpcRequest<
        { contextId: string; attachmentId: string; included: boolean },
        GenerationContextReview
      >
      generateTestware: RpcRequest<{ contextId: string; options?: GenerationOptions }, GenerationResult>
      exportSession: RpcRequest<{ id: string; format: 'markdown' | 'json' }, SessionExport>
      getProviderStatus: RpcRequest<void, ProviderStatus>
    }
    messages: EmptyMessages
  }
  webview: {
    requests: Record<never, never>
    messages: EmptyMessages
  }
}

export type QaScribeProvider = AiProviderStatus['provider']
