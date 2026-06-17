import { z } from 'zod'

export const idSchema = z.string().uuid()
export const entryTypeSchema = z.enum(['note', 'observation', 'api_response', 'log', 'screenshot', 'finding_candidate'])
export type EntryType = z.infer<typeof entryTypeSchema>

export const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  testTarget: z.string().nullable(),
  charter: z.string().nullable(),
  environment: z.string().nullable(),
  buildVersion: z.string().nullable(),
  relatedReference: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastOpenedAt: z.string()
})
export type Session = z.infer<typeof sessionSchema>

export const entrySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  type: entryTypeSchema,
  title: z.string().nullable(),
  body: z.string(),
  metadataJson: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  excludedFromGeneration: z.boolean()
})
export type Entry = z.infer<typeof entrySchema>

export const attachmentSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  entryId: z.string().nullable(),
  filename: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number(),
  sha256: z.string(),
  relativePath: z.string(),
  createdAt: z.string()
})
export type Attachment = z.infer<typeof attachmentSchema>

export const sessionDraftSchema = z.object({
  title: z.string().max(160).optional(),
  testTarget: z.string().max(240).nullable().optional(),
  charter: z.string().max(2000).nullable().optional(),
  environment: z.string().max(240).nullable().optional(),
  buildVersion: z.string().max(120).nullable().optional(),
  relatedReference: z.string().max(500).nullable().optional()
})
export type SessionDraft = z.infer<typeof sessionDraftSchema>

export const sessionPatchSchema = sessionDraftSchema.partial()
export type SessionPatch = z.infer<typeof sessionPatchSchema>

export const sessionRequirementKeySchema = z.enum(['title'])
export type SessionRequirementKey = z.infer<typeof sessionRequirementKeySchema>

export type SessionRequirementsResult = {
  valid: boolean
  missing: SessionRequirementKey[]
}

type SessionRequirementsInput = Pick<SessionDraft, 'title'>

export function validateSessionRequirements(input: SessionRequirementsInput): SessionRequirementsResult {
  const missing: SessionRequirementKey[] = []
  if (!input.title?.trim()) missing.push('title')
  return {
    valid: missing.length === 0,
    missing
  }
}

export const entryDraftSchema = z.object({
  sessionId: idSchema,
  type: entryTypeSchema,
  title: z.string().max(160).nullable().optional(),
  body: z.string().min(1),
  metadataJson: z.string().nullable().optional(),
  excludedFromGeneration: z.boolean().optional()
})
export type EntryDraft = z.infer<typeof entryDraftSchema>

export const entryPatchSchema = entryDraftSchema.partial().omit({ sessionId: true })
export type EntryPatch = z.infer<typeof entryPatchSchema>

export const aiProviderIdSchema = z.enum(['claude_code', 'codex_cli', 'copilot_cli'])
export type AiProviderId = z.infer<typeof aiProviderIdSchema>

export const aiRunProviderIdSchema = z.enum([
  'apple_intelligence',
  'claude_code',
  'codex_cli',
  'copilot_cli'
])
export type AiRunProviderId = z.infer<typeof aiRunProviderIdSchema>

export const reasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>

export const providerOptionIdSchema = z.enum(['reasoningEffort'])
export type ProviderOptionId = z.infer<typeof providerOptionIdSchema>

export const providerOptionDescriptorSchema = z.object({
  id: providerOptionIdSchema,
  type: z.literal('select'),
  label: z.string(),
  options: z.array(
    z.object({
      value: reasoningEffortSchema,
      label: z.string()
    })
  ),
  defaultValue: reasoningEffortSchema.nullable()
})
export type ProviderOptionDescriptor = z.infer<typeof providerOptionDescriptorSchema>

export const providerCapabilitiesSchema = z.object({
  optionDescriptors: z.array(providerOptionDescriptorSchema)
})
export type ProviderCapabilities = z.infer<typeof providerCapabilitiesSchema>

export const aiModelDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  capabilities: providerCapabilitiesSchema
})
export type AiModelDescriptor = z.infer<typeof aiModelDescriptorSchema>

