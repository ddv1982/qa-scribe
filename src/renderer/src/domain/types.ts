import type { Attachment, Entry, EntryType, GenerationContextReview } from '../../../shared/contracts'

export type WorkspaceMode = 'capture' | 'generation' | 'drafts'

export type Finding = {
  id: string
  sessionId: string
  title: string
  summary: string
  severity?: string | null
  status?: string | null
  evidenceEntryIds: string[]
  evidenceAttachmentIds: string[]
  createdAt: string
}

export type FindingDraft = {
  sessionId: string
  title: string
  summary: string
  severity?: string | null
  evidenceEntryIds: string[]
  evidenceAttachmentIds?: string[]
}

export type JiraBugDraft = {
  id: string
  title: string
  description: string
  steps: string
  expected: string
  actual: string
  evidence: string
}

export type ReviewDraft = {
  id: string
  sessionId: string
  title: string
  content: string
  jiraBugDrafts: JiraBugDraft[]
  updatedAt: string
}

export type ContextRow = {
  entry: Entry
  included: boolean
  attachments: Attachment[]
}

export type ContextAttachment = GenerationContextReview['attachments'][number]

export type EntryTypeOption = { value: EntryType; label: string }
