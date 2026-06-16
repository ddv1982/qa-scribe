import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { desc, eq } from 'drizzle-orm'
import type {
  AiRun,
  AiProviderId,
  Attachment,
  Draft,
  DraftCreate,
  DraftPatch,
  EvidenceLink,
  EvidenceLinkDraft,
  Entry,
  EntryDraft,
  EntryPatch,
  Finding,
  FindingDraft,
  FindingPatch,
  GenerationOptions,
  GenerationContextReview,
  GenerationResult,
  ProviderStatus,
  ReasoningEffort,
  Session,
  SessionDraft,
  SessionExport,
  SessionSnapshot,
  SessionPatch
} from '../../shared/contracts'
import {
  draftCreateSchema,
  draftPatchSchema,
  entryDraftSchema,
  entryPatchSchema,
  evidenceLinkDraftSchema,
  findingDraftSchema,
  findingPatchSchema,
  generationOptionsSchema,
  idSchema,
  defaultReasoningEffortFor,
  reasoningEffortsFor,
  sessionDraftSchema,
  sessionPatchSchema,
  validateSessionRequirements
} from '../../shared/contracts'
import type { DbClient } from '../db/client'
import {
  aiRuns,
  attachments,
  drafts,
  entries,
  evidenceLinks,
  findings,
  sessions
} from '../db/schema'
import {
  defaultProviderModels,
  detectProviderStatuses,
  generateStructuredOutput,
  type CommandRunner
} from './aiProviders'
import { guessMimeType, resolveAttachmentStorageDestination, resolveStoredAttachmentPath } from './session/attachmentStorage'
import {
  completeAiRun,
  createAiRun,
  createGeneratedDraft,
  failAiRun
} from './session/aiRuns'
import { renderSessionExport } from './session/exportRenderer'
import {
  buildGenerationPrompt,
  generatedReportJsonSchema,
  generatedReportSchema,
  renderGeneratedReport
} from './session/generation'
import {
  createGenerationContext as createGenerationContextReview,
  getGenerationContextReview,
  updateGenerationContextAttachment as updateGenerationContextAttachmentReview,
  updateGenerationContextEntry as updateGenerationContextEntryReview,
  type GenerationContextDeps
} from './session/generationContext'
import {
  mapAiRun,
  mapAttachment,
  mapDraft,
  mapEntry,
  mapEvidenceLink,
  mapFinding,
  mapSession,
  type RawEvidenceLink
} from './session/mappers'
import { cleanNullable, defaultReasoningEffort, formatRequirementLabels, isoNow } from './session/utils'

export class SessionService {
  constructor(
    private readonly client: DbClient,
    private readonly attachmentsRoot: string,
    private readonly commandRunner?: CommandRunner
  ) {}

  listSessions(): Session[] {
    return this.client.db.select().from(sessions).orderBy(desc(sessions.lastOpenedAt)).all().map(mapSession)
  }

  createSession(input: SessionDraft): Session {
    const data = sessionDraftSchema.parse(input)
    const now = isoNow()
    const [session] = this.client.db
      .insert(sessions)
      .values({
        id: randomUUID(),
        title: data.title?.trim() || 'Untitled Session',
        testTarget: cleanNullable(data.testTarget),
        charter: cleanNullable(data.charter),
        environment: cleanNullable(data.environment),
        buildVersion: cleanNullable(data.buildVersion),
        relatedReference: cleanNullable(data.relatedReference),
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now
      })
      .returning()
      .all()

    return mapSession(session)
  }

  getSession(id: string): SessionSnapshot | null {
    return this.getSessionSnapshot(idSchema.parse(id), true)
  }

  private getSessionSnapshot(id: string, touchOnRead: boolean): SessionSnapshot | null {
    const session = this.client.db.select().from(sessions).where(eq(sessions.id, id)).get()
    if (!session) return null

    const now = touchOnRead ? isoNow() : session.lastOpenedAt
    if (touchOnRead) this.client.db.update(sessions).set({ lastOpenedAt: now }).where(eq(sessions.id, id)).run()

    return {
      session: mapSession({ ...session, lastOpenedAt: now }),
      entries: this.listEntries(id),
      attachments: this.listAttachments(id),
      findings: this.listFindings(id),
      evidenceLinks: this.listEvidenceLinks(id),
      drafts: this.listDrafts(id),
      aiRuns: this.listAiRuns(id)
    }
  }