export const aiProviderStatusSchema = z.object({
  provider: aiProviderIdSchema,
  label: z.string(),
  available: z.boolean(),
  reason: z.string().nullable(),
  models: z.array(z.string()),
  modelDescriptors: z.array(aiModelDescriptorSchema),
  defaultModel: z.string().nullable(),
  reasoningEfforts: z.array(reasoningEffortSchema),
  defaultReasoningEffort: reasoningEffortSchema.nullable(),
  capabilities: providerCapabilitiesSchema,
  localOnly: z.boolean(),
  requiresNetwork: z.boolean()
})
export type AiProviderStatus = z.infer<typeof aiProviderStatusSchema>

export function reasoningEffortDescriptor(
  provider: Pick<AiProviderStatus, 'capabilities' | 'modelDescriptors'>,
  model?: string | null
): ProviderOptionDescriptor | null {
  const capabilities = modelCapabilitiesFor(provider, model)
  return capabilities.optionDescriptors.find((descriptor) => descriptor.id === 'reasoningEffort') ?? null
}

export function reasoningEffortsFor(
  provider: Pick<AiProviderStatus, 'capabilities' | 'modelDescriptors'>,
  model?: string | null
): ReasoningEffort[] {
  return reasoningEffortDescriptor(provider, model)?.options.map((option) => option.value) ?? []
}

export function defaultReasoningEffortFor(
  provider: Pick<AiProviderStatus, 'capabilities' | 'modelDescriptors'>,
  model?: string | null
): ReasoningEffort | null {
  return reasoningEffortDescriptor(provider, model)?.defaultValue ?? null
}

export function modelDescriptorFor(
  provider: Pick<AiProviderStatus, 'modelDescriptors'>,
  model?: string | null
): AiModelDescriptor | null {
  const selectedModel = model?.trim()
  return selectedModel ? provider.modelDescriptors.find((descriptor) => descriptor.id === selectedModel) ?? null : null
}

export function modelCapabilitiesFor(
  provider: Pick<AiProviderStatus, 'capabilities' | 'modelDescriptors'>,
  model?: string | null
): ProviderCapabilities {
  return modelDescriptorFor(provider, model)?.capabilities ?? provider.capabilities
}

export const providerStatusSchema = z.object({
  providers: z.array(aiProviderStatusSchema),
  selectedProvider: aiProviderIdSchema.nullable(),
  selectedModel: z.string().nullable(),
  selectedReasoningEffort: reasoningEffortSchema.nullable()
})
export type ProviderStatus = z.infer<typeof providerStatusSchema>

export const appSettingsSchemaVersion = 1

export const providerSettingsSchema = z.object({
  claude_code: z.boolean(),
  codex_cli: z.boolean(),
  copilot_cli: z.boolean()
})
export type ProviderSettings = z.infer<typeof providerSettingsSchema>

export const templateFieldTypeSchema = z.enum(['text', 'textarea', 'rich_text', 'select', 'multiselect', 'checkbox'])
export type TemplateFieldType = z.infer<typeof templateFieldTypeSchema>

export const formTemplateFieldSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  type: templateFieldTypeSchema,
  required: z.boolean(),
  enabled: z.boolean(),
  options: z.array(z.string().min(1).max(120)).max(30).optional()
})
export type FormTemplateField = z.infer<typeof formTemplateFieldSchema>

export const captureTemplateSchema = z.object({
  fields: z.array(formTemplateFieldSchema).max(30)
})
export type CaptureTemplate = z.infer<typeof captureTemplateSchema>

export const appSettingsSchema = z.object({
  schemaVersion: z.literal(appSettingsSchemaVersion),
  providers: providerSettingsSchema,
  generation: z.object({
    systemPrompt: z.string().min(1).max(8000)
  }),
  templates: z.object({
    note: captureTemplateSchema,
    finding: captureTemplateSchema
  })
})
export type AppSettings = z.infer<typeof appSettingsSchema>

