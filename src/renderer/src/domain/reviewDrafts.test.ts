import { describe, expect, it } from 'vitest'
import type { EvidenceLink, Finding as StoredFinding } from '../../../shared/contracts'
import { serializeStructuredFindingDetails } from './findingDetails'
import { jiraDraftFromFinding, normalizeFinding } from './reviewDrafts'

describe('reviewDrafts Finding normalization', () => {
  it('uses structured Finding metadata for summaries and Jira fields', () => {
    const storedFinding: StoredFinding = {
      id: 'finding-1',
      sessionId: 'session-1',
      title: 'Checkout payment fails',
      body: 'Fallback body',
      kind: 'bug',
      metadataJson: serializeStructuredFindingDetails({
        schema: 'qa-scribe.structured-finding.v1',
        actual: 'Card submit shows an error.',
        expected: 'The order should be confirmed.',
        steps: ['Open checkout', 'Submit a valid card'],
        severity: 'major',
        priority: 'high',
        environment: 'Staging / 2026.06.16',
        component: 'Payments',
        notes: 'Only reproduced on the new card form.'
      }),
      createdAt: '2026-06-15T00:04:00.000Z',
      updatedAt: '2026-06-15T00:04:00.000Z'
    }
    const evidenceLinks: EvidenceLink[] = [
      {
        id: 'evidence-1',
        findingId: 'finding-1',
        entryId: 'entry-1',
        attachmentId: null,
        createdAt: '2026-06-15T00:04:00.000Z'
      }
    ]

    const finding = normalizeFinding(storedFinding, evidenceLinks)
    const jiraDraft = jiraDraftFromFinding(finding)

    expect(finding.summary).toBe('Card submit shows an error.')
    expect(finding.severity).toBe('major')
    expect(finding.priority).toBe('high')
    expect(jiraDraft.steps).toContain('1. Open checkout')
    expect(jiraDraft.expected).toBe('The order should be confirmed.')
    expect(jiraDraft.actual).toBe('Card submit shows an error.')
    expect(jiraDraft.evidence).toContain('entry-1')
  })
})
