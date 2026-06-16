import type { Attachment, Entry, EntryType, GenerationContextReview } from '../../../shared/contracts'

export type WorkspaceMode = 'capture' | 'generation' | 'drafts'
export type CaptureMode = 'note' | 'finding'

export type StructuredFindingDetails = {
  schema: 'qa-scribe.structured-finding.v1'
  actual: string
  expected: string
  steps: string[]
  severity: string
  priority: string
  environment: string
  component: string
  notes: string
}

export type StructuredFindingDraft = Omit<StructuredFindingDetails, 'schema' | 'steps'> & {
  title: string
  steps: string
  linkSelectedEntry: boolean
}

export type Finding = {
  id: string
  sessionId: string
  title: string
  summary: string
  details?: StructuredFindingDetails | null
  severity?: string | null
  priority?: string | null
  status?: string | null
  evidenceEntryIds: string[]
  evidenceAttachmentIds: string[]
  createdAt: string
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
  aiRunId: string | null
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
