import type { StageOrigin } from '../bindings'

export function stageOrigin(kind: 'finding' | 'draft', recordId: string, stageId: string, sessionId = 'session-1'): StageOrigin {
  return { reference: { sessionId, draftId: 'test-chat' }, proposalId: `proposal-${stageId}`, stageId, record: { kind: kind === 'finding' ? 'finding' : 'test_cases_draft', recordId } }
}