export const appSettingsPatchSchema = z.object({
  providers: providerSettingsSchema.partial().optional(),
  generation: z
    .object({
      systemPrompt: z.string().min(1).max(8000).optional()
    })
    .optional(),
  templates: z
    .object({
      note: captureTemplateSchema.optional(),
      finding: captureTemplateSchema.optional()
    })
    .optional()
})
export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>

export const defaultAppSettings: AppSettings = {
  schemaVersion: appSettingsSchemaVersion,
  providers: {
    claude_code: true,
    codex_cli: true,
    copilot_cli: true
  },
  generation: {
    systemPrompt: 'You are helping a tester turn a local testing session into structured testware.'
  },
  templates: {
    note: {
      fields: [
        { id: 'title', label: 'Note title', type: 'text', required: false, enabled: true },
        { id: 'body', label: 'Note body', type: 'rich_text', required: true, enabled: true },
        { id: 'evidence', label: 'Evidence', type: 'checkbox', required: false, enabled: true }
      ]
    },
    finding: {
      fields: [
        { id: 'title', label: 'Finding title', type: 'text', required: true, enabled: true },
        { id: 'actual', label: 'Actual result', type: 'rich_text', required: false, enabled: true },
        { id: 'expected', label: 'Expected result', type: 'rich_text', required: false, enabled: true },
        { id: 'steps', label: 'Steps to reproduce', type: 'textarea', required: false, enabled: true },
        {
          id: 'severity',
          label: 'Severity',
          type: 'select',
          required: false,
          enabled: true,
          options: ['untriaged', 'critical', 'major', 'minor', 'trivial']
        },
        {
          id: 'priority',
          label: 'Priority',
          type: 'select',
          required: false,
          enabled: true,
          options: ['medium', 'urgent', 'high', 'low']
        },
        { id: 'component', label: 'Component', type: 'text', required: false, enabled: true },
        { id: 'environment', label: 'Environment', type: 'text', required: false, enabled: true },
        { id: 'notes', label: 'Notes', type: 'textarea', required: false, enabled: true },
        { id: 'linked-entry', label: 'Linked Entry Evidence', type: 'checkbox', required: false, enabled: true }
      ]
    }
  }
}

export const generationOptionsSchema = z.object({
  provider: aiProviderIdSchema.optional(),
  model: z.string().min(1).max(120).optional(),
  reasoningEffort: reasoningEffortSchema.nullable().optional()
})
export type GenerationOptions = z.infer<typeof generationOptionsSchema>

export const findingKindSchema = z.enum(['bug', 'question', 'risk', 'follow_up', 'note'])
export type FindingKind = z.infer<typeof findingKindSchema>

export const findingSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string(),
  body: z.string(),
  kind: findingKindSchema,
  metadataJson: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Finding = z.infer<typeof findingSchema>

export const findingDraftSchema = z.object({
  sessionId: idSchema,
  title: z.string().min(1).max(180),
  body: z.string().min(1),
  kind: findingKindSchema.default('bug'),
  metadataJson: z.string().nullable().optional(),
  entryId: idSchema.optional()
})
export type FindingDraft = z.infer<typeof findingDraftSchema>

export const findingPatchSchema = findingDraftSchema.partial().omit({ sessionId: true, entryId: true })
export type FindingPatch = z.infer<typeof findingPatchSchema>

export const evidenceLinkSchema = z.object({
  id: z.string(),
  findingId: z.string(),
  entryId: z.string().nullable(),
  attachmentId: z.string().nullable(),
  createdAt: z.string()
})
export type EvidenceLink = z.infer<typeof evidenceLinkSchema>

export const evidenceLinkDraftSchema = z.object({
  findingId: idSchema,
  entryId: idSchema.nullable().optional(),
  attachmentId: idSchema.nullable().optional()
}).refine((value) => Boolean(value.entryId || value.attachmentId), {
  message: 'Evidence link requires an Entry or Attachment',
  path: ['entryId']
})
export type EvidenceLinkDraft = z.infer<typeof evidenceLinkDraftSchema>

export const draftKindSchema = z.enum(['session_report'])
export type DraftKind = z.infer<typeof draftKindSchema>

export const draftSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  aiRunId: z.string().nullable(),
  kind: draftKindSchema,
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Draft = z.infer<typeof draftSchema>

