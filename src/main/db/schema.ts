import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  testTarget: text('test_target'),
  charter: text('charter'),
  environment: text('environment'),
  buildVersion: text('build_version'),
  relatedReference: text('related_reference'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastOpenedAt: text('last_opened_at').notNull()
})

export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['note', 'observation', 'api_response', 'log', 'screenshot', 'finding_candidate']
  }).notNull(),
  title: text('title'),
  body: text('body').notNull(),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  excludedFromGeneration: integer('excluded_from_generation', { mode: 'boolean' }).notNull().default(false)
})

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  entryId: text('entry_id').references(() => entries.id, { onDelete: 'set null' }),
  filename: text('filename').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  relativePath: text('relative_path').notNull(),
  createdAt: text('created_at').notNull()
})

export const findings = sqliteTable('findings', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  kind: text('kind', { enum: ['bug', 'question', 'risk', 'follow_up', 'note'] }).notNull(),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const evidenceLinks = sqliteTable('evidence_links', {
  id: text('id').primaryKey(),
  findingId: text('finding_id')
    .notNull()
    .references(() => findings.id, { onDelete: 'cascade' }),
  entryId: text('entry_id').references(() => entries.id, { onDelete: 'cascade' }),
  attachmentId: text('attachment_id').references(() => attachments.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull()
})

export const generationContexts = sqliteTable('generation_contexts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull()
})

export const generationContextEntries = sqliteTable('generation_context_entries', {
  id: text('id').primaryKey(),
  generationContextId: text('generation_context_id')
    .notNull()
    .references(() => generationContexts.id, { onDelete: 'cascade' }),
  entryId: text('entry_id')
    .notNull()
    .references(() => entries.id, { onDelete: 'cascade' }),
  included: integer('included', { mode: 'boolean' }).notNull().default(true)
})

export const generationContextAttachments = sqliteTable('generation_context_attachments', {
  id: text('id').primaryKey(),
  generationContextId: text('generation_context_id')
    .notNull()
    .references(() => generationContexts.id, { onDelete: 'cascade' }),
  attachmentId: text('attachment_id')
    .notNull()
    .references(() => attachments.id, { onDelete: 'cascade' }),
  included: integer('included', { mode: 'boolean' }).notNull().default(true)
})

export const aiRuns = sqliteTable('ai_runs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  generationContextId: text('generation_context_id').references(() => generationContexts.id, { onDelete: 'set null' }),
  provider: text('provider', {
    enum: ['apple_intelligence', 'claude_code', 'codex_cli', 'copilot_cli']
  }).notNull(),
  model: text('model').notNull(),
  reasoningEffort: text('reasoning_effort', { enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] }),
  promptVersion: text('prompt_version').notNull(),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at')
})

export const drafts = sqliteTable('drafts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  aiRunId: text('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
  kind: text('kind', { enum: ['session_report'] }).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})
