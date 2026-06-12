import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type {
  AiRun,
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
  GenerationContext,
  GenerationContextReview,
  GenerationResult,
  ProviderStatus,
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
  idSchema,
  sessionDraftSchema,
  sessionPatchSchema
} from '../../shared/contracts'
import type { DbClient } from '../db/client'
import {
  aiRuns,
  attachments,
  drafts,
  entries,
  evidenceLinks,
  findings,
  generationContextEntries,
  generationContexts,
  sessions
} from '../db/schema'

const promptVersion = 'session-report-v1'

const generatedReportSchema = z.object({
  whatWasTested: z.string(),
  scenariosCovered: z.array(z.string()),
  checks: z.array(
    z.object({
      title: z.string(),
      status: z.enum(['passed', 'failed', 'blocked', 'unknown']),
      notes: z.string().optional()
    })
  ),
  findings: z.array(z.string()),
  bugs: z.array(
    z.object({
      title: z.string(),
      stepsToReproduce: z.array(z.string()),
      expectedResult: z.string(),
      actualResult: z.string(),
      evidence: z.array(z.string()).optional()
    })
  ),
  openQuestions: z.array(z.string()),
  followUpActions: z.array(z.string()),
  jiraBugDrafts: z.array(
    z.object({
      summary: z.string(),
      description: z.string(),
      stepsToReproduce: z.array(z.string()),
      expectedResult: z.string(),
      actualResult: z.string(),
      evidence: z.array(z.string()).optional()
    })
  )
})

type GeneratedReport = z.infer<typeof generatedReportSchema>
type RawEvidenceLink = typeof evidenceLinks.$inferSelect | {
  id: string
  finding_id: string
  entry_id: string | null
  attachment_id: string | null
  created_at: string
}

