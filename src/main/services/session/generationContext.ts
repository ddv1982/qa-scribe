import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Attachment, Entry, EvidenceLink, Finding, GenerationContextReview } from '../../../shared/contracts'
import { idSchema } from '../../../shared/contracts'
import type { DbClient } from '../../db/client'
import {
  generationContextAttachments,
  generationContextEntries,
  generationContexts,
  sessions
} from '../../db/schema'
import { mapGenerationContext, mapSession } from './mappers'
import { isoNow } from './utils'

export type GenerationContextDeps = {
  client: DbClient
  listEntries(sessionId: string): Entry[]
  listAttachments(sessionId: string): Attachment[]
  listFindings(sessionId: string): Finding[]
  listEvidenceLinks(sessionId: string): EvidenceLink[]
  assertSessionExists(sessionId: string): void
}

export function createGenerationContext(deps: GenerationContextDeps, sessionId: string): GenerationContextReview {
  const parsedSessionId = idSchema.parse(sessionId)
  deps.assertSessionExists(parsedSessionId)
  const now = isoNow()
  const [context] = deps.client.db
    .insert(generationContexts)
    .values({
      id: randomUUID(),
      sessionId: parsedSessionId,
      createdAt: now
    })
    .returning()
    .all()

  for (const entry of deps.listEntries(parsedSessionId)) {
    deps.client.db
      .insert(generationContextEntries)
      .values({
        id: randomUUID(),
        generationContextId: context.id,
        entryId: entry.id,
        included: !entry.excludedFromGeneration
      })
      .run()
  }

  for (const attachment of deps.listAttachments(parsedSessionId).filter((value) => value.entryId === null)) {
    deps.client.db
      .insert(generationContextAttachments)
      .values({
        id: randomUUID(),
        generationContextId: context.id,
        attachmentId: attachment.id,
        included: true
      })
      .run()
  }

  return getGenerationContextReview(deps, context.id)
}

export function updateGenerationContextEntry(
  deps: GenerationContextDeps,
  contextId: string,
  entryId: string,
  included: boolean
): GenerationContextReview {
  const parsedContextId = idSchema.parse(contextId)
  const parsedEntryId = idSchema.parse(entryId)
  const existing = deps.client.db
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

  deps.client.db
    .update(generationContextEntries)
    .set({ included })
    .where(eq(generationContextEntries.id, existing.id))
    .run()

  return getGenerationContextReview(deps, parsedContextId)
}

export function updateGenerationContextAttachment(
  deps: GenerationContextDeps,
  contextId: string,
  attachmentId: string,
  included: boolean
): GenerationContextReview {
  const parsedContextId = idSchema.parse(contextId)
  const parsedAttachmentId = idSchema.parse(attachmentId)
  const existing = deps.client.db
    .select()
    .from(generationContextAttachments)
    .where(
      and(
        eq(generationContextAttachments.generationContextId, parsedContextId),
        eq(generationContextAttachments.attachmentId, parsedAttachmentId)
      )
    )
    .get()

  if (!existing) throw new Error(`Attachment not found in Generation Context: ${parsedAttachmentId}`)

  deps.client.db
    .update(generationContextAttachments)
    .set({ included })
    .where(eq(generationContextAttachments.id, existing.id))
    .run()

  return getGenerationContextReview(deps, parsedContextId)
}

export function getGenerationContextReview(deps: GenerationContextDeps, contextId: string): GenerationContextReview {
  const parsedContextId = idSchema.parse(contextId)
  const context = deps.client.db
    .select()
    .from(generationContexts)
    .where(eq(generationContexts.id, parsedContextId))
    .get()
  if (!context) throw new Error(`Generation Context not found: ${parsedContextId}`)

  const session = deps.client.db.select().from(sessions).where(eq(sessions.id, context.sessionId)).get()
  if (!session) throw new Error(`Session not found: ${context.sessionId}`)

  const contextEntries = deps.client.db
    .select()
    .from(generationContextEntries)
    .where(eq(generationContextEntries.generationContextId, parsedContextId))
    .all()
  const contextEntryByEntryId = new Map(contextEntries.map((entry) => [entry.entryId, entry]))
  const contextAttachments = deps.client.db
    .select()
    .from(generationContextAttachments)
    .where(eq(generationContextAttachments.generationContextId, parsedContextId))
    .all()
  const contextAttachmentByAttachmentId = new Map(
    contextAttachments.map((attachment) => [attachment.attachmentId, attachment])
  )
  const attachmentsForSession = deps.listAttachments(context.sessionId)

  return {
    context: mapGenerationContext(context),
    session: mapSession(session),
    entries: deps
      .listEntries(context.sessionId)
      .filter((entry) => contextEntryByEntryId.has(entry.id))
      .map((entry) => ({
        entry,
        included: Boolean(contextEntryByEntryId.get(entry.id)?.included),
        attachments: attachmentsForSession.filter((attachment) => attachment.entryId === entry.id)
      })),
    attachments: attachmentsForSession
      .filter((attachment) => attachment.entryId === null && contextAttachmentByAttachmentId.has(attachment.id))
      .map((attachment) => ({
        attachment,
        included: Boolean(contextAttachmentByAttachmentId.get(attachment.id)?.included)
      })),
    findings: deps.listFindings(context.sessionId).map((finding) => ({
      finding,
      evidenceLinks: deps.listEvidenceLinks(context.sessionId).filter((link) => link.findingId === finding.id)
    }))
  }
}