  updateSession(id: string, input: SessionPatch): Session {
    const sessionId = idSchema.parse(id)
    const data = sessionPatchSchema.parse(input)
    const previous = this.client.db.select().from(sessions).where(eq(sessions.id, sessionId)).get()
    if (!previous) throw new Error(`Session not found: ${sessionId}`)

    const now = isoNow()
    const [session] = this.client.db
      .update(sessions)
      .set({
        title: data.title === undefined ? previous.title : data.title.trim() || 'Untitled Session',
        testTarget: data.testTarget === undefined ? previous.testTarget : cleanNullable(data.testTarget),
        charter: data.charter === undefined ? previous.charter : cleanNullable(data.charter),
        environment: data.environment === undefined ? previous.environment : cleanNullable(data.environment),
        buildVersion: data.buildVersion === undefined ? previous.buildVersion : cleanNullable(data.buildVersion),
        relatedReference:
          data.relatedReference === undefined ? previous.relatedReference : cleanNullable(data.relatedReference),
        updatedAt: now
      })
      .where(eq(sessions.id, sessionId))
      .returning()
      .all()

    return mapSession(session)
  }

  deleteSession(id: string): void {
    this.client.db.delete(sessions).where(eq(sessions.id, idSchema.parse(id))).run()
  }

  createEntry(input: EntryDraft): Entry {
    const data = entryDraftSchema.parse(input)
    const now = isoNow()
    const [entry] = this.client.db
      .insert(entries)
      .values({
        id: randomUUID(),
        sessionId: data.sessionId,
        type: data.type,
        title: cleanNullable(data.title),
        body: data.body,
        metadataJson: cleanNullable(data.metadataJson),
        createdAt: now,
        updatedAt: now,
        excludedFromGeneration: data.excludedFromGeneration ?? false
      })
      .returning()
      .all()

    this.touchSession(data.sessionId)
    return mapEntry(entry)
  }

  updateEntry(id: string, input: EntryPatch): Entry {
    const entryId = idSchema.parse(id)
    const data = entryPatchSchema.parse(input)
    const now = isoNow()
    const previous = this.client.db.select().from(entries).where(eq(entries.id, entryId)).get()
    if (!previous) throw new Error(`Entry not found: ${entryId}`)

    const [entry] = this.client.db
      .update(entries)
      .set({
        type: data.type ?? previous.type,
        title: data.title === undefined ? previous.title : cleanNullable(data.title),
        body: data.body ?? previous.body,
        metadataJson: data.metadataJson === undefined ? previous.metadataJson : cleanNullable(data.metadataJson),
        excludedFromGeneration: data.excludedFromGeneration ?? previous.excludedFromGeneration,
        updatedAt: now
      })
      .where(eq(entries.id, entryId))
      .returning()
      .all()

    this.touchSession(previous.sessionId)
    return mapEntry(entry)
  }

  deleteEntry(id: string): void {
    const entryId = idSchema.parse(id)
    const entry = this.client.db.select().from(entries).where(eq(entries.id, entryId)).get()
    this.client.db.delete(entries).where(eq(entries.id, entryId)).run()
    if (entry) this.touchSession(entry.sessionId)
  }

  listEntries(sessionId: string): Entry[] {
    const parsedSessionId = idSchema.parse(sessionId)
    return this.client.db
      .select()
      .from(entries)
      .where(eq(entries.sessionId, parsedSessionId))
      .orderBy(entries.createdAt)
      .all()
      .map(mapEntry)
  }

  listAttachments(sessionId: string): Attachment[] {
    const parsedSessionId = idSchema.parse(sessionId)
    return this.client.db
      .select()
      .from(attachments)
      .where(eq(attachments.sessionId, parsedSessionId))
      .orderBy(attachments.createdAt)
      .all()
      .map(mapAttachment)
  }

  importAttachment(sourcePath: string, sessionId: string, entryId?: string): Attachment {
    const parsedSessionId = idSchema.parse(sessionId)
    const parsedEntryId = entryId ? idSchema.parse(entryId) : undefined
    const session = this.client.db.select().from(sessions).where(eq(sessions.id, parsedSessionId)).get()
    if (!session) throw new Error(`Session not found: ${parsedSessionId}`)

    if (parsedEntryId) {
      const entry = this.client.db.select().from(entries).where(eq(entries.id, parsedEntryId)).get()
      if (!entry || entry.sessionId !== parsedSessionId) throw new Error(`Entry not found in Session: ${parsedEntryId}`)
    }

    const file = readFileSync(sourcePath)
    const hash = createHash('sha256').update(file).digest('hex')
    const stats = statSync(sourcePath)
    const now = isoNow()
    const id = randomUUID()
    const { relativePath, destinationDir, destination, extension } = resolveAttachmentStorageDestination(
      this.attachmentsRoot,
      parsedSessionId,
      id,
      sourcePath
    )

    mkdirSync(destinationDir, { recursive: true })
    copyFileSync(sourcePath, destination)

    const [attachment] = this.client.db
      .insert(attachments)
      .values({
        id,
        sessionId: parsedSessionId,
        entryId: parsedEntryId ?? null,
        filename: basename(sourcePath),
        mimeType: guessMimeType(extension),
        sizeBytes: stats.size,
        sha256: hash,
        relativePath,
        createdAt: now
      })
      .returning()
      .all()

    this.touchSession(parsedSessionId)
    return mapAttachment(attachment)
  }

