import { describe, expect, it } from 'vitest'
import type { EvidenceLink, Finding as StoredFinding } from '../../../shared/contracts'
import { serializeStructuredFindingDetails } from './findingDetails'
import type { Finding, JiraBugDraft, ReviewDraft } from './types'
import {
  jiraBugDraftsForReviewDraft,
  jiraDraftFromFinding,
  jiraDraftsFromMarkdown,
  normalizeFinding,
  reportContentFromDraftContent
} from './reviewDrafts'

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

  it('separates copyable report content from stored Jira bug draft data', () => {
    const markdown = [
      '# Session Report',
      '',
      '## What Was Tested',
      '',
      'Checkout smoke.',
      '',
      '## Jira Bug Drafts',
      '',
      '### Checkout fails',
      '',
      'Payment fails after card submit.',
      '',
      '**Steps to Reproduce**',
      '1. Open checkout',
      '',
      '**Expected Result:** Order confirmation appears.',
      '',
      '**Actual Result**: Payment form stays blocked.',
      '',
      '**Evidence**',
      '- checkout.png',
      '',
      '## Follow-up Actions',
      '',
      '- File the ticket.'
    ].join('\n')

    expect(reportContentFromDraftContent(markdown)).toBe('# Session Report\n\n## What Was Tested\n\nCheckout smoke.')
    expect(jiraDraftsFromMarkdown(markdown)).toEqual([
      expect.objectContaining({
        title: 'Checkout fails',
        description: 'Payment fails after card submit.',
        steps: '1. Open checkout',
        expected: 'Order confirmation appears.',
        actual: 'Payment form stays blocked.',
        evidence: '- checkout.png'
      })
    ])
  })

  it('uses Jira bug drafts from current markdown before stale stored drafts or Finding fallback', () => {
    const draft = reviewDraft({
      content: [
        '# Session Report',
        '',
        '## Jira Bug Drafts',
        '',
        '### Edited checkout failure',
        '',
        'Edited draft description.',
        '',
        '**Steps to Reproduce**',
        '1. Submit a valid card',
        '',
        '**Expected Result:** The order is confirmed.',
        '',
        '**Actual Result:** Checkout remains blocked.',
        '',
        '**Evidence**',
        '- checkout.png'
      ].join('\n'),
      jiraBugDrafts: [
        jiraBugDraft({
          id: 'stale',
          title: 'Stale structured draft'
        })
      ]
    })

    expect(jiraBugDraftsForReviewDraft(draft, [finding({ title: 'Fallback Finding' })])).toEqual([
      expect.objectContaining({
        title: 'Edited checkout failure',
        description: 'Edited draft description.',
        steps: '1. Submit a valid card',
        expected: 'The order is confirmed.',
        actual: 'Checkout remains blocked.'
      })
    ])
  })

  it('does not fall back to stored drafts or Findings when markdown says no Jira bugs are recorded', () => {
    const draft = reviewDraft({
      content: ['# Session Report', '', '## Jira Bug Drafts', '', 'None recorded.'].join('\n'),
      jiraBugDrafts: [jiraBugDraft({ title: 'Stale structured draft' })]
    })

    expect(jiraBugDraftsForReviewDraft(draft, [finding({ title: 'Fallback Finding' })])).toEqual([])
  })

  it('falls back to stored structured Jira drafts and then Findings when markdown has no Jira section', () => {
    const storedDraft = jiraBugDraft({ title: 'Stored structured draft' })
    expect(
      jiraBugDraftsForReviewDraft(
        reviewDraft({
          content: '# Session Report',
          jiraBugDrafts: [storedDraft]
        }),
        [finding({ title: 'Fallback Finding' })]
      )
    ).toEqual([storedDraft])

    expect(jiraBugDraftsForReviewDraft(reviewDraft({ content: '# Session Report' }), [finding({ title: 'Fallback Finding' })])).toEqual([
      expect.objectContaining({ title: 'Fallback Finding' })
    ])
  })
})

function reviewDraft(input: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    id: 'draft-1',
    sessionId: 'session-1',
    aiRunId: null,
    title: 'Session Report Draft',
    content: '# Session Report',
    jiraBugDrafts: [],
    updatedAt: '2026-06-15T00:04:00.000Z',
    ...input
  }
}

function jiraBugDraft(input: Partial<JiraBugDraft> = {}): JiraBugDraft {
  return {
    id: 'jira-1',
    title: 'Checkout failure',
    description: 'Checkout cannot complete.',
    steps: '1. Open checkout',
    expected: 'The order is confirmed.',
    actual: 'Checkout remains blocked.',
    evidence: 'checkout.png',
    ...input
  }
}

function finding(input: Partial<Finding> = {}): Finding {
  return {
    id: 'finding-1',
    sessionId: 'session-1',
    title: 'Checkout failure',
    summary: 'Checkout cannot complete.',
    details: null,
    severity: 'bug',
    priority: null,
    status: 'draft',
    evidenceEntryIds: [],
    evidenceAttachmentIds: [],
    createdAt: '2026-06-15T00:04:00.000Z',
    ...input
  }
}
