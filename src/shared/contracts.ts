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

export const providerStatusSchema = z.object({
  configured: z.boolean(),
  provider: z.literal('openai').nullable(),
  model: z.string().nullable()
})
export type ProviderStatus = z.infer<typeof providerStatusSchema>

export const findingKindSchema = z.enum(['bug', 'question', 'risk', 'follow_up', 'note'])
export type FindingKind = z.infer<typeof findingKindSchema>

export const findingSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  title: z.string(),
  body: z.string(),
  kind: findingKindSchema,
  createdAt: z.string(),
  updatedAt: z.string()
})
export type Finding = z.infer<typeof findingSchema>

export const findingDraftSchema = z.object({
  sessionId: idSchema,
  title: z.string().min(1).max(180),
  body: z.string().min(1),
  kind: findingKindSchema.default('bug'),
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
  provider: z.literal('openai'),
  model: z.string(),
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
  listSessions(): Promise<Session[]>
  createSession(input: SessionDraft): Promise<Session>
  getSession(id: string): Promise<SessionSnapshot | null>
  updateSession(id: string, input: SessionPatch): Promise<Session>
  deleteSession(id: string): Promise<void>
  createEntry(input: EntryDraft): Promise<Entry>
  updateEntry(id: string, input: EntryPatch): Promise<Entry>
  deleteEntry(id: string): Promise<void>
  importAttachment(sessionId: string, entryId?: string): Promise<Attachment | null>
  createFinding(input: FindingDraft): Promise<Finding>
  updateFinding(id: string, input: FindingPatch): Promise<Finding>
  deleteFinding(id: string): Promise<void>
  createEvidenceLink(input: EvidenceLinkDraft): Promise<EvidenceLink>
  deleteEvidenceLink(id: string): Promise<void>
  listDrafts(sessionId: string): Promise<Draft[]>
  createDraft(input: DraftCreate): Promise<Draft>
  updateDraft(id: string, input: DraftPatch): Promise<Draft>
  deleteDraft(id: string): Promise<void>
  createGenerationContext(sessionId: string): Promise<GenerationContextReview>
  updateGenerationContextEntry(contextId: string, entryId: string, included: boolean): Promise<GenerationContextReview>
  updateGenerationContextAttachment(contextId: string, attachmentId: string, included: boolean): Promise<GenerationContextReview>
  generateTestware(contextId: string): Promise<GenerationResult>
  exportSession(id: string, format: 'markdown' | 'json'): Promise<SessionExport>
  getProviderStatus(): Promise<ProviderStatus>
}