  getAttachmentPreviewDataUrl(id: string): string | null {
    const attachmentId = idSchema.parse(id)
    const attachment = this.client.db.select().from(attachments).where(eq(attachments.id, attachmentId)).get()
    if (!attachment?.mimeType?.startsWith('image/')) return null

    const path = resolveStoredAttachmentPath(this.attachmentsRoot, attachment.relativePath)
    return `data:${attachment.mimeType};base64,${readFileSync(path).toString('base64')}`
  }

  createFinding(input: FindingDraft): Finding {
    const data = findingDraftSchema.parse(input)
    this.assertSessionExists(data.sessionId)
    return this.client.sqlite.transaction(() => {
      const now = isoNow()
      const [finding] = this.client.db
        .insert(findings)
        .values({
          id: randomUUID(),
          sessionId: data.sessionId,
          title: data.title.trim(),
          body: data.body,
          kind: data.kind,
          metadataJson: cleanNullable(data.metadataJson),
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .all()

      if (data.entryId) {
        this.createEvidenceLink({ findingId: finding.id, entryId: data.entryId })
      }

      this.touchSession(data.sessionId)
      return mapFinding(finding)
    })()
  }

  updateFinding(id: string, input: FindingPatch): Finding {
    const findingId = idSchema.parse(id)
    const data = findingPatchSchema.parse(input)
    const previous = this.client.db.select().from(findings).where(eq(findings.id, findingId)).get()
    if (!previous) throw new Error(`Finding not found: ${findingId}`)

    const now = isoNow()
    const [finding] = this.client.db
      .update(findings)
      .set({
        title: data.title === undefined ? previous.title : data.title.trim(),
        body: data.body ?? previous.body,
        kind: data.kind ?? previous.kind,
        metadataJson: data.metadataJson === undefined ? previous.metadataJson : cleanNullable(data.metadataJson),
        updatedAt: now
      })
      .where(eq(findings.id, findingId))
      .returning()
      .all()

    this.touchSession(previous.sessionId)
    return mapFinding(finding)
  }

  deleteFinding(id: string): void {
    const findingId = idSchema.parse(id)
    const finding = this.client.db.select().from(findings).where(eq(findings.id, findingId)).get()
    this.client.db.delete(findings).where(eq(findings.id, findingId)).run()
    if (finding) this.touchSession(finding.sessionId)
  }

  listFindings(sessionId: string): Finding[] {
    const parsedSessionId = idSchema.parse(sessionId)
    return this.client.db
      .select()
      .from(findings)
      .where(eq(findings.sessionId, parsedSessionId))
      .orderBy(findings.createdAt)
      .all()
      .map(mapFinding)
  }

  createEvidenceLink(input: EvidenceLinkDraft): EvidenceLink {
    const data = evidenceLinkDraftSchema.parse(input)

    const finding = this.client.db.select().from(findings).where(eq(findings.id, data.findingId)).get()
    if (!finding) throw new Error(`Finding not found: ${data.findingId}`)

    if (data.entryId) {
      const entry = this.client.db.select().from(entries).where(eq(entries.id, data.entryId)).get()
      if (!entry || entry.sessionId !== finding.sessionId) throw new Error(`Entry not found in Session: ${data.entryId}`)
    }

    if (data.attachmentId) {
      const attachment = this.client.db.select().from(attachments).where(eq(attachments.id, data.attachmentId)).get()
      if (!attachment || attachment.sessionId !== finding.sessionId) {
        throw new Error(`Attachment not found in Session: ${data.attachmentId}`)
      }
    }

    const [link] = this.client.db
      .insert(evidenceLinks)
      .values({
        id: randomUUID(),
        findingId: data.findingId,
        entryId: data.entryId ?? null,
        attachmentId: data.attachmentId ?? null,
        createdAt: isoNow()
      })
      .returning()
      .all()

    this.touchSession(finding.sessionId)
    return mapEvidenceLink(link)
  }

  deleteEvidenceLink(id: string): void {
    const linkId = idSchema.parse(id)
    const link = this.client.db.select().from(evidenceLinks).where(eq(evidenceLinks.id, linkId)).get()
    const finding = link
      ? this.client.db.select().from(findings).where(eq(findings.id, link.findingId)).get()
      : undefined
    this.client.db.delete(evidenceLinks).where(eq(evidenceLinks.id, linkId)).run()
    if (finding) this.touchSession(finding.sessionId)
  }

  listEvidenceLinks(sessionId: string): EvidenceLink[] {
    const parsedSessionId = idSchema.parse(sessionId)
    return this.client.sqlite
      .prepare(
        `SELECT evidence_links.*
         FROM evidence_links
         INNER JOIN findings ON findings.id = evidence_links.finding_id
         WHERE findings.session_id = ?
         ORDER BY evidence_links.created_at`
      )
      .all(parsedSessionId)
      .map((row) => mapEvidenceLink(row as RawEvidenceLink))
  }

  listDrafts(sessionId: string): Draft[] {
    const parsedSessionId = idSchema.parse(sessionId)
    return this.client.db
      .select()
      .from(drafts)
      .where(eq(drafts.sessionId, parsedSessionId))
      .orderBy(desc(drafts.updatedAt))
      .all()
      .map(mapDraft)
  }

  createDraft(input: DraftCreate): Draft {
    const data = draftCreateSchema.parse(input)
    this.assertSessionExists(data.sessionId)
    const now = isoNow()
    const [draft] = this.client.db
      .insert(drafts)
      .values({
        id: randomUUID(),
        sessionId: data.sessionId,
        aiRunId: null,
        kind: data.kind,
        title: data.title.trim(),
        body: data.body,
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .all()

    this.touchSession(data.sessionId)
    return mapDraft(draft)
  }

  updateDraft(id: string, input: DraftPatch): Draft {
    const draftId = idSchema.parse(id)
    const data = draftPatchSchema.parse(input)
    const previous = this.client.db.select().from(drafts).where(eq(drafts.id, draftId)).get()
    if (!previous) throw new Error(`Draft not found: ${draftId}`)

    const [draft] = this.client.db
      .update(drafts)
      .set({
        title: data.title === undefined ? previous.title : data.title.trim(),
        body: data.body ?? previous.body,
        updatedAt: isoNow()
      })
      .where(eq(drafts.id, draftId))
      .returning()
      .all()

    this.touchSession(previous.sessionId)
    return mapDraft(draft)
  }

  deleteDraft(id: string): void {
    const draftId = idSchema.parse(id)
    const draft = this.client.db.select().from(drafts).where(eq(drafts.id, draftId)).get()
    this.client.db.delete(drafts).where(eq(drafts.id, draftId)).run()
    if (draft) this.touchSession(draft.sessionId)
  }

  listAiRuns(sessionId: string): AiRun[] {
    const parsedSessionId = idSchema.parse(sessionId)
    return this.client.db
      .select()
      .from(aiRuns)
      .where(eq(aiRuns.sessionId, parsedSessionId))
      .orderBy(desc(aiRuns.createdAt))
      .all()
      .map(mapAiRun)
  }

  createGenerationContext(sessionId: string): GenerationContextReview {
    return createGenerationContextReview(this.generationContextDeps(), sessionId)
  }

  updateGenerationContextEntry(contextId: string, entryId: string, included: boolean): GenerationContextReview {
    return updateGenerationContextEntryReview(this.generationContextDeps(), contextId, entryId, included)
  }

  updateGenerationContextAttachment(contextId: string, attachmentId: string, included: boolean): GenerationContextReview {
    return updateGenerationContextAttachmentReview(this.generationContextDeps(), contextId, attachmentId, included)
  }

  async generateTestware(contextId: string, options?: GenerationOptions): Promise<GenerationResult> {
    const review = getGenerationContextReview(this.generationContextDeps(), idSchema.parse(contextId))
    const requirements = validateSessionRequirements(review.session)
    if (!requirements.valid) {
      throw new Error(`Complete required Session fields before generating: ${formatRequirementLabels(requirements.missing)}`)
    }

    const generationOptions = await this.resolveGenerationOptions(generationOptionsSchema.parse(options ?? {}))
    const status = (await this.getProviderStatus()).providers.find((item) => item.provider === generationOptions.provider)
    if (!status?.available) {
      const errorMessage = status?.reason ?? `${generationOptions.provider} is not available.`
      createAiRun(this.client, {
        sessionId: review.context.sessionId,
        generationContextId: review.context.id,
        provider: generationOptions.provider,
        model: generationOptions.model,
        reasoningEffort: generationOptions.reasoningEffort,
        status: 'failed',
        errorMessage
      })
      throw new Error(errorMessage)
    }

    const aiRun = createAiRun(this.client, {
      sessionId: review.context.sessionId,
      generationContextId: review.context.id,
      provider: generationOptions.provider,
      model: generationOptions.model,
      reasoningEffort: generationOptions.reasoningEffort,
      status: 'running'
    })

    try {
      const output = await generateStructuredOutput(
        {
          provider: generationOptions.provider,
          model: generationOptions.model,
          reasoningEffort: generationOptions.reasoningEffort,
          outputSchema: generatedReportJsonSchema,
          prompt: buildGenerationPrompt(review)
        },
        this.commandRunner
      )
      const report = generatedReportSchema.parse(output)
      const completedRun = completeAiRun(this.client, aiRun.id)
      const draft = createGeneratedDraft(this.client, review.context.sessionId, completedRun.id, renderGeneratedReport(report))
      return { aiRun: completedRun, draft }
    } catch (error) {
      failAiRun(this.client, aiRun.id, error instanceof Error ? error.message : 'Unknown AI provider error')
      throw error
    }
  }

  exportSession(id: string, format: 'markdown' | 'json'): SessionExport {
    const snapshot = this.getSessionSnapshot(idSchema.parse(id), false)
    if (!snapshot) throw new Error(`Session not found: ${id}`)

    return renderSessionExport(snapshot, format)
  }

  async getProviderStatus(): Promise<ProviderStatus> {
    const providers = await detectProviderStatuses(this.commandRunner)
    const selectedProvider =
      providers.find((status) => status.available)?.provider ??
      null
    const selectedStatus = selectedProvider ? providers.find((status) => status.provider === selectedProvider) : null

    return {
      providers,
      selectedProvider,
      selectedModel: selectedStatus?.defaultModel ?? null,
      selectedReasoningEffort: selectedStatus ? defaultReasoningEffortFor(selectedStatus, selectedStatus.defaultModel) : null
    }
  }

  private generationContextDeps(): GenerationContextDeps {
    return {
      client: this.client,
      listEntries: (sessionId) => this.listEntries(sessionId),
      listAttachments: (sessionId) => this.listAttachments(sessionId),
      listFindings: (sessionId) => this.listFindings(sessionId),
      listEvidenceLinks: (sessionId) => this.listEvidenceLinks(sessionId),
      assertSessionExists: (sessionId) => this.assertSessionExists(sessionId)
    }
  }

  private assertSessionExists(sessionId: string): void {
    const session = this.client.db.select().from(sessions).where(eq(sessions.id, idSchema.parse(sessionId))).get()
    if (!session) throw new Error(`Session not found: ${sessionId}`)
  }

  private touchSession(id: string): void {
    const now = isoNow()
    this.client.db.update(sessions).set({ updatedAt: now, lastOpenedAt: now }).where(eq(sessions.id, id)).run()
  }

  private async resolveGenerationOptions(options: GenerationOptions): Promise<{
    provider: AiProviderId
    model: string
    reasoningEffort: ReasoningEffort | null
  }> {
    const providerStatus = await this.getProviderStatus()
    const provider = options.provider ?? providerStatus.selectedProvider ?? 'codex_cli'
    const selectedStatus = providerStatus.providers.find((status) => status.provider === provider)
    const defaultModel = selectedStatus?.defaultModel ?? defaultProviderModels[provider]
    const model = options.model?.trim() || defaultModel
    const defaultReasoning = selectedStatus ? defaultReasoningEffortFor(selectedStatus, model) : defaultReasoningEffort(provider)
    const reasoningEffort = options.reasoningEffort === undefined ? defaultReasoning : options.reasoningEffort

    if (reasoningEffort && selectedStatus && !reasoningEffortsFor(selectedStatus, model).includes(reasoningEffort)) {
      throw new Error(`${selectedStatus.label} does not support ${reasoningEffort} reasoning effort.`)
    }

    return {
      provider,
      model,
      reasoningEffort
    }
  }
}

export const __testables = {
  buildGenerationPrompt
}