export class SessionService {
  constructor(
    private readonly client: DbClient,
    private readonly attachmentsRoot: string
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
    const session = this.client.db.select().from(sessions).where(eq(sessions.id, id)).get()
    if (!session) return null

    const now = isoNow()
    this.client.db.update(sessions).set({ lastOpenedAt: now }).where(eq(sessions.id, id)).run()

    const sessionId = idSchema.parse(id)
    return {
      session: mapSession({ ...session, lastOpenedAt: now }),
      entries: this.listEntries(sessionId),
      attachments: this.listAttachments(sessionId),
      findings: this.listFindings(sessionId),
      evidenceLinks: this.listEvidenceLinks(sessionId),
      drafts: this.listDrafts(sessionId),
      aiRuns: this.listAiRuns(sessionId)
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
    const ext = extname(sourcePath)
    const relativePath = join(parsedSessionId, `${id}${ext}`)
    const destinationDir = join(this.attachmentsRoot, parsedSessionId)
    const destination = resolve(this.attachmentsRoot, relativePath)
    const attachmentsRoot = resolve(this.attachmentsRoot)
    const relativeDestination = relative(attachmentsRoot, destination)
    if (relativeDestination.startsWith('..') || isAbsolute(relativeDestination)) {
      throw new Error('Attachment destination escaped managed storage')
    }

    mkdirSync(destinationDir, { recursive: true })
    copyFileSync(sourcePath, destination)

    const [attachment] = this.client.db
      .insert(attachments)
      .values({
        id,
        sessionId: parsedSessionId,
        entryId: parsedEntryId ?? null,
        filename: basename(sourcePath),
        mimeType: guessMimeType(ext),
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

  createFinding(input: FindingDraft): Finding {
    const data = findingDraftSchema.parse(input)
    this.assertSessionExists(data.sessionId)
    const now = isoNow()
    const [finding] = this.client.db
      .insert(findings)
      .values({
        id: randomUUID(),
        sessionId: data.sessionId,
        title: data.title.trim(),
        body: data.body,
        kind: data.kind,
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
    if (!data.entryId && !data.attachmentId) throw new Error('Evidence link requires an Entry or Attachment')

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
    const parsedSessionId = idSchema.parse(sessionId)
    this.assertSessionExists(parsedSessionId)
    const now = isoNow()
    const [context] = this.client.db
      .insert(generationContexts)
      .values({
        id: randomUUID(),
        sessionId: parsedSessionId,
        createdAt: now
      })
      .returning()
      .all()

    for (const entry of this.listEntries(parsedSessionId)) {
      this.client.db
        .insert(generationContextEntries)
        .values({
          id: randomUUID(),
          generationContextId: context.id,
          entryId: entry.id,
          included: !entry.excludedFromGeneration
        })
        .run()
    }

    return this.getGenerationContextReview(context.id)
  }

  updateGenerationContextEntry(contextId: string, entryId: string, included: boolean): GenerationContextReview {
    const parsedContextId = idSchema.parse(contextId)
    const parsedEntryId = idSchema.parse(entryId)
    const existing = this.client.db
      .select()
      .from(generationContextEntries)
      .where(
        and(
          eq(generationContextEntries.generationContextId, parsedContextId),
          eq(generationContextEntries.entryId, parsedEntryId)
        )
      )
      .get()

    if (!existing) throw new Error(`Entry not found in Generation Context: ${parsedEntryId}`)

    this.client.db
      .update(generationContextEntries)
      .set({ included })
      .where(eq(generationContextEntries.id, existing.id))
      .run()

    return this.getGenerationContextReview(parsedContextId)
  }

  async generateTestware(contextId: string): Promise<GenerationResult> {
    const review = this.getGenerationContextReview(idSchema.parse(contextId))
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
    if (!process.env.OPENAI_API_KEY) {
      this.createAiRun(review.context.sessionId, review.context.id, model, 'failed', 'OPENAI_API_KEY is not configured')
      throw new Error('OPENAI_API_KEY is not configured')
    }

    const aiRun = this.createAiRun(review.context.sessionId, review.context.id, model, 'running')

    try {
      const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const result = await generateObject({
        model: openai(model),
        schema: generatedReportSchema,
        prompt: buildGenerationPrompt(review)
      })
      const completedRun = this.completeAiRun(aiRun.id)
      const draft = this.createGeneratedDraft(review.context.sessionId, completedRun.id, renderGeneratedReport(result.object))
      return { aiRun: completedRun, draft }
    } catch (error) {
      this.failAiRun(aiRun.id, error instanceof Error ? error.message : 'Unknown AI provider error')
      throw error
    }
  }

  exportSession(id: string, format: 'markdown' | 'json'): SessionExport {
    const snapshot = this.getSession(idSchema.parse(id))
    if (!snapshot) throw new Error(`Session not found: ${id}`)

    if (format === 'json') {
      return { format, content: JSON.stringify(snapshot, null, 2) }
    }

    const lines = [
      `# ${snapshot.session.title}`,
      '',
      `- Test Target: ${snapshot.session.testTarget ?? ''}`,
      `- Charter: ${snapshot.session.charter ?? ''}`,
      `- Environment: ${snapshot.session.environment ?? ''}`,
      `- Build/Version: ${snapshot.session.buildVersion ?? ''}`,
      `- Related Reference: ${snapshot.session.relatedReference ?? ''}`,
      '',
      '## Session Timeline',
      ''
    ]

    for (const entry of snapshot.entries) {
      lines.push(`### ${labelEntryType(entry.type)} - ${entry.createdAt}`)
      if (entry.title) lines.push(`**${entry.title}**`, '')
      lines.push(entry.body, '')
    }

    if (snapshot.attachments.length > 0) {
      lines.push('## Attachments', '')
      for (const attachment of snapshot.attachments) {
        lines.push(`- ${attachment.filename} (${attachment.sizeBytes} bytes, ${attachment.sha256})`)
      }
      lines.push('')
    }

    if (snapshot.findings.length > 0) {
      lines.push('## Findings', '')
      for (const finding of snapshot.findings) {
        lines.push(`### ${finding.title}`, '', `- Kind: ${finding.kind}`, '', finding.body, '')
      }
    }

    if (snapshot.drafts.length > 0) {
      lines.push('## Drafts', '')
      for (const draft of snapshot.drafts) {
        lines.push(`### ${draft.title}`, '', draft.body, '')
      }
    }

    return { format, content: lines.join('\n') }
  }

  getProviderStatus(): ProviderStatus {
    const model = process.env.OPENAI_MODEL || null
    return {
      configured: Boolean(process.env.OPENAI_API_KEY),
      provider: process.env.OPENAI_API_KEY ? 'openai' : null,
      model: process.env.OPENAI_API_KEY ? model || 'gpt-4.1-mini' : null
    }
  }

  private getGenerationContextReview(contextId: string): GenerationContextReview {
    const parsedContextId = idSchema.parse(contextId)
    const context = this.client.db
      .select()
      .from(generationContexts)
      .where(eq(generationContexts.id, parsedContextId))
      .get()
    if (!context) throw new Error(`Generation Context not found: ${parsedContextId}`)

    const session = this.client.db.select().from(sessions).where(eq(sessions.id, context.sessionId)).get()
    if (!session) throw new Error(`Session not found: ${context.sessionId}`)

    const contextEntries = this.client.db
      .select()
      .from(generationContextEntries)
      .where(eq(generationContextEntries.generationContextId, parsedContextId))
      .all()
    const contextEntryByEntryId = new Map(contextEntries.map((entry) => [entry.entryId, entry]))
    const attachmentsForSession = this.listAttachments(context.sessionId)

    return {
      context: mapGenerationContext(context),
      session: mapSession(session),
      entries: this.listEntries(context.sessionId)
        .filter((entry) => contextEntryByEntryId.has(entry.id))
        .map((entry) => ({
          entry,
          included: Boolean(contextEntryByEntryId.get(entry.id)?.included),
          attachments: attachmentsForSession.filter((attachment) => attachment.entryId === entry.id)
        })),
      attachments: attachmentsForSession.filter((attachment) => attachment.entryId === null),
      findings: this.listFindings(context.sessionId).map((finding) => ({
        finding,
        evidenceLinks: this.listEvidenceLinks(context.sessionId).filter((link) => link.findingId === finding.id)
      }))
    }
  }

  private createAiRun(
    sessionId: string,
    generationContextId: string,
    model: string,
    status: 'running' | 'completed' | 'failed',
    errorMessage: string | null = null
  ): AiRun {
    const now = isoNow()
    const [run] = this.client.db
      .insert(aiRuns)
      .values({
        id: randomUUID(),
        sessionId,
        generationContextId,
        provider: 'openai',
        model,
        promptVersion,
        status,
        errorMessage,
        createdAt: now,
        completedAt: status === 'running' ? null : now
      })
      .returning()
      .all()

    this.touchSession(sessionId)
    return mapAiRun(run)
  }

  private completeAiRun(id: string): AiRun {
    const runId = idSchema.parse(id)
    const [run] = this.client.db
      .update(aiRuns)
      .set({
        status: 'completed',
        errorMessage: null,
        completedAt: isoNow()
      })
      .where(eq(aiRuns.id, runId))
      .returning()
      .all()
    this.touchSession(run.sessionId)
    return mapAiRun(run)
  }

  private failAiRun(id: string, errorMessage: string): AiRun {
    const runId = idSchema.parse(id)
    const [run] = this.client.db
      .update(aiRuns)
      .set({
        status: 'failed',
        errorMessage,
        completedAt: isoNow()
      })
      .where(eq(aiRuns.id, runId))
      .returning()
      .all()
    this.touchSession(run.sessionId)
    return mapAiRun(run)
  }

  private createGeneratedDraft(sessionId: string, aiRunId: string, body: string): Draft {
    const now = isoNow()
    const [draft] = this.client.db
      .insert(drafts)
      .values({
        id: randomUUID(),
        sessionId,
        aiRunId,
        kind: 'session_report',
        title: 'Generated Session Report',
        body,
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .all()
    this.touchSession(sessionId)
    return mapDraft(draft)
  }

  private assertSessionExists(sessionId: string): void {
    const session = this.client.db.select().from(sessions).where(eq(sessions.id, idSchema.parse(sessionId))).get()
    if (!session) throw new Error(`Session not found: ${sessionId}`)
  }

  private touchSession(id: string): void {
    const now = isoNow()
    this.client.db.update(sessions).set({ updatedAt: now, lastOpenedAt: now }).where(eq(sessions.id, id)).run()
  }
}

function isoNow(): string {
  return new Date().toISOString()
}

function cleanNullable(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function mapSession(row: typeof sessions.$inferSelect): Session {
  return row
}

function mapEntry(row: typeof entries.$inferSelect): Entry {
  return row
}

function mapAttachment(row: typeof attachments.$inferSelect): Attachment {
  return row
}

function mapFinding(row: typeof findings.$inferSelect): Finding {
  return row
}

function mapEvidenceLink(row: RawEvidenceLink): EvidenceLink {
  if ('findingId' in row) return row
  return {
    id: row.id,
    findingId: row.finding_id,
    entryId: row.entry_id,
    attachmentId: row.attachment_id,
    createdAt: row.created_at
  }
}

function mapDraft(row: typeof drafts.$inferSelect): Draft {
  return row
}

function mapAiRun(row: typeof aiRuns.$inferSelect): AiRun {
  return row
}

function mapGenerationContext(row: typeof generationContexts.$inferSelect): GenerationContext {
  return row
}

function guessMimeType(ext: string): string | null {
  const normalized = ext.toLowerCase()
  if (normalized === '.png') return 'image/png'
  if (normalized === '.jpg' || normalized === '.jpeg') return 'image/jpeg'
  if (normalized === '.gif') return 'image/gif'
  if (normalized === '.webp') return 'image/webp'
  if (normalized === '.json') return 'application/json'
  if (normalized === '.txt' || normalized === '.log') return 'text/plain'
  return null
}

function labelEntryType(type: Entry['type']): string {
  return type
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

function buildGenerationPrompt(review: GenerationContextReview): string {
  const includedEntries = review.entries.filter((item) => item.included)
  const lines = [
    'You are helping a tester turn a local testing session into structured testware.',
    'Use only the information in this context. Do not invent unsupported facts.',
    'Return concise but useful structured output that matches the requested schema.',
    'Screenshots and files are represented by metadata only; do not assume image contents.',
    '',
    'Session Metadata:',
    `- ID: ${review.session.id}`,
    `- Title: ${review.session.title}`,
    `- Test Target: ${review.session.testTarget ?? 'Not set'}`,
    `- Charter: ${review.session.charter ?? 'Not set'}`,
    `- Environment: ${review.session.environment ?? 'Not set'}`,
    `- Build/Version: ${review.session.buildVersion ?? 'Not set'}`,
    `- Related Reference: ${review.session.relatedReference ?? 'Not set'}`,
    '',
    'Included Timeline Entries:'
  ]

  if (includedEntries.length === 0) {
    lines.push('- No timeline entries were included.')
  }

  for (const item of includedEntries) {
    lines.push(
      `- [${labelEntryType(item.entry.type)}] ${item.entry.title || 'Untitled'} at ${item.entry.createdAt}`,
      item.entry.body
    )

    for (const attachment of item.attachments) {
      lines.push(
        `  Attachment: ${attachment.filename}; type=${attachment.mimeType ?? 'unknown'}; bytes=${attachment.sizeBytes}; sha256=${attachment.sha256}`
      )
    }
  }

  lines.push('', 'Session-level Attachments:')

  if (review.attachments.length === 0) {
    lines.push('- No session-level attachments were included.')
  }

  for (const attachment of review.attachments) {
    lines.push(
      `- ${attachment.filename}; type=${attachment.mimeType ?? 'unknown'}; bytes=${attachment.sizeBytes}; sha256=${attachment.sha256}`
    )
  }

  lines.push('', 'Manual Findings:')

  if (review.findings.length === 0) {
    lines.push('- No manual Findings were created.')
  }

  for (const item of review.findings) {
    lines.push(`- [${item.finding.kind}] ${item.finding.title}`, item.finding.body)
    if (item.evidenceLinks.length > 0) {
      lines.push(`  Evidence links: ${item.evidenceLinks.length}`)
    }
  }

  return lines.join('\n')
}

export const __testables = {
  buildGenerationPrompt
}

function renderGeneratedReport(report: GeneratedReport): string {
  return [
    '# Session Report',
    '',
    '## What Was Tested',
    '',
    report.whatWasTested,
    '',
    '## Scenarios Covered',
    '',
    renderList(report.scenariosCovered),
    '',
    '## Checks',
    '',
    report.checks
      .map((check) => `- [${check.status}] ${check.title}${check.notes ? `: ${check.notes}` : ''}`)
      .join('\n') || '- None recorded.',
    '',
    '## Findings',
    '',
    renderList(report.findings),
    '',
    '## Bugs',
    '',
    report.bugs
      .map(
        (bug) =>
          [
            `### ${bug.title}`,
            '',
            '**Steps to Reproduce**',
            renderOrderedList(bug.stepsToReproduce),
            '',
            `**Expected:** ${bug.expectedResult}`,
            '',
            `**Actual:** ${bug.actualResult}`,
            '',
            '**Evidence**',
            renderList(bug.evidence ?? [])
          ].join('\n')
      )
      .join('\n\n') || 'None recorded.',
    '',
    '## Open Questions',
    '',
    renderList(report.openQuestions),
    '',
    '## Follow-up Actions',
    '',
    renderList(report.followUpActions),
    '',
    '## Jira Bug Drafts',
    '',
    report.jiraBugDrafts
      .map(
        (bug) =>
          [
            `### ${bug.summary}`,
            '',
            bug.description,
            '',
            '**Steps to Reproduce**',
            renderOrderedList(bug.stepsToReproduce),
            '',
            `**Expected Result:** ${bug.expectedResult}`,
            '',
            `**Actual Result:** ${bug.actualResult}`,
            '',
            '**Evidence**',
            renderList(bug.evidence ?? [])
          ].join('\n')
      )
      .join('\n\n') || 'None recorded.'
  ].join('\n')
}

function renderList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- None recorded.'
}

function renderOrderedList(values: string[]): string {
  return values.length > 0 ? values.map((value, index) => `${index + 1}. ${value}`).join('\n') : '1. None recorded.'
}
