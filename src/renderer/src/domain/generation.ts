import type {
  AiProviderStatus,
  GenerationContextReview,
  GenerationOptions,
  ReasoningEffort,
  SessionSnapshot
} from '../../../shared/contracts'
import { reasoningEffortsFor } from '../../../shared/contracts'
import type { ContextRow } from './types'

export function buildGenerationOptions(
  provider: AiProviderStatus | null,
  model: string,
  reasoningEffort: ReasoningEffort | null
): GenerationOptions | null {
  if (!provider) return null
  const trimmedModel = model.trim()
  return {
    provider: provider.provider,
    ...(trimmedModel ? { model: trimmedModel } : {}),
    reasoningEffort: reasoningEffortsFor(provider, trimmedModel).length > 0 ? reasoningEffort : null
  }
}

export function normalizeContextRows(context: GenerationContextReview | null, snapshot: SessionSnapshot): ContextRow[] {
  const rows = context?.entries.map((item) => ({
    entry: item.entry,
    included: item.included,
    attachments: item.attachments
  }))

  if (rows && rows.length > 0) return rows

  return snapshot.entries.map((entry) => ({
    entry,
    included: !entry.excludedFromGeneration,
    attachments: snapshot.attachments.filter((attachment) => attachment.entryId === entry.id)
  }))
}