export const draftCreateSchema = z.object({
  sessionId: idSchema,
  kind: draftKindSchema.default('session_report'),
  title: z.string().min(1).max(180),
  body: z.string()
})
export type DraftCreate = z.infer<typeof draftCreateSchema>

export const draftPatchSchema = z.object({
  title: z.string().min(1).max(180).optional(),
  body: z.string().optional()
})
export type DraftPatch = z.infer<typeof draftPatchSchema>

export const aiRunSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  generationContextId: z.string().nullable(),
  provider: aiRunProviderIdSchema,
  model: z.string(),
  reasoningEffort: reasoningEffortSchema.nullable(),
  promptVersion: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable()
})
export type AiRun = z.infer<typeof aiRunSchema>

export const generationContextEntrySchema = z.object({
  id: z.string(),
  generationContextId: z.string(),
  entryId: z.string(),
  included: z.boolean()
})
export type GenerationContextEntry = z.infer<typeof generationContextEntrySchema>

export const generationContextSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  createdAt: z.string()
})
export type GenerationContext = z.infer<typeof generationContextSchema>

export type SessionSnapshot = {
  session: Session
  entries: Entry[]
  attachments: Attachment[]
  findings: Finding[]
  evidenceLinks: EvidenceLink[]
  drafts: Draft[]
  aiRuns: AiRun[]
}

export type GenerationContextReview = {
  context: GenerationContext
  session: Session
  entries: Array<{ entry: Entry; included: boolean; attachments: Attachment[] }>
  attachments: Array<{ attachment: Attachment; included: boolean }>
  findings: Array<{ finding: Finding; evidenceLinks: EvidenceLink[] }>
}

export type GenerationResult = {
  aiRun: AiRun
  draft: Draft
}

export const sessionExportSchema = z.object({
  format: z.enum(['markdown', 'json']),
  content: z.string()
})
export type SessionExport = z.infer<typeof sessionExportSchema>

export interface QaScribeApi {
  getSettings(): Promise<AppSettings>
  updateSettings(input: AppSettingsPatch): Promise<AppSettings>
  listSessions(): Promise<Session[]>
  createSession(input: SessionDraft): Promise<Session>
  getSession(id: string): Promise<SessionSnapshot | null>
  updateSession(id: string, input: SessionPatch): Promise<Session>
  deleteSession(id: string): Promise<void>
  createEntry(input: EntryDraft): Promise<Entry>
  updateEntry(id: string, input: EntryPatch): Promise<Entry>
  deleteEntry(id: string): Promise<void>
  importAttachment(sessionId: string, entryId?: string): Promise<Attachment | null>
  importClipboardScreenshot(sessionId: string, entryId?: string): Promise<Attachment | null>
  getAttachmentPreviewDataUrl(id: string): Promise<string | null>
  copyAttachmentImageToClipboard(id: string): Promise<boolean>
  createFinding(input: FindingDraft): Promise<Finding>
  updateFinding(id: string, input: FindingPatch): Promise<Finding>
  deleteFinding(id: string): Promise<void>
  createEvidenceLink(input: EvidenceLinkDraft): Promise<EvidenceLink>
  deleteEvidenceLink(id: string): Promise<void>
  listDrafts(sessionId: string): Promise<Draft[]>
  createDraft(input: DraftCreate): Promise<Draft>
  updateDraft(id: string, input: DraftPatch): Promise<Draft>
  deleteDraft(id: string): Promise<void>
  getDraftEvidenceAttachments(id: string): Promise<Attachment[]>
  createGenerationContext(sessionId: string): Promise<GenerationContextReview>
  updateGenerationContextEntry(contextId: string, entryId: string, included: boolean): Promise<GenerationContextReview>
  updateGenerationContextAttachment(contextId: string, attachmentId: string, included: boolean): Promise<GenerationContextReview>
  generateTestware(contextId: string, options?: GenerationOptions): Promise<GenerationResult>
  exportSession(id: string, format: 'markdown' | 'json'): Promise<SessionExport>
  getProviderStatus(): Promise<ProviderStatus>
}
