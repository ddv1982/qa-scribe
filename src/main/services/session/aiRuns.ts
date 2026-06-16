import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { AiProviderId, AiRun, Draft, ReasoningEffort } from '../../../shared/contracts'
import { idSchema } from '../../../shared/contracts'
import type { DbClient } from '../../db/client'
import { aiRuns, drafts, sessions } from '../../db/schema'
import { mapAiRun, mapDraft } from './mappers'
import { isoNow } from './utils'
import { promptVersion } from './generation'

export function createAiRun(
  client: DbClient,
  input: {
    sessionId: string
    generationContextId: string
    provider: AiProviderId
    model: string
    reasoningEffort: ReasoningEffort | null
    status: 'running' | 'completed' | 'failed'
    errorMessage?: string | null
  }
): AiRun {
  const now = isoNow()
  const [run] = client.db
    .insert(aiRuns)
    .values({
      id: randomUUID(),
      sessionId: input.sessionId,
      generationContextId: input.generationContextId,
      provider: input.provider,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      promptVersion,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      createdAt: now,
      completedAt: input.status === 'running' ? null : now
    })
    .returning()
    .all()

  touchSession(client, input.sessionId)
  return mapAiRun(run)
}

export function completeAiRun(client: DbClient, id: string): AiRun {
  const runId = idSchema.parse(id)
  const [run] = client.db
    .update(aiRuns)
    .set({
      status: 'completed',
      errorMessage: null,
      completedAt: isoNow()
    })
    .where(eq(aiRuns.id, runId))
    .returning()
    .all()
  touchSession(client, run.sessionId)
  return mapAiRun(run)
}

export function failAiRun(client: DbClient, id: string, errorMessage: string): AiRun {
  const runId = idSchema.parse(id)
  const [run] = client.db
    .update(aiRuns)
    .set({
      status: 'failed',
      errorMessage,
      completedAt: isoNow()
    })
    .where(eq(aiRuns.id, runId))
    .returning()
    .all()
  touchSession(client, run.sessionId)
  return mapAiRun(run)
}

export function createGeneratedDraft(client: DbClient, sessionId: string, aiRunId: string, body: string): Draft {
  const now = isoNow()
  const [draft] = client.db
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
  touchSession(client, sessionId)
  return mapDraft(draft)
}

function touchSession(client: DbClient, id: string): void {
  const now = isoNow()
  client.db.update(sessions).set({ updatedAt: now, lastOpenedAt: now }).where(eq(sessions.id, id)).run()
}
