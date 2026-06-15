import type {
  AiRun,
  Attachment,
  Draft,
  Entry,
  EvidenceLink,
  Finding,
  GenerationContext,
  Session
} from '../../../shared/contracts'
import {
  aiRuns,
  attachments,
  drafts,
  entries,
  evidenceLinks,
  findings,
  generationContexts,
  sessions
} from '../../db/schema'

export type RawEvidenceLink =
  | typeof evidenceLinks.$inferSelect
  | {
      id: string
      finding_id: string
      entry_id: string | null
      attachment_id: string | null
      created_at: string
    }

export function mapSession(row: typeof sessions.$inferSelect): Session {
  return row
}

export function mapEntry(row: typeof entries.$inferSelect): Entry {
  return row
}

export function mapAttachment(row: typeof attachments.$inferSelect): Attachment {
  return row
}

export function mapFinding(row: typeof findings.$inferSelect): Finding {
  return row
}

export function mapEvidenceLink(row: RawEvidenceLink): EvidenceLink {
  if ('findingId' in row) return row
  return {
    id: row.id,
    findingId: row.finding_id,
    entryId: row.entry_id,
    attachmentId: row.attachment_id,
    createdAt: row.created_at
  }
}

export function mapDraft(row: typeof drafts.$inferSelect): Draft {
  return row
}

export function mapAiRun(row: typeof aiRuns.$inferSelect): AiRun {
  return row
}

export function mapGenerationContext(row: typeof generationContexts.$inferSelect): GenerationContext {
  return row
}
